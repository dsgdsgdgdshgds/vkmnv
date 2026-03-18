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
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// ────────────────────────────────────────────────
// GENEL AYARLAR VE PORT
// ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ────────────────────────────────────────────────
// DISCORD BOT BAŞLATMA
// ────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ────────────────────────────────────────────────
// KALICI DİSK YOLLARI
// ────────────────────────────────────────────────
const dbPath = '/var/data/kanal-ayar.json';
const cooldownPath = '/var/data/partner-cooldowns.json';
const playersDataPath = path.join(__dirname, 'players.json');

// Klasör Kontrolü
if (!fs.existsSync('/var/data')) {
    try { fs.mkdirSync('/var/data', { recursive: true }); } catch (e) {}
}

// ────────────────────────────────────────────────
// DATABASE YARDIMCI FONKSİYONLARI (Discord)
// ────────────────────────────────────────────────
function dbSet(key, value) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (err) {}
    data[key] = value;
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8'); } catch (err) {}
}

function dbGet(key) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        return data[key] ?? null;
    } catch (err) { return null; }
}

function getCooldowns() {
    try { return JSON.parse(fs.readFileSync(cooldownPath, 'utf8')); } catch (err) { return {}; }
}

function saveCooldowns(cooldowns) {
    try { fs.writeFileSync(cooldownPath, JSON.stringify(cooldowns, null, 2), 'utf8'); } catch (err) {}
}

function setUserCooldown(userId, guildId, untilTimestamp) {
    const cooldowns = getCooldowns();
    cooldowns[`\( {userId}_ \){guildId}`] = untilTimestamp;
    saveCooldowns(cooldowns);
}

function getUserCooldownUntil(userId, guildId) {
    const cooldowns = getCooldowns();
    return cooldowns[`\( {userId}_ \){guildId}`] || 0;
}

function parseDuration(str) {
    if (!str || str === '0') return 0;
    const regex = /(\d+)([smhd])/gi;
    let total = 0; let match;
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
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} saniye`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} dk`;
    const h = Math.floor(m / 60);
    return `${h} saat`;
}

// ────────────────────────────────────────────────
// DISCORD BOT KOMUTLARI (değişmedi)
// ────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const prefix = message.content.trim().split(/ +/)[0].toLowerCase();
    const args = message.content.trim().split(/ +/).slice(1).join(' ');

    if (prefix === '#yardım') {
        const embed = new EmbedBuilder()
            .setTitle('Partner Bot Komutları')
            .setColor('#00D166')
            .addFields(
                { name: '#partner-yetkili @rol', value: 'Yetkili rolü', inline: true },
                { name: '#partner-sistem #kanal', value: 'Başvuru kanalı', inline: true },
                { name: '#partner-kanal #kanal', value: 'Reklam kanalı', inline: true },
                { name: '#partner-log #kanal', value: 'Log kanalı', inline: true },
                { name: '#partner-mesaj', value: 'Davet metni', inline: false },
                { name: '#partner-bekleme [süre]', value: 'Cooldown (30m, 1h vb.)', inline: false }
            );
        return message.channel.send({ embeds: [embed] });
    }

    // ... diğer #partner- komutları aynı kaldı (yetkili, sistem, kanal, log, mesaj, bekleme)

    const hedefRolId = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRolId && message.mentions.roles.has(hedefRolId)) {
        const sistemKanalId = dbGet(`sistemKanal_${message.guild.id}`);
        if (message.channel.id !== sistemKanalId) return;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('p_basvuru').setLabel('Başvuru Yap').setStyle(ButtonStyle.Success)
        );
        await message.channel.send({ content: '🤝 Partnerlik Başvurusu', components: [row] });
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    // ... başvuru butonu ve modal submit kısmı aynı kaldı
});

// ── NODEMAILER – ORİJİNALE YAKIN + LOG EKLENMİŞ ──
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,               // 465 için SSL
    auth: {
        user: 'atlaswarfare.com@gmail.com',
        pass: process.env.google || ''   // ← burası boşsa mail gitmez!
    }
});

// Hata olursa konsola bassın
transporter.verify((error, success) => {
    if (error) {
        console.error('SMTP bağlantı testi BAŞARISIZ:', error);
    } else {
        console.log('SMTP sunucusuna bağlanıldı ✓');
    }
});

function sendEmail(to, subject, body) {
    if (!process.env.google || process.env.google.trim() === '') {
        console.error('[E-POSTA] UYARI: process.env.google boş! Mail gönderilemiyor.');
        return;
    }

    console.log(`[E-POSTA] Gönderme denemesi → ${to} | ${subject}`);

    const mailOptions = {
        from: '"Survival Evolution" <atlaswarfare.com@gmail.com>',
        to: to,
        subject: subject,
        text: body
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('[E-POSTA HATASI]', error.message);
            if (error.response) console.error('→ SMTP Cevap:', error.response);
        } else {
            console.log('[E-POSTA BAŞARILI]', info.messageId, '→', to);
        }
    });
}

// ── diğer kısımlar (sessionTokens, pendingVerifications, socket.io olayları, reset-password endpoint vs.) aynı kaldı ──

// Örnek: forgotPassword içinde
socket.on('forgotPassword', (data) => {
    const { email } = data;
    // ... kullanıcı bulma kısmı aynı
    const resetUrl = `http://atlaswarfare.com:\( {PORT}/reset-password?token= \){resetToken}`;
    sendEmail(
        email,
        '⚔️ Survival Evolution - Şifre Sıfırlama',
        `Merhaba \( {user.username},\n\nŞifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:\n \){resetUrl}\n\nBu bağlantı 30 dakika geçerlidir.`
    );
    socket.emit('forgotPasswordSent');
});

// register içindeki doğrulama maili de aynı şekilde sendEmail ile çağrılıyor

// ── Sunucu başlatma ──
client.once('ready', () => {
    console.log(`✅ Discord: ${client.user.tag} hazır`);
});

client.login(process.env.token).catch(err => {
    console.error('Discord login başarısız:', err);
});

server.listen(PORT, () => {
    console.log(`[✓] Sunucu ${PORT} portunda aktif`);
});