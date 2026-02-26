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

// KALICI DİSK YOLU (sadece ayarlar için, cooldown yok)
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

// ────────────────────────────────────────────────
// COOLDOWN → sadece RAM'de, sunucu + kullanıcı bazlı
// ────────────────────────────────────────────────
const cooldowns = new Map(); // key: "userId_guildId"   value: timestamp (until)

function getCooldownKey(userId, guildId) {
    return `\( {userId}_ \){guildId}`;
}

// Süre parse fonksiyonu → "1h30m" → milisaniye
function parseDuration(str) {
    if (!str || str === '0') return 0;
    const regex = /(\d+)([smhd])/gi;
    let total = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        if (unit === 's') total += value * 1000;
        else if (unit === 'm') total += value * 60 * 1000;
        else if (unit === 'h') total += value * 3600 * 1000;
        else if (unit === 'd') total += value * 86400 * 1000;
    }
    return total;
}

function formatRemaining(ms) {
    if (ms <= 0) return "0 saniye";
    const totalSeconds = Math.floor(ms / 1000);

    const days    = Math.floor(totalSeconds / 86400);
    const hours   = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days)    parts.push(`${days} gün`);
    if (hours)   parts.push(`${hours} saat`);
    if (minutes) parts.push(`${minutes} dk`);
    if (seconds || parts.length === 0) parts.push(`${seconds} sn`);

    return parts.join(' ');
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
5. #partner-mesaj ← bu zorunlu!  
6. #partner-bekleme 30m ← opsiyonel`;

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
                { name: '#partner-mesaj', value: 'Başvuru sonrası kullanıcıya gidecek sunucu textiniz\n**Zorunlu ayardır!**', inline: false },
                { name: '#partner-bekleme [süre]', value: 'Aynı kullanıcının tekrar başvuru yapabilmesi için bekleme süresi\nÖr: 30m, 2h, 1d, 0 (kapatmak için)', inline: false }
            )
            .addFields({ name: 'Kurulum Sırası', value: KURULUM_SIRASI, inline: false })
            .setFooter({ text: 'Tüm ayarlar sunucuya özeldir • Cooldown RAM’de tutulur (restartta sıfırlanır)' });

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

    if (prefix === '#partner-bekleme') {
        if (!args.trim()) {
            const current = dbGet(`cooldown_${message.guild.id}`) || "ayarlanmamış";
            return message.reply(`Mevcut bekleme süresi: **${current}**\n\nKullanım:\n\`#partner-bekleme 30m\`\n\`#partner-bekleme 2h30m\`\n\`#partner-bekleme 0\` → kapatmak için`);
        }

        if (args === '0') {
            dbSet(`cooldown_${message.guild.id}`, null);
            return message.reply('✅ Partner bekleme süresi **kapatıldı**.');
        }

        const ms = parseDuration(args);
        if (ms < 1000) {
            return message.reply('❌ Geçersiz süre formatı.\nDesteklenen birimler: s, m, h, d\nÖrnek: 45s, 30m, 1h, 2h30m, 1d');
        }

        dbSet(`cooldown_${message.guild.id}`, args);
        return message.reply(`✅ Partnerlik sonrası bekleme süresi **${args}** olarak ayarlandı.`);
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

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const cooldownKey = getCooldownKey(userId, guildId);

        const cooldownStr = dbGet(`cooldown_${guildId}`);

        // Cooldown kontrolü
        if (cooldownStr && cooldownStr !== '0') {
            const cooldownMs = parseDuration(cooldownStr);
            const now = Date.now();
            const userUntil = cooldowns.get(cooldownKey) || 0;

            if (userUntil > now) {
                const remainingMs = userUntil - now;
                return interaction.editReply({
                    content: `⏳ Bir sonraki başvurun için **${formatRemaining(remainingMs)}** beklemelisin.\n(Bekleme süresi: ${cooldownStr})`,
                    ephemeral: true
                });
            }
        }

        const text = interaction.fields.getTextInputValue('p_text');

        const reklamKanalId = dbGet(`reklamKanal_${guildId}`);
        const logKanalId    = dbGet(`logKanal_${guildId}`);
        const davetMesaji   = dbGet(`davetMesaji_${guildId}`);

        if (!davetMesaji) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF5555')
                .setTitle('❌ Eksik Ayar')
                .setDescription('Sunucu sahibi `#partner-mesaj` komutunu kullanarak davet mesajını ayarlamamış.\nBaşvuru şu an mümkün değil.');
            return interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
        }

        // Reklam kanalına gönder
        if (reklamKanalId) {
            const ch = client.channels.cache.get(reklamKanalId);
            if (ch) await ch.send(text).catch(() => {});
        }

        // Log gönder
        if (logKanalId) {
            const ch = client.channels.cache.get(logKanalId);
            if (ch) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#00D166')
                    .setTitle('✅ Partnerlik Tamamlandı')
                    .setDescription(
                        `**Kullanıcı:** ${interaction.user}\n` +
                        `**Kullanıcı Adı:** ${interaction.user.tag}\n` +
                        `**Kullanıcı ID:** ${interaction.user.id}\n` +
                        `**Başvuru zamanı:** <t:${Math.floor(Date.now() / 1000)}:F>`
                    )
                    .setTimestamp();
                await ch.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }

        // Başarılı başvuru → cooldown başlat (RAM)
        if (cooldownStr && cooldownStr !== '0') {
            const ms = parseDuration(cooldownStr);
            if (ms > 0) {
                cooldowns.set(cooldownKey, Date.now() + ms);
            }
        }

        // Kullanıcıya cevap
        try {
            await interaction.followUp({ content: davetMesaji, ephemeral: true });
            await interaction.followUp({
                content: `**${interaction.user} Partnerlik başarılı!**`,
                ephemeral: false,
                allowedMentions: { parse: ['users'] }
            });
        } catch (err) {
            await interaction.editReply({ content: davetMesaji }).catch(() => {});
        }
    }
});

client.once(Events.ClientReady, () => {
    console.log(`✅ ${client.user.tag} hazır`);
});

client.login(process.env.token);