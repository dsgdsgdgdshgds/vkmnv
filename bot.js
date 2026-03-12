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
const playersDataPath = path.join(__dirname, 'players.json'); // Oyun verisi

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
    cooldowns[`${userId}_${guildId}`] = untilTimestamp;
    saveCooldowns(cooldowns);
}

function getUserCooldownUntil(userId, guildId) {
    const cooldowns = getCooldowns();
    return cooldowns[`${userId}_${guildId}`] || 0;
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
// DISCORD BOT KOMUTLARI
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

    if (prefix === '#partner-yetkili') {
        const target = message.mentions.roles.first();
        if (!target) return message.reply('⚠️ Rol etiketle!');
        dbSet(`hedefRol_${message.guild.id}`, target.id);
        return message.reply('✅ Ayarlandı.');
    }

    if (prefix === '#partner-sistem') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Kanal etiketle!');
        dbSet(`sistemKanal_${message.guild.id}`, target.id);
        return message.reply('✅ Ayarlandı.');
    }

    if (prefix === '#partner-kanal') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Kanal etiketle!');
        dbSet(`reklamKanal_${message.guild.id}`, target.id);
        return message.reply('✅ Ayarlandı.');
    }

    if (prefix === '#partner-log') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Kanal etiketle!');
        dbSet(`logKanal_${message.guild.id}`, target.id);
        return message.reply('✅ Ayarlandı.');
    }

    if (prefix === '#partner-mesaj') {
        if (!args.trim()) return message.reply('⚠️ Metin gir!');
        dbSet(`davetMesaji_${message.guild.id}`, args);
        return message.reply('✅ Kaydedildi.');
    }

    if (prefix === '#partner-bekleme') {
        if (args === '0') {
            dbSet(`cooldown_${message.guild.id}`, null);
            return message.reply('✅ Kapatıldı.');
        }
        dbSet(`cooldown_${message.guild.id}`, args);
        return message.reply(`✅ ${args} olarak ayarlandı.`);
    }

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
    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder().setCustomId('p_modal').setTitle('Başvuru');
        const input = new TextInputBuilder().setCustomId('p_text').setLabel('Tanıtım Metni').setStyle(TextInputStyle.Paragraph).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'p_modal') {
        await interaction.deferReply({ ephemeral: true });
        const cooldownStr = dbGet(`cooldown_${interaction.guild.id}`);
        if (cooldownStr) {
            const until = getUserCooldownUntil(interaction.user.id, interaction.guild.id);
            if (until > Date.now()) return interaction.editReply(`⏳ Beklemelisin: ${formatRemaining(until - Date.now())}`);
        }

        const text = interaction.fields.getTextInputValue('p_text');
        const reklamKanalId = dbGet(`reklamKanal_${interaction.guild.id}`);
        const davet = dbGet(`davetMesaji_${interaction.guild.id}`);
        
        if (reklamKanalId) {
            const ch = interaction.client.channels.cache.get(reklamKanalId);
            if (ch) ch.send(text);
        }

        if (cooldownStr) setUserCooldown(interaction.user.id, interaction.guild.id, Date.now() + parseDuration(cooldownStr));
        await interaction.editReply(davet || "✅ Başarılı!");
    }
});


const crypto = require('crypto');
const nodemailer = require('nodemailer');
const playersDataPath = path.join(__dirname, 'players.json');

// ── NODEMAILER YAPILANDIRMASI ──
// Gmail kullanıyorsanız "Uygulama Şifresi" almanız gerekir.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'atlaswarfare.com@gmail.com', // Buraya kendi e-postanı yaz
        pass: 'Actd oipe dhmi dyvi'          // Buraya Gmail'den aldığın 16 haneli uygulama şifresini yaz
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessionTokens = {}; 
const pendingVerifications = {}; 
const passwordResetTokens = {};  
let activePlayers = {};

// ── YARDIMCI FONKSİYONLAR ──
function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateVerifyCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

// ── GERÇEK E-POSTA GÖNDERİCİ ──
async function sendEmail(to, subject, body) {
    const mailOptions = {
        from: '"⚔️ Survival Evolution" <EPOSTA_ADRESIN@gmail.com>',
        to: to,
        subject: subject,
        text: body,
        // İstersen html: `<b>${body}</b>` şeklinde de gönderebilirsin
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ E-posta başarıyla gönderildi: ${to}`);
    } catch (error) {
        console.error(`❌ E-posta gönderim hatası:`, error);
    }
}

// ════════════════════════════════════════════
//  SOCKET.IO MANTIĞI
// ════════════════════════════════════════════
io.on('connection', (socket) => {

    socket.on('register', (data) => {
        const { username, email, password } = data;

        // Validasyonlar (Senin kodunla aynı)
        if (!username || username.length < 3) return socket.emit('loginError', 'Geçersiz kullanıcı adı.');
        if (!email || !email.includes('@')) return socket.emit('loginError', 'Geçersiz e-posta.');

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        if (allUsers[username]) return socket.emit('loginError', 'Bu kahraman adı zaten alınmış.');

        const code = generateVerifyCode();
        pendingVerifications[username] = {
            code,
            email,
            password,
            userData: {
                username, email, password,
                x: 0, y: 0, z: 0,
                color: Math.floor(Math.random() * 16777215),
                hp: 100,
                inventory: { wood: 0, stone: 0, sword: 0, pickaxe: 0, axe: 0 },
                verified: false
            }
        };

        // E-POSTA GÖNDERİMİ TETİKLENİYOR
        sendEmail(
            email,
            '⚔️ Survival Evolution - Doğrulama Kodu',
            `Selam Kahraman ${username}!\n\nDünyaya adım atmak için doğrulama kodun: ${code}\n\nİyi oyunlar!`
        );

        socket.emit('registerSuccess', { username });
    });

    socket.on('verifyEmail', (data) => {
        const { username, code } = data;
        const pending = pendingVerifications[username];

        if (!pending || pending.code !== code) {
            return socket.emit('loginError', 'Kod hatalı veya süresi dolmuş.');
        }

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        pending.userData.verified = true;
        allUsers[username] = pending.userData;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete pendingVerifications[username];

        const token = generateToken();
        sessionTokens[token] = username;
        socket.emit('verifySuccess');
        socket.emit('loginSuccess', { token, username });
    });

    // Şifre Sıfırlama İsteği
    socket.on('forgotPassword', (data) => {
        const { email } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        const user = Object.values(allUsers).find(u => u.email === email);
        if (user) {
            const resetToken = generateToken();
            passwordResetTokens[resetToken] = { username: user.username, expires: Date.now() + 30 * 60 * 1000 };
            
            const resetUrl = `http://localhost:${PORT}/reset-password?token=${resetToken}`;
            sendEmail(
                email,
                '⚔️ Şifre Sıfırlama İsteği',
                `Şifreni sıfırlamak için bu linke tıkla: ${resetUrl}`
            );
        }
        socket.emit('forgotPasswordSent');
    });

    // Diğer hareket, toplama ve saldırı kodlarını buraya ekleyebilirsin...
});

// ════════════════════════════════════════════
//  HTTP ENDPOINTS (Şifre Sıfırlama Sayfası)
// ════════════════════════════════════════════
app.get('/reset-password', (req, res) => {
    // Senin verdiğin HTML formu buraya gelecek (Token kontrolü ile)
    res.send("Şifre sıfırlama formu burada görüntülenecek..."); 
});

server.listen(PORT, () => {
    console.log(`[✓] Oyun ${PORT} portunda e-posta servisiyle birlikte aktif.`);
});