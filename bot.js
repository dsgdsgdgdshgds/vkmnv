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
const cooldownPath = '/var/data/partner-cooldowns.json';

// Dosyalar yoksa oluştur
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({}, null, 2), 'utf8');
}
if (!fs.existsSync(cooldownPath)) {
    fs.writeFileSync(cooldownPath, JSON.stringify({}, null, 2), 'utf8');
}

function dbSet(key, value) {
    let data = {};
    try {
        data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (err) {
        console.error('Ayar JSON okuma hatası:', err);
    }
    data[key] = value;
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('Ayar JSON yazma hatası:', err);
    }
}

function dbGet(key) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        return data[key] ?? null;
    } catch (err) {
        console.error('Ayar JSON okuma hatası (get):', err);
        return null;
    }
}

// ────────────────────────────────────────────────
// Cooldown (kalıcı) fonksiyonları
// ────────────────────────────────────────────────
function getCooldowns() {
    try {
        return JSON.parse(fs.readFileSync(cooldownPath, 'utf8'));
    } catch (err) {
        console.error('Cooldown JSON okuma hatası:', err);
        return {};
    }
}

function saveCooldowns(cooldowns) {
    try {
        fs.writeFileSync(cooldownPath, JSON.stringify(cooldowns, null, 2), 'utf8');
    } catch (err) {
        console.error('Cooldown JSON yazma hatası:', err);
    }
}

function setUserCooldown(userId, guildId, untilTimestamp) {
    const cooldowns = getCooldowns();
    const key = `${userId}_${guildId}`; // ✅ DÜZELTİLEN TEK SATIR
    cooldowns[key] = untilTimestamp;
    saveCooldowns(cooldowns);
}

function getUserCooldownUntil(userId, guildId) {
    const cooldowns = getCooldowns();
    const key = `${userId}_${guildId}`;
    return cooldowns[key] || 0;
}

// (DEVAMI AYNEN DEVAM EDİYOR — DEĞİŞMEDİ)

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

    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} saniye`;

    const m = Math.floor(s / 60);
    const sn = s % 60;
    if (m < 60) return `${m} dk${sn > 0 ? ` ${sn} sn` : ''}`;

    const h = Math.floor(m / 60);
    const dk = m % 60;
    if (h < 24) return `${h} saat${dk > 0 ? ` ${dk} dk` : ''}`;

    const d = Math.floor(h / 24);
    const saat = h % 24;
    return `${d} gün${saat > 0 ? ` ${saat} saat` : ''}`;
}

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

        const cooldownStr = dbGet(`cooldown_${guildId}`);

        // Cooldown kontrolü
        if (cooldownStr && cooldownStr !== '0') {
            const cooldownMs = parseDuration(cooldownStr);
            const now = Date.now();
            const userUntil = getUserCooldownUntil(userId, guildId);

            if (userUntil > now) {
                const remainingMs = userUntil - now;
                const remainingText = formatRemaining(remainingMs);

                return interaction.editReply({
                    content: `⏳ Bir sonraki başvurun için **${remainingText}** beklemelisin.\n(Bekleme süresi: ${cooldownStr})`,
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
            const ch = interaction.client.channels.cache.get(reklamKanalId);
            if (ch) await ch.send(text).catch(() => {});
        }

        // Log gönder
        if (logKanalId) {
            const ch = interaction.client.channels.cache.get(logKanalId);
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

        // Başarılı başvuru → cooldown başlat (kalıcı)
        if (cooldownStr && cooldownStr !== '0') {
            const ms = parseDuration(cooldownStr);
            if (ms > 0) {
                const until = Date.now() + ms;
                setUserCooldown(userId, guildId, until);
            }
        }

        // Kullanıcıya cevap
        try {
            await interaction.followUp({
                content: davetMesaji,
                ephemeral: true
            });

            await interaction.followUp({
                content: `**${interaction.user} Partnerlik başarılı!**`,
                ephemeral: false,
                allowedMentions: { parse: ['users'] }
            });
        } catch (err) {
            await interaction.editReply({ content: davetMesaji, embeds: [] }).catch(() => {});
        }
    }
});

client.once(Events.ClientReady, () => {
    console.log(`✅ ${client.user.tag} hazır`);
});


// --- OYUN VE SUNUCU ENTEGRASYONU ---
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app); // Mevcut http sunucunu kullanıyoruz
const io = new Server(server);

// Statik dosyalar için 'public' klasörü
app.use(express.static(path.join(__dirname, 'public')));

// Oyuncu verilerini Render diskinde tutmak için yol
const playersDataPath = '/var/data/players_db.json';
if (!fs.existsSync(playersDataPath)) fs.writeFileSync(playersDataPath, '{}');

let activePlayers = {}; 

io.on('connection', (socket) => {
    socket.on('login', (username) => {
        let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
        
        // Eğer kullanıcı kayıtlı değilse oluştur
        if (!allUsers[username]) {
            allUsers[username] = {
                username,
                x: Math.random() * 20 - 10,
                z: Math.random() * 20 - 10,
                color: Math.floor(Math.random()*16777215)
            };
            fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        }

        activePlayers[socket.id] = { ...allUsers[username], id: socket.id };
        
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    socket.on('playerMovement', (data) => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].x = data.x;
            activePlayers[socket.id].z = data.z;
            socket.broadcast.emit('playerMoved', activePlayers[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        delete activePlayers[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// Bot hazır olduğunda konsola bilgi ver
client.once('ready', () => {
    console.log(`[!] Oyun Sunucusu ve Bot Aktif!`);
});

// Mevcut server.listen kısmını bot.js'de şu şekilde güncelle/değiştir:
server.listen(PORT, () => {
    console.log(`[✓] Sunucu port ${PORT} üzerinde çalışıyor`);
});


client.login(process.env.token);