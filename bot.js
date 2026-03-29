// ── IMPORTS ──
const { Client, GatewayIntentBits, Events, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// ── 3D MODEL (HuggingFace) - sadece paket varsa yükle ──
let hf = null;
try {
    const { HfInference } = require('@huggingface/inference');
    hf = new HfInference(process.env.meshy);
    console.log('✅ HuggingFace yüklendi');
} catch (e) {
    console.log('⚠️ @huggingface/inference paketi yok, !oluştur komutu devre dışı');
}

// ── EXPRESS & SOCKET.IO ──
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// ── DISCORD CLIENT ──
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ── DOSYA YOLLARI ──
const DATA_DIR = '/var/data';
const dbPath = path.join(DATA_DIR, 'kanal-ayar.json');
const cooldownPath = path.join(DATA_DIR, 'partner-cooldowns.json');
const playersDataPath = path.join(DATA_DIR, 'players.json');

if (!fs.existsSync(DATA_DIR)) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
if (!fs.existsSync(playersDataPath)) { try { fs.writeFileSync(playersDataPath, JSON.stringify({}, null, 2)); } catch (e) {} }

// ── DB YARDIMCI ──
function dbSet(key, value) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (e) {}
    data[key] = value;
    try { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
}

function dbGet(key) {
    try { return JSON.parse(fs.readFileSync(dbPath, 'utf8'))[key] ?? null; } catch (e) { return null; }
}

function getCooldowns() {
    try { return JSON.parse(fs.readFileSync(cooldownPath, 'utf8')); } catch (e) { return {}; }
}

function saveCooldowns(c) {
    try { fs.writeFileSync(cooldownPath, JSON.stringify(c, null, 2), 'utf8'); } catch (e) {}
}

function setUserCooldown(userId, guildId, until) {
    const c = getCooldowns(); c[`${userId}_${guildId}`] = until; saveCooldowns(c);
}

function getUserCooldownUntil(userId, guildId) {
    return getCooldowns()[`${userId}_${guildId}`] || 0;
}

function parseDuration(str) {
    if (!str || str === '0') return 0;
    const regex = /(\d+)([smhd])/gi; let total = 0; let match;
    while ((match = regex.exec(str)) !== null) {
        const v = parseInt(match[1]); const u = match[2].toLowerCase();
        if (u === 's') total += v * 1000;
        else if (u === 'm') total += v * 60000;
        else if (u === 'h') total += v * 3600000;
        else if (u === 'd') total += v * 86400000;
    }
    return total;
}

function formatRemaining(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} saniye`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} dk`;
    return `${Math.floor(m / 60)} saat`;
}

// ── 3D ÜRETİCİ ──
const CHARACTERS = [
    "Muichiro Tokito anime character, mist hashira, detailed 3d model",
    "Naruto Uzumaki, sage mode, spiky hair, 3d avatar",
    "Edward Elric, fullmetal alchemist, 3d model"
];

async function generateFree3D(message, prompt) {
    if (!hf) return message.channel.send('❌ HuggingFace paketi yüklü değil.');
    const charName = prompt.split(',')[0];
    try {
        const response = await hf.textTo3D({ model: 'stabilityai/stable-fast-3d', inputs: prompt });
        const buffer = Buffer.from(await response.arrayBuffer());
        const fileName = `${charName.replace(/\s+/g, '_')}.glb`;
        fs.writeFileSync(fileName, buffer);
        await message.channel.send({ content: `✅ **${charName}** oluşturuldu!`, files: [new AttachmentBuilder(fileName)] });
        fs.unlinkSync(fileName);
    } catch (err) {
        await message.channel.send(`❌ **${charName}** oluşturulamadı, tekrar dene.`);
    }
}

// ── DISCORD KOMUTLAR ──
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const args = message.content.trim().split(/ +/);
    const cmd = args[0].toLowerCase();
    const rest = args.slice(1).join(' ');

    if (cmd === '!oluştur') {
        message.reply('🚀 Üretim başladı!');
        CHARACTERS.forEach(c => generateFree3D(message, c));
        return;
    }

    if (cmd === '#yardım') {
        return message.channel.send({ embeds: [new EmbedBuilder().setTitle('Komutlar').setColor('#00D166').addFields(
            { name: '#partner-yetkili @rol', value: 'Yetkili rolü', inline: true },
            { name: '#partner-sistem #kanal', value: 'Başvuru kanalı', inline: true },
            { name: '#partner-kanal #kanal', value: 'Reklam kanalı', inline: true },
            { name: '#partner-log #kanal', value: 'Log kanalı', inline: true },
            { name: '#partner-mesaj [metin]', value: 'Davet metni', inline: false },
            { name: '#partner-bekleme [süre]', value: 'Cooldown (30m, 1h vb.)', inline: false },
            { name: '!oluştur', value: '3D anime karakter üret', inline: false }
        )] });
    }

    if (cmd === '#partner-yetkili') {
        const r = message.mentions.roles.first();
        if (!r) return message.reply('⚠️ Rol etiketle!');
        dbSet(`hedefRol_${message.guild.id}`, r.id);
        return message.reply('✅ Ayarlandı.');
    }
    if (cmd === '#partner-sistem') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('⚠️ Kanal etiketle!');
        dbSet(`sistemKanal_${message.guild.id}`, ch.id);
        return message.reply('✅ Ayarlandı.');
    }
    if (cmd === '#partner-kanal') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('⚠️ Kanal etiketle!');
        dbSet(`reklamKanal_${message.guild.id}`, ch.id);
        return message.reply('✅ Ayarlandı.');
    }
    if (cmd === '#partner-log') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('⚠️ Kanal etiketle!');
        dbSet(`logKanal_${message.guild.id}`, ch.id);
        return message.reply('✅ Ayarlandı.');
    }
    if (cmd === '#partner-mesaj') {
        if (!rest.trim()) return message.reply('⚠️ Metin gir!');
        dbSet(`davetMesaji_${message.guild.id}`, rest);
        return message.reply('✅ Kaydedildi.');
    }
    if (cmd === '#partner-bekleme') {
        if (rest === '0') { dbSet(`cooldown_${message.guild.id}`, null); return message.reply('✅ Kapatıldı.'); }
        dbSet(`cooldown_${message.guild.id}`, rest);
        return message.reply(`✅ ${rest} olarak ayarlandı.`);
    }

    const hedefRolId = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRolId && message.mentions.roles.has(hedefRolId)) {
        if (message.channel.id !== dbGet(`sistemKanal_${message.guild.id}`)) return;
        await message.channel.send({ content: '🤝 Partnerlik Başvurusu', components: [
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('p_basvuru').setLabel('Başvuru Yap').setStyle(ButtonStyle.Success))
        ]});
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder().setCustomId('p_modal').setTitle('Başvuru');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('p_text').setLabel('Tanıtım Metni').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'p_modal') {
        await interaction.deferReply({ ephemeral: true });
        const cooldownStr = dbGet(`cooldown_${interaction.guild.id}`);
        if (cooldownStr) {
            const until = getUserCooldownUntil(interaction.user.id, interaction.guild.id);
            if (until > Date.now()) return interaction.editReply(`⏳ ${formatRemaining(until - Date.now())} bekle.`);
        }
        const text = interaction.fields.getTextInputValue('p_text');
        const reklamKanalId = dbGet(`reklamKanal_${interaction.guild.id}`);
        if (reklamKanalId) { const ch = interaction.client.channels.cache.get(reklamKanalId); if (ch) ch.send(text); }
        if (cooldownStr) setUserCooldown(interaction.user.id, interaction.guild.id, Date.now() + parseDuration(cooldownStr));
        await interaction.editReply(dbGet(`davetMesaji_${interaction.guild.id}`) || '✅ Başarılı!');
    }
});

// ────────────────────────────────────────────────
// SİTE KISMI - DOKUNULMADI
// ────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'atlaswarfare.com@gmail.com', pass: process.env.google }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessionTokens = {};
const pendingVerifications = {};
const passwordResetCodes = {};
let activePlayers = {};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateVerifyCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

function sendEmail(to, subject, body) {
    transporter.sendMail({ from: '"Survival Evolution" <atlaswarfare.com@gmail.com>', to, subject, text: body }, (error, info) => {
        if (error) console.log('❌ E-posta Hatası:', error);
        else console.log('📧 E-posta Gönderildi: ' + info.response);
    });
}

io.on('connection', (socket) => {

    socket.on('loginWithToken', (token) => {
        const username = sessionTokens[token];
        if (!username) { socket.emit('loginError', 'Oturum süresi dolmuş. Lütfen tekrar giriş yapın.'); return; }
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        if (!allUsers[username]) { socket.emit('loginError', 'Hesap bulunamadı.'); return; }
        activePlayers[socket.id] = { ...allUsers[username], id: socket.id, hp: allUsers[username].hp || 100 };
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    socket.on('checkUsername', (username) => {
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        socket.emit('usernameAvailable', { available: !Object.keys(allUsers).some(u => u.toLowerCase() === username.toLowerCase()) });
    });

    socket.on('register', (data) => {
        const { username, email, password } = data;
        if (!username || username.length < 3 || username.length > 16) { socket.emit('loginError', 'Kahraman adı 3-16 karakter arasında olmalıdır.'); return; }
        if (!/^[a-zA-Z0-9_ğüşöçıĞÜŞÖÇİ]+$/.test(username)) { socket.emit('loginError', 'Kahraman adında geçersiz karakter var.'); return; }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { socket.emit('loginError', 'Geçerli bir e-posta adresi girin.'); return; }
        if (!password || password.length < 6) { socket.emit('loginError', 'Şifre en az 6 karakter olmalıdır.'); return; }

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        if (Object.keys(allUsers).some(u => u.toLowerCase() === username.toLowerCase())) { socket.emit('loginError', 'Bu kahraman adı zaten alınmış.'); return; }
        if (Object.values(allUsers).some(u => u.email.toLowerCase() === email.toLowerCase())) { socket.emit('loginError', 'Bu e-posta adresi zaten kayıtlı.'); return; }

        const code = generateVerifyCode();
        pendingVerifications[username] = { code, email, password, userData: { username, email, password, x: 0, y: 0, z: 0, color: Math.floor(Math.random() * 16777215), hp: 100, inventory: { wood: 0, stone: 0, sword: 0, pickaxe: 0, axe: 0 }, verified: false } };
        sendEmail(email, '⚔️ Survival Evolution - E-posta Doğrulama', `Kahraman ${username}, doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir.`);
        setTimeout(() => { delete pendingVerifications[username]; }, 10 * 60 * 1000);
        socket.emit('registerSuccess', { username });
    });

    socket.on('verifyEmail', (data) => {
        const { username, code } = data;
        const pending = pendingVerifications[username];
        if (!pending) { socket.emit('loginError', 'Doğrulama isteği bulunamadı veya süresi doldu.'); return; }
        if (pending.code !== code) { socket.emit('loginError', 'Doğrulama kodu hatalı. Lütfen tekrar deneyin.'); return; }
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

    socket.on('resendVerifyCode', (data) => {
        const { username } = data;
        const pending = pendingVerifications[username];
        if (!pending) { socket.emit('loginError', 'Doğrulama isteği bulunamadı. Lütfen tekrar kayıt olun.'); return; }
        const newCode = generateVerifyCode();
        pending.code = newCode;
        sendEmail(pending.email, '⚔️ Survival Evolution - Yeni Doğrulama Kodu', `Yeni doğrulama kodunuz: ${newCode}\n\nBu kod 10 dakika geçerlidir.`);
        socket.emit('loginError', '');
    });

    socket.on('login', (data) => {
        const { username, password } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        let foundUser = allUsers[username] || null;
        if (!foundUser) { const k = Object.keys(allUsers).find(u => u.toLowerCase() === username.toLowerCase()); if (k) foundUser = allUsers[k]; }
        if (!foundUser) foundUser = Object.values(allUsers).find(u => u.email.toLowerCase() === username.toLowerCase());
        if (!foundUser) { socket.emit('loginError', 'Bu kahraman adı veya e-posta kayıtlı değil.'); return; }
        if (foundUser.password !== password) { socket.emit('loginError', 'Şifre hatalı. Lütfen tekrar deneyin.'); return; }
        if (!foundUser.verified) { socket.emit('loginError', 'E-posta adresiniz henüz doğrulanmamış.'); return; }
        const token = generateToken();
        sessionTokens[token] = foundUser.username;
        activePlayers[socket.id] = { ...foundUser, id: socket.id };
        socket.emit('loginSuccess', { token, username: foundUser.username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    socket.on('forgotPassword', (data) => {
        const { email } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        const user = Object.values(allUsers).find(u => u.email.toLowerCase() === email.toLowerCase());
        if (!user) { socket.emit('loginError', 'Bu e-posta adresi sistemde kayıtlı değil.'); return; }
        const code = generateVerifyCode();
        passwordResetCodes[email.toLowerCase()] = { code, username: user.username, expires: Date.now() + 10 * 60 * 1000 };
        sendEmail(email, '⚔️ Survival Evolution - Şifre Sıfırlama Kodu', `Merhaba ${user.username},\n\nŞifrenizi sıfırlamak için kullanacağınız kod: ${code}\n\nBu kod 10 dakika geçerlidir.`);
        socket.emit('forgotPasswordCodeSent');
    });

    socket.on('verifyResetCode', (data) => {
        const { email, code } = data;
        const resetData = passwordResetCodes[email.toLowerCase()];
        if (!resetData || Date.now() > resetData.expires) { socket.emit('resetCodeError', 'Kod süresi dolmuş veya geçersiz.'); return; }
        if (resetData.code !== code) { socket.emit('resetCodeError', 'Girdiğiniz kod hatalı.'); return; }
        socket.emit('resetCodeVerified', { email: email.toLowerCase(), username: resetData.username });
    });

    socket.on('resetPassword', (data) => {
        const { email, newPassword } = data;
        if (!newPassword || newPassword.length < 6) { socket.emit('resetPasswordError', 'Şifre en az 6 karakter olmalıdır.'); return; }
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        const userEntry = Object.entries(allUsers).find(([_, u]) => u.email.toLowerCase() === email.toLowerCase());
        if (!userEntry) { socket.emit('resetPasswordError', 'Kullanıcı bulunamadı.'); return; }
        const [username, user] = userEntry;
        user.password = newPassword;
        allUsers[username] = user;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete passwordResetCodes[email.toLowerCase()];
        socket.emit('resetPasswordSuccess');
        sendEmail(email, '⚔️ Survival Evolution - Şifre Değişikliği', `Merhaba ${user.username},\n\nŞifreniz başarıyla değiştirilmiştir.`);
    });

    socket.on('playerMovement', (data) => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].x = data.x; activePlayers[socket.id].y = data.y || 0;
            activePlayers[socket.id].z = data.z; activePlayers[socket.id].rotationY = data.rotationY;
            socket.broadcast.emit('playerMoved', activePlayers[socket.id]);
        }
    });

    socket.on('collect', (resourceType) => {
        const p = activePlayers[socket.id];
        if (p && (resourceType === 'wood' || resourceType === 'stone')) { p.inventory[resourceType] += 1; socket.emit('updateInventory', p.inventory); }
    });

    socket.on('craft', (item) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const inv = p.inventory; let success = false;
        if (item === 'sword' && inv.wood >= 2 && inv.stone >= 2) { inv.wood -= 2; inv.stone -= 2; inv.sword += 1; success = true; }
        else if (item === 'pickaxe' && inv.wood >= 3 && inv.stone >= 1) { inv.wood -= 3; inv.stone -= 1; inv.pickaxe += 1; success = true; }
        else if (item === 'axe' && inv.wood >= 1 && inv.stone >= 3) { inv.wood -= 1; inv.stone -= 3; inv.axe += 1; success = true; }
        if (success) socket.emit('updateInventory', inv);
    });

    socket.on('attack', (targetId) => {
        const attacker = activePlayers[socket.id]; const target = activePlayers[targetId];
        if (attacker && target) {
            const dist = Math.sqrt(Math.pow(attacker.x - target.x, 2) + Math.pow(attacker.z - target.z, 2));
            if (dist < 5) {
                target.hp -= attacker.inventory.sword > 0 ? 30 : 10;
                if (target.hp <= 0) { target.hp = 100; target.x = 0; target.z = 0; io.emit('playerMoved', target); }
                io.emit('hpUpdate', { id: targetId, hp: target.hp });
            }
        }
    });

    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            try {
                let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
                const p = activePlayers[socket.id];
                if (allUsers[p.username]) {
                    allUsers[p.username].inventory = p.inventory;
                    allUsers[p.username].x = p.x || 0; allUsers[p.username].y = p.y || 0;
                    allUsers[p.username].z = p.z || 0; allUsers[p.username].hp = p.hp;
                    fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
                }
            } catch (e) { console.log('❌ Oyuncu verisi kaydedilemedi:', e.message); }
            for (const [token, username] of Object.entries(sessionTokens)) {
                if (username === activePlayers[socket.id].username) delete sessionTokens[token];
            }
            delete activePlayers[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

app.get('/status', (req, res) => res.send('Sistem Aktif!'));

// ── BAŞLAT ──
client.once('ready', () => console.log(`✅ Discord: ${client.user.tag} hazır`));
client.login(process.env.token);

server.listen(PORT, () => {
    console.log(`[✓] Sunucu Port ${PORT} üzerinde aktif.`);
    console.log(`[✓] Veriler: ${playersDataPath}`);
});
