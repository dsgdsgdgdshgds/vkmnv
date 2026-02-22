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
const fs = require('fs');
const http = require('http');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// KALICI DİSK YOLU (Render Disk → /var/data)
const dbPath = '/var/data/kanal-ayar.json';

// Dosya yoksa oluştur
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({}), 'utf8');
}

function dbSet(key, value) {
    let data = {};
    try {
        data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (err) {
        console.error('JSON okuma hatası:', err);
    }
    data[key] = value;
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('JSON yazma hatası:', err);
    }
}

function dbGet(key) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        return data[key] || null;
    } catch (err) {
        console.error('JSON okuma hatası (get):', err);
        return null;
    }
}

// HOSTING (Render health check)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif');
}).listen(PORT, () => {
    console.log(`[✓] Port ${PORT} açık`);
});

// Kurulum sırası (sadece yardımda)
const KURULUM_SIRASI = `**Önerilen kurulum sırası:**
1. #partner-yetkili @rol  
2. #partner-sistem #kanal  
3. #partner-kanal #kanal  
4. #partner-log #kanal  
5. #partner-mesaj ← bu zorunlu!`;

// KOMUTLAR
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = message.content.trim().split(/ +/)[0].toLowerCase();
    const args = message.content.trim().split(/ +/).slice(1).join(' ');

    if (prefix === '#yardım' || prefix === '#help') {
        const embed = new EmbedBuilder()
            .setTitle('Partner Bot Komutları')
            .setColor('#00D166')
            .setDescription('Partnerlik başvuru sistemini kurmak için aşağıdaki komutları kullanın.')
            .addFields(
                { name: '#partner-yetkili @rol', value: 'Başvuru sistemini başlatacak yetkili rolü', inline: true },
                { name: '#partner-sistem #kanal', value: 'Başvuru butonunun görüneceği kanal', inline: true },
                { name: '#partner-kanal #kanal', value: 'Onaylanan tanıtım metninin gönderileceği kanal', inline: true },
                { name: '#partner-log #kanal', value: 'Başarılı başvuru log kanalı', inline: true },
                { name: '#partner-mesaj', value: 'Başvuru sonrası kullanıcıya gidecek sunucu textiniz\n**Zorunlu ayardır!**', inline: false }
            )
            .addFields({ name: 'Kurulum Sırası', value: KURULUM_SIRASI, inline: false })
            .setFooter({ text: 'Tüm ayarlar sunucuya özeldir' });

        return message.channel.send({ embeds: [embed] });
    }

    if (prefix === '#partner-yetkili') {
        const target = message.mentions.roles.first();
        if (!target) return message.reply('⚠️ Bir rol etiketleyin\nÖrn: `#partner-yetkili @Yetkili`');
        dbSet(`hedefRol_${message.guild.id}`, target.id);
        return message.reply(`✅ Partner yetkili rolü ayarlandı\n\n**Sonraki adım:** #partner-sistem #kanal`);
    }

    if (prefix === '#partner-sistem') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketleyin');
        dbSet(`sistemKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Başvuru butonu kanalı ayarlandı\n\n**Sonraki adım:** #partner-kanal #kanal`);
    }

    if (prefix === '#partner-kanal') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketleyin');
        dbSet(`reklamKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Tanıtım gönderim kanalı ayarlandı\n\n**Sonraki adım:** #partner-log #kanal`);
    }

    if (prefix === '#partner-log') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketleyin');
        dbSet(`logKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Log kanalı ayarlandı\n\n**Sonraki adım:** #partner-mesaj ← bu zorunlu!`);
    }

    if (prefix === '#partner-mesaj') {
        if (!args.trim()) {
            return message.reply('⚠️ Mesaj içeriği yazmalısınız\nÖrn:\n```#partner-mesaj\nHoş geldin!\nBurası anime & chill ortamı\ndiscord.gg/abc```');
        }
        dbSet(`davetMesaji_${message.guild.id}`, args);
        return message.reply(`✅ Davet mesajı kaydedildi\n\nArtık sistem hazır! Test için yetkili rolü etiketleyebilirsiniz.`);
    }

    const hedefRolId = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRolId && message.mentions.roles.has(hedefRolId)) {
        const sistemKanalId = dbGet(`sistemKanal_${message.guild.id}`);
        if (!sistemKanalId || message.channel.id !== sistemKanalId) return;

        const embed = new EmbedBuilder()
            .setTitle('🤝 Partnerlik Başvurusu')
            .setDescription(`Partnerlik başvurusu yapmak için aşağıdaki butona tıklayın.\n<@${message.author.id}>`)
            .setColor('#00D166')
            .setFooter({ text: message.guild.name, iconURL: message.guild.iconURL() });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('p_basvuru')
                .setLabel('Başvuru Yap')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder()
            .setCustomId('p_modal')
            .setTitle('Partnerlik Başvurusu');

        const input = new TextInputBuilder()
            .setCustomId('p_text')
            .setLabel('Sunucu Tanıtım Metni')
            .setPlaceholder('Sunucunuzün tanıtım yazısını buraya yapıştırın...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'p_modal') {
        await interaction.deferReply({ ephemeral: true });

        const text = interaction.fields.getTextInputValue('p_text');
        const guildId = interaction.guild.id;

        const reklamKanalId = dbGet(`reklamKanal_${guildId}`);
        const logKanalId   = dbGet(`logKanal_${guildId}`);
        const davetMesaji  = dbGet(`davetMesaji_${guildId}`);

        if (!davetMesaji) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF5555')
                .setTitle('❌ Eksik Ayar')
                .setDescription('Sunucu sahibi `#partner-mesaj` komutunu kullanarak davet mesajını ayarlamamış.\nBaşvuru şu an mümkün değil.');
            return interaction.editReply({ embeds: [errorEmbed] });
        }

        if (reklamKanalId) {
            const ch = interaction.client.channels.cache.get(reklamKanalId);
            if (ch) await ch.send(text).catch(() => {});
        }

        if (logKanalId) {
            const ch = interaction.client.channels.cache.get(logKanalId);
            if (ch) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#00D166')
                    .setTitle('✅ Partnerlik Tamamlandı')
                    .setDescription(
                        `**Kullanıcı:** ${interaction.user}\n \n${interaction.user.tag}\n` +
                        `**Başvuru zamanı:** <t:${Math.floor(Date.now() / 1000)}:F>`
                    )
                    .setTimestamp();
                await ch.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }




setTimeout(async () => {
            try {
                await interaction.followUp({
                    content: davetMesaji,
                    ephemeral: true
                });
                await interaction.followUp({
            content: `**${interaction.user} Partnerlik başarılı!**`,
            ephemeral: false,
            embeds: [],
            allowedMentions: { parse: ['users'] }}); 
            } catch {
                await interaction.editReply({ content: davetMesaji, embeds: [] }).catch(() => {});
            }
        }, 100);
    }
});
       

client.once(Events.ClientReady, () => {
    console.log(`✅ ${client.user.tag} hazır`);
});

client.login(process.env.token);