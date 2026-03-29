const {
    Client,
    GatewayIntentBits,
    Events,
    ActionRowBuilder,
    AttachmentBuilder,
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
const { HfInference } = require('@huggingface/inference');

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
// KALICI DİSK YOLLARI (Render için /var/data/ kalıcı)
// ────────────────────────────────────────────────
const DATA_DIR = '/var/data';
const dbPath = path.join(DATA_DIR, 'kanal-ayar.json');
const cooldownPath = path.join(DATA_DIR, 'partner-cooldowns.json');
const playersDataPath = path.join(DATA_DIR, 'players.json');

// Klasör Kontrolü
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log('✅ /var/data klasörü oluşturuldu');
    } catch (e) {
        console.log('❌ /var/data oluşturulamadı:', e.message);
    }
}

if (!fs.existsSync(playersDataPath)) {
    try {
        fs.writeFileSync(playersDataPath, JSON.stringify({}, null, 2));
        console.log('✅ players.json oluşturuldu');
    } catch (e) {
        console.log('❌ players.json oluşturulamadı:', e.message);
    }
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
// 3D MODEL ÜRETİCİ (Hugging Face)
// ────────────────────────────────────────────────
const hf = new HfInference(process.env.meshy);

const CHARACTERS = [
    "Muichiro Tokito anime character, mist hashira, detailed 3d model",
    "Naruto Uzumaki, sage mode, spiky hair, 3d avatar",
    "Edward Elric, fullmetal alchemist, 3d model"
    // Buraya istediğin kadar karakter ekleyebilirsin
];

async function generateFree3D(message, prompt) {
    const charName = prompt.split(',')[0];
    try {
        console.log(`[BAŞLADI] ${charName} oluşturuluyor...`);

        const response = await hf.textTo3D({
            model: 'stabilityai/stable-fast-3d',
            inputs: prompt,
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        const fileName = `${charName.replace(/\s+/g, '_')}.glb`;
        fs.writeFileSync(fileName, buffer);

        await message.channel.send({
            content: `✅ **${charName}** tamamen ücretsiz oluşturuldu!`,
            files: [new AttachmentBuilder(fileName)]
        });

        fs.unlinkSync(fileName);
    } catch (err) {
        console.error(err);
        await message.channel.send(`❌ **${charName}** sırasında Hugging Face sunucusu yoğun olabilir, tekrar dene.`);
    }
}

// ────────────────────────────────────────────────
// DISCORD BOT KOMUTLARI
// ────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const prefix = message.content.trim().split(/ +/)[0].toLowerCase();
    const args = message.content.trim().split(/ +/).slice(1).join(' ');

    // ── 3D Avatar Üret ──
    if (prefix === '!oluştur') {
        message.reply("🚀 **Açık kaynaklı modellerle ücretsiz üretim başladı!**");
        CHARACTERS.forEach(char => generateFree3D(message, char));
        return;
    }

    // ── Yardım ──
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
                { name: '#partner-bekleme [süre]', value: 'Cooldown (30m, 1h vb.)', inline: false },
                { name: '!oluştur', value: 'Ücretsiz 3D anime karakter modeli üret', inline: false }
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

// ────────────────────────────────────────────────
// NODEMAILER YAPILANDIRMASI
// ────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'atlaswarfare.com@gmail.com',
        pass: process.env.google
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Veri Depoları ──
const sessionTokens = {}; // token -> username
const pendingVerifications = {}; // username -> { code, email, userData }
const passwordResetCodes = {};  // email -> { code, expires, username }
let activePlayers = {};

// ── Yardımcı Fonksiyonlar ──
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateVerifyCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// GERÇEK E-POSTA GÖNDERİCİ
function sendEmail(to, subject, body) {
    const mailOptions = {
        from: '"Survival Evolution" <atlaswarfare.com@gmail.com>',
        to: to,
        subject: subject,
        text: body
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log('❌ E-posta Hatası:', error);
        } else {
            console.log('📧 E-posta Gönderildi: ' + info.response);
        }
    });
}

io.on('connection', (socket) => {

    // ── TOKEN İLE OTOMATİK GİRİŞ ──
    socket.on('loginWithToken', (token) => {
        const username = sessionTokens[token];
        if (!username) {
            socket.emit('loginError', 'Oturum süresi dolmuş. Lütfen tekrar giriş yapın.');
            return;
        }
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        if (!allUsers[username]) {
            socket.emit('loginError', 'Hesap bulunamadı.');
            return;
        }
        activePlayers[socket.id] = {
            ...allUsers[username],
            id: socket.id,
            hp: allUsers[username].hp || 100
        };
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    // ── KULLANICI ADI KONTROL (Türkçe karakter desteği eklendi)
    socket.on('checkUsername', (username) => {
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        const usernameExists = Object.keys(allUsers).some(u => u.toLowerCase() === username.toLowerCase());
        socket.emit('usernameAvailable', { available: !usernameExists });
    });

    // ── KAYIT OL (Türkçe karakter desteği eklendi)
    socket.on('register', (data) => {
        const { username, email, password } = data;

        if (!username || username.length < 3 || username.length > 16) {
            socket.emit('loginError', 'Kahraman adı 3-16 karakter arasında olmalıdır.');
            return;
        }
        if (!/^[a-zA-Z0-9_ğüşöçıĞÜŞÖÇİ]+$/.test(username)) {
            socket.emit('loginError', 'Kahraman adında geçersiz karakter var. Sadece harf, rakam, _ ve Türkçe karakterler kullanılabilir.');
            return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            socket.emit('loginError', 'Geçerli bir e-posta adresi girin.');
            return;
        }
        if (!password || password.length < 6) {
            socket.emit('loginError', 'Şifre en az 6 karakter olmalıdır.');
            return;
        }

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        const usernameExists = Object.keys(allUsers).some(u => u.toLowerCase() === username.toLowerCase());
        if (usernameExists) {
            socket.emit('loginError', 'Bu kahraman adı zaten alınmış.');
            return;
        }

        const emailUsed = Object.values(allUsers).some(u => u.email.toLowerCase() === email.toLowerCase());
        if (emailUsed) {
            socket.emit('loginError', 'Bu e-posta adresi zaten kayıtlı.');
            return;
        }

        const code = generateVerifyCode();
        pendingVerifications[username] = {
            code, email, password,
            userData: {
                username, email, password,
                x: 0, y: 0, z: 0,
                color: Math.floor(Math.random() * 16777215),
                hp: 100,
                inventory: { wood: 0, stone: 0, sword: 0, pickaxe: 0, axe: 0 },
                verified: false
            }
        };

        sendEmail(
            email,
            '⚔️ Survival Evolution - E-posta Doğrulama',
            `Kahraman ${username}, doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir.`
        );

        setTimeout(() => { delete pendingVerifications[username]; }, 10 * 60 * 1000);
        socket.emit('registerSuccess', { username });
    });

    // ── E-POSTA DOĞRULAMA ──
    socket.on('verifyEmail', (data) => {
        const { username, code } = data;
        const pending = pendingVerifications[username];
        if (!pending) {
            socket.emit('loginError', 'Doğrulama isteği bulunamadı veya süresi doldu.');
            return;
        }
        if (pending.code !== code) {
            socket.emit('loginError', 'Doğrulama kodu hatalı. Lütfen tekrar deneyin.');
            return;
        }

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        pending.userData.verified = true;
        allUsers[username] = pending.userData;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete pendingVerifications[username];

        const token = generateToken();
        sessionTokens[token] = username;
        activePlayers[socket.id] = { ...allUsers[username], id: socket.id };
        socket.emit('verifySuccess');
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    // ── KODU TEKRAR GÖNDER ──
    socket.on('resendVerifyCode', (data) => {
        const { username } = data;
        const pending = pendingVerifications[username];
        if (!pending) {
            socket.emit('loginError', 'Doğrulama isteği bulunamadı. Lütfen tekrar kayıt olun.');
            return;
        }
        const newCode = generateVerifyCode();
        pending.code = newCode;
        sendEmail(
            pending.email,
            '⚔️ Survival Evolution - Yeni Doğrulama Kodu',
            `Yeni doğrulama kodunuz: ${newCode}\n\nBu kod 10 dakika geçerlidir.`
        );
        socket.emit('loginError', '');
    });

    // ── GİRİŞ YAP (Büyük/küçük harf duyarsız)
    socket.on('login', (data) => {
        const { username, password } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        let foundUser = null;

        if (allUsers[username]) {
            foundUser = allUsers[username];
        } else {
            const usernameLower = username.toLowerCase();
            const userKey = Object.keys(allUsers).find(u => u.toLowerCase() === usernameLower);
            if (userKey) foundUser = allUsers[userKey];
        }

        if (!foundUser) {
            foundUser = Object.values(allUsers).find(u => u.email.toLowerCase() === username.toLowerCase());
        }

        if (!foundUser) {
            socket.emit('loginError', 'Bu kahraman adı veya e-posta kayıtlı değil.');
            return;
        }
        if (foundUser.password !== password) {
            socket.emit('loginError', 'Şifre hatalı. Lütfen tekrar deneyin.');
            return;
        }
        if (!foundUser.verified) {
            socket.emit('loginError', 'E-posta adresiniz henüz doğrulanmamış.');
            return;
        }

        const token = generateToken();
        sessionTokens[token] = foundUser.username;
        activePlayers[socket.id] = { ...foundUser, id: socket.id };
        socket.emit('loginSuccess', { token, username: foundUser.username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    // ── ŞİFREMİ UNUTTUM (KOD GÖNDER)
    socket.on('forgotPassword', (data) => {
        const { email } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        const user = Object.values(allUsers).find(u => u.email.toLowerCase() === email.toLowerCase());

        if (!user) {
            socket.emit('loginError', 'Bu e-posta adresi sistemde kayıtlı değil.');
            return;
        }

        const code = generateVerifyCode();

        passwordResetCodes[email.toLowerCase()] = {
            code: code,
            username: user.username,
            expires: Date.now() + 10 * 60 * 1000 // 10 dakika
        };

        sendEmail(
            email,
            '⚔️ Survival Evolution - Şifre Sıfırlama Kodu',
            `Merhaba ${user.username},\n\nŞifrenizi sıfırlamak için kullanacağınız kod: ${code}\n\nBu kod 10 dakika geçerlidir.`
        );

        socket.emit('forgotPasswordCodeSent');
    });

    // ── ŞİFRE SIFIRLAMA KODUNU DOĞRULA ──
    socket.on('verifyResetCode', (data) => {
        const { email, code } = data;
        const resetData = passwordResetCodes[email.toLowerCase()];

        if (!resetData || Date.now() > resetData.expires) {
            socket.emit('resetCodeError', 'Kod süresi dolmuş veya geçersiz.');
            return;
        }

        if (resetData.code !== code) {
            socket.emit('resetCodeError', 'Girdiğiniz kod hatalı.');
            return;
        }

        socket.emit('resetCodeVerified', { email: email.toLowerCase(), username: resetData.username });
    });

    // ── YENİ ŞİFREYİ KAYDET ──
    socket.on('resetPassword', (data) => {
        const { email, newPassword } = data;

        if (!newPassword || newPassword.length < 6) {
            socket.emit('resetPasswordError', 'Şifre en az 6 karakter olmalıdır.');
            return;
        }

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        const userEntry = Object.entries(allUsers).find(([_, u]) => u.email.toLowerCase() === email.toLowerCase());

        if (!userEntry) {
            socket.emit('resetPasswordError', 'Kullanıcı bulunamadı.');
            return;
        }

        const [username, user] = userEntry;

        user.password = newPassword;
        allUsers[username] = user;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));

        delete passwordResetCodes[email.toLowerCase()];

        socket.emit('resetPasswordSuccess');

        sendEmail(
            email,
            '⚔️ Survival Evolution - Şifre Değişikliği',
            `Merhaba ${user.username},\n\nŞifreniz başarıyla değiştirilmiştir.`
        );
    });

    // ── OYUNCU HAREKETİ ──
    socket.on('playerMovement', (data) => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].x = data.x;
            activePlayers[socket.id].y = data.y || 0;
            activePlayers[socket.id].z = data.z;
            activePlayers[socket.id].rotationY = data.rotationY;
            socket.broadcast.emit('playerMoved', activePlayers[socket.id]);
        }
    });

    // ── KAYNAK TOPLAMA ──
    socket.on('collect', (resourceType) => {
        const p = activePlayers[socket.id];
        if (p && (resourceType === 'wood' || resourceType === 'stone')) {
            p.inventory[resourceType] += 1;
            socket.emit('updateInventory', p.inventory);
        }
    });

    // ── ÜRETİM (CRAFT) ──
    socket.on('craft', (item) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        let success = false;
        const inv = p.inventory;
        if (item === 'sword' && inv.wood >= 2 && inv.stone >= 2) { inv.wood -= 2; inv.stone -= 2; inv.sword += 1; success = true; }
        else if (item === 'pickaxe' && inv.wood >= 3 && inv.stone >= 1) { inv.wood -= 3; inv.stone -= 1; inv.pickaxe += 1; success = true; }
        else if (item === 'axe' && inv.wood >= 1 && inv.stone >= 3) { inv.wood -= 1; inv.stone -= 3; inv.axe += 1; success = true; }
        if (success) socket.emit('updateInventory', inv);
    });

    // ── SALDIRI ──
    socket.on('attack', (targetId) => {
        const attacker = activePlayers[socket.id];
        const target = activePlayers[targetId];
        if (attacker && target) {
            const dist = Math.sqrt(Math.pow(attacker.x - target.x, 2) + Math.pow(attacker.z - target.z, 2));
            if (dist < 5) {
                let damage = attacker.inventory.sword > 0 ? 30 : 10;
                target.hp -= damage;
                if (target.hp <= 0) {
                    target.hp = 100; target.x = 0; target.z = 0;
                    io.emit('playerMoved', target);
                }
                io.emit('hpUpdate', { id: targetId, hp: target.hp });
            }
        }
    });

    // ── BAĞLANTI KESİLDİ ──
    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            try {
                let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
                const p = activePlayers[socket.id];
                if (allUsers[p.username]) {
                    allUsers[p.username].inventory = p.inventory;
                    allUsers[p.username].x = p.x || 0;
                    allUsers[p.username].y = p.y || 0;
                    allUsers[p.username].z = p.z || 0;
                    allUsers[p.username].hp = p.hp;
                    fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
                }
            } catch (e) {
                console.log('❌ Oyuncu verisi kaydedilemedi:', e.message);
            }
            for (const [token, username] of Object.entries(sessionTokens)) {
                if (username === activePlayers[socket.id].username) delete sessionTokens[token];
            }
            delete activePlayers[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

// ── HTTP ENDPOINTS ──
app.get('/status', (req, res) => res.send('Sistem Aktif!'));

// ── Sunucu Başlatma ──
server.listen(PORT, () => {
    console.log(`[✓] Sunucu Port ${PORT} üzerinde aktif.`);
    console.log(`[✓] Veriler kaydediliyor: ${playersDataPath}`);
});

// ── Discord Login (server.listen dışında, bağımsız) ──
process.on('uncaughtException', (err) => {
    console.error('❌ Kritik hata:', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Yakalanmamış promise hatası:', reason);
});

console.log('🔄 Discord token kontrol ediliyor...');

const discordToken = process.env.token;
if (!discordToken) {
    console.error('❌ HATA: "token" environment variable eksik!');
    console.error('   Render panelinde Environment Variables bölümüne "token" ekle.');
} else {
    console.log(`✅ Token bulundu, Discord'a bağlanılıyor...`);

    client.once('ready', () => {
        console.log(`✅ Discord: ${client.user.tag} aktif ve hazır!`);
    });

    client.on('error', (err) => {
        console.error('❌ Discord client hatası:', err.message);
    });

    client.login(discordToken).catch(err => {
        console.error('❌ Discord login başarısız:', err.message);
        console.error('   Token geçersiz veya süresi dolmuş olabilir.');
    });
}