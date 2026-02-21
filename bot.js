const {
    Client,
    GatewayIntentBits,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder
} = require('discord.js');
const http = require('http');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ────────────────────────────────────────────────
// Environment variable olarak ekle
const NPOINT_URL = process.env.NPOINT_URL;  // örn: https://api.npoint.io/abc123def456

let ayarlarCache = null;

async function loadAyarlar() {
  if (ayarlarCache) return ayarlarCache;
  try {
    const res = await fetch(NPOINT_URL);
    if (!res.ok) {
      if (res.status === 404 || res.status === 200 && res.headers.get('content-length') === '0') return {}; // boşsa
      throw new Error('npoint yükleme hatası: ' + res.status);
    }
    const data = await res.json();
    ayarlarCache = data;
    return data;
  } catch (err) {
    console.error('[npoint] Load hatası:', err);
    return {};
  }
}

async function saveAyarlar(data) {
  ayarlarCache = data;
  try {
    const res = await fetch(NPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) console.error('[npoint] Save hatası:', res.status, await res.text());
  } catch (err) {
    console.error('[npoint] Save genel hata:', err);
  }
}

// ────────────────────────────────────────────────
//  Basit http keep-alive (hosting için)
// ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif');
}).listen(PORT, () => {
    console.log(`[Hosting] Port ${PORT} dinleniyor`);
});

const KURULUM_SIRASI = `**Önerilen kurulum sırası:**
1. #partner-yetkili @rol  
2. #partner-sistem #kanal  
3. #partner-kanal #kanal  
4. #partner-log #kanal  
5. #partner-mesaj ← **zorunlu!**`;

// ────────────────────────────────────────────────
//  MESAJ OLAYI (komutlar + yetkili etiket kontrolü)
// ────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    if (!content.startsWith('#')) return;

    const parts = content.split(/ +/);
    const prefix = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    // ── Yardım ─────────────────────────────────────
    if (prefix === '#yardım' || prefix === '#help') {
        const embed = new EmbedBuilder()
            .setTitle('Partner Bot Komutları')
            .setColor('#00D166')
            .setDescription('Partner başvuru sistemini kurmak için aşağıdaki komutları kullanın.')
            .addFields(
                { name: '#partner-yetkili @rol', value: 'Başvuruları onaylayacak rol', inline: true },
                { name: '#partner-sistem #kanal', value: 'Başvuru butonunun görüneceği kanal', inline: true },
                { name: '#partner-kanal #kanal', value: 'Onaylanan tanıtımların gönderileceği kanal', inline: true },
                { name: '#partner-log #kanal', value: 'Başvuru loglarının gideceği kanal', inline: true },
                { name: '#partner-mesaj', value: 'Başvuru sonrası kullanıcıya gidecek davet metni\n**Zorunlu ayardır!**', inline: false }
            )
            .addFields({ name: 'Kurulum Sırası', value: KURULUM_SIRASI, inline: false })
            .setFooter({ text: 'Tüm ayarlar sunucuya özeldir' });

        return message.channel.send({ embeds: [embed] });
    }

    // ── Ayar komutları ─────────────────────────────
    if (prefix === '#partner-yetkili') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply('⚠️ Bir rol etiketlemelisiniz\nÖrn: `#partner-yetkili @Yetkili`');
        await dbSet(`hedefRol_${message.guild.id}`, role.id);
        return message.reply(`✅ Yetkili rolü ayarlandı → **@&${role.id}**\n\nSonraki adım: #partner-sistem #kanal`);
    }

    if (prefix === '#partner-sistem') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('⚠️ Bir kanal etiketlemelisiniz');
        await dbSet(`sistemKanal_${message.guild.id}`, channel.id);
        return message.reply(`✅ Sistem kanalı ayarlandı → **${channel}**\n\nSonraki: #partner-kanal #kanal`);
    }

    if (prefix === '#partner-kanal') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('⚠️ Bir kanal etiketlemelisiniz');
        await dbSet(`reklamKanal_${message.guild.id}`, channel.id);
        return message.reply(`✅ Tanıtım kanalı ayarlandı → **${channel}**\n\nSonraki: #partner-log #kanal`);
    }

    if (prefix === '#partner-log') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply('⚠️ Bir kanal etiketlemelisiniz');
        await dbSet(`logKanal_${message.guild.id}`, channel.id);
        return message.reply(`✅ Log kanalı ayarlandı → **${channel}**\n\nSonraki: #partner-mesaj`);
    }

    if (prefix === '#partner-mesaj') {
        if (!args) return message.reply('⚠️ Mesaj içeriği yazmalısınız\nÖrn:\n```#partner-mesaj\nHoş geldin!\nBurası anime & chill ortamı\ndiscord.gg/abc```');
        await dbSet(`davetMesaji_${message.guild.id}`, args);
        return message.reply('✅ Davet mesajı kaydedildi!\n\nSistem artık kullanıma hazır.');
    }

    // ── Yetkili rol etiketlenince başvuru butonu ──
    const hedefRolId    = await dbGet(`hedefRol_${message.guild.id}`);
    const sistemKanalId = await dbGet(`sistemKanal_${message.guild.id}`);

    if (
        hedefRolId &&
        message.mentions.roles.has(hedefRolId) &&
        sistemKanalId &&
        message.channel.id === sistemKanalId
    ) {
        const embed = new EmbedBuilder()
            .setTitle('🤝 Partnerlik Başvurusu')
            .setDescription(`Partnerlik başvurusu yapmak için aşağıdaki butona tıklayın.\n<@${message.author.id}>`)
            .setColor('#00D166')
            .setFooter({ text: message.guild.name, iconURL: message.guild.iconURL() || undefined });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('partner_basvuru')
                .setLabel('Başvuru Yap')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

// ────────────────────────────────────────────────
//  BUTON & MODAL İŞLEMLERİ
// ────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    // Butona basıldığında modal aç
    if (interaction.isButton() && interaction.customId === 'partner_basvuru') {
        const modal = new ModalBuilder()
            .setCustomId('partner_modal')
            .setTitle('Partnerlik Başvurusu');

        const textInput = new TextInputBuilder()
            .setCustomId('tanitim_metni')
            .setLabel('Sunucu Tanıtım Metni')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Sunucunuzun tanıtım yazısını buraya yapıştırın...')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));

        return interaction.showModal(modal);
    }

    // Modal gönderildiğinde
    if (interaction.isModalSubmit() && interaction.customId === 'partner_modal') {
        await interaction.deferReply({ ephemeral: true });

        const tanitimMetni = interaction.fields.getTextInputValue('tanitim_metni');
        const guildId = interaction.guild.id;

        const reklamKanalId = await dbGet(`reklamKanal_${guildId}`);
        const logKanalId    = await dbGet(`logKanal_${guildId}`);
        const davetMesaji   = await dbGet(`davetMesaji_${guildId}`);

        if (!davetMesaji) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#FF5555')
                    .setTitle('❌ Eksik Ayar')
                    .setDescription('Sunucu sahibi `#partner-mesaj` komutu ile davet mesajını ayarlamamış.')]
            });
        }

        // 1. Tanıtım metnini ilgili kanala gönder
        if (reklamKanalId) {
            const ch = interaction.client.channels.cache.get(reklamKanalId);
            if (ch?.isTextBased()) {
                await ch.send(tanitimMetni).catch(err => console.log('Tanıtım gönderim hatası:', err));
            }
        }

        // 2. Log mesajı
        if (logKanalId) {
            const ch = interaction.client.channels.cache.get(logKanalId);
            if (ch?.isTextBased()) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#00D166')
                    .setTitle('✅ Yeni Partner Başvurusu')
                    .setDescription(
                        `**Başvuran:** \( {interaction.user} ( \){interaction.user.tag})\n` +
                        `**Zaman:** <t:${Math.floor(Date.now() / 1000)}:F>`
                    )
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                await ch.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }

        // 3. Kullanıcıya cevap (önce başarı, sonra davet mesajı)
        const successEmbed = new EmbedBuilder()
            .setColor('#00D166')
            .setTitle('🎉 Başvurunuz alındı!')
            .setDescription('Tanıtım metniniz ilgili kanala iletildi.')
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

        // Küçük gecikme ile davet mesajını göster
        setTimeout(async () => {
            try {
                await interaction.editReply({
                    embeds: [],
                    content: davetMesaji
                });
            } catch {}
        }, 500);
    }
});

client.once(Events.ClientReady, () => {
    console.log(`[✓] ${client.user.tag} aktif`);
});

client.login(process.env.token).catch(err => {
    console.error('Login hatası:', err);
});