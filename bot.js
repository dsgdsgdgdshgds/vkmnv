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
const playersDataPath = path.join(__dirname, 'players.json');

if (!fs.existsSync('/var/data')) {
    try { fs.mkdirSync('/var/data', { recursive: true }); } catch (e) {}
}

// ────────────────────────────────────────────────
// DATABASE YARDIMCI FONKSİYONLARI
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

// ────────────────────────────────────────────────
// NODEMAILER & EXPRESS YAPILANDIRMASI (DÜZELTİLDİ)
// ────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'atlaswarfare.com@gmail.com', 
        pass: process.env.google
    }
});

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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessionTokens = {}; 
const pendingVerifications = {}; 
const passwordResetTokens = {};  
let activePlayers = {};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateVerifyCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

// ────────────────────────────────────────────────
// SOCKET.IO OYUN MANTIĞI
// ────────────────────────────────────────────────
io.on('connection', (socket) => {

    socket.on('loginWithToken', (token) => {
        const username = sessionTokens[token];
        if (!username) return socket.emit('loginError', 'Oturum süresi dolmuş.');
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        if (!allUsers[username]) return socket.emit('loginError', 'Hesap bulunamadı.');
        
        activePlayers[socket.id] = { ...allUsers[username], id: socket.id };
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    socket.on('register', (data) => {
        const { username, email, password } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        
        if (allUsers[username]) return socket.emit('loginError', 'Bu ad zaten alınmış.');

        const code = generateVerifyCode();
        pendingVerifications[username] = {
            code, email, password,
            userData: {
                username, email, password,
                x: 0, y: 0, z: 0, hp: 100,
                color: Math.floor(Math.random() * 16777215),
                inventory: { wood: 0, stone: 0, sword: 0, pickaxe: 0, axe: 0 },
                verified: false
            }
        };

        sendEmail(email, '⚔️ Survival Evolution - E-posta Doğrulama', `Kahraman ${username}, doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir.`);
        
        setTimeout(() => { delete pendingVerifications[username]; }, 10 * 60 * 1000);
        socket.emit('registerSuccess', { username });
    });

    socket.on('verifyEmail', (data) => {
        const { username, code } = data;
        const pending = pendingVerifications[username];
        if (!pending || pending.code !== code) return socket.emit('loginError', 'Kod hatalı.');

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        pending.userData.verified = true;
        allUsers[username] = pending.userData;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete pendingVerifications[username];

        const token = generateToken();
        sessionTokens[token] = username;
        activePlayers[socket.id] = { ...allUsers[username], id: socket.id };
        socket.emit('verifySuccess');
        socket.emit('loginSuccess', { token, username });
    });

    socket.on('login', (data) => {
        const { username, password } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        let foundUser = allUsers[username] || Object.values(allUsers).find(u => u.email === username);

        if (!foundUser || foundUser.password !== password) return socket.emit('loginError', 'Hatalı bilgi.');
        if (!foundUser.verified) return socket.emit('loginError', 'E-posta onaylanmamış.');

        const token = generateToken();
        sessionTokens[token] = foundUser.username;
        activePlayers[socket.id] = { ...foundUser, id: socket.id };
        socket.emit('loginSuccess', { token, username: foundUser.username });
        socket.emit('currentPlayers', activePlayers);
    });

    socket.on('forgotPassword', (data) => {
        const { email } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        const user = Object.values(allUsers).find(u => u.email === email);
        
        if (user) {
            const resetToken = generateToken();
            passwordResetTokens[resetToken] = {
                username: user.username,
                expires: Date.now() + 30 * 60 * 1000
            };
            const resetUrl = `http://atlaswarfare.com:3000/reset-password?token=${resetToken}`;
            sendEmail(email, '⚔️ Şifre Sıfırlama', `Merhaba ${user.username},\n\nŞifrenizi sıfırlamak için bağlantıya tıklayın: ${resetUrl}`);
        }
        socket.emit('forgotPasswordSent');
    });

    socket.on('playerMovement', (data) => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].x = data.x;
            activePlayers[socket.id].y = data.y || 0;
            activePlayers[socket.id].z = data.z;
            activePlayers[socket.id].rotationY = data.rotationY;
            socket.broadcast.emit('playerMoved', activePlayers[socket.id]);
        }
    });

    socket.on('collect', (resourceType) => {
        const p = activePlayers[socket.id];
        if (p && (resourceType === 'wood' || resourceType === 'stone')) {
            p.inventory[resourceType] += 1;
            socket.emit('updateInventory', p.inventory);
        }
    });

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

    socket.on('attack', (targetId) => {
        const attacker = activePlayers[socket.id];
        const target = activePlayers[targetId];
        if (attacker && target) {
            const dist = Math.sqrt(Math.pow(attacker.x - target.x, 2) + Math.pow(attacker.z - target.z, 2));
            if (dist < 5) {
                target.hp -= attacker.inventory.sword > 0 ? 30 : 10;
                if (target.hp <= 0) { target.hp = 100; target.x = 0; target.z = 0; }
                io.emit('hpUpdate', { id: targetId, hp: target.hp });
                if (target.hp === 100) io.emit('playerMoved', target);
            }
        }
    });

    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            try {
                let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
                const p = activePlayers[socket.id];
                allUsers[p.username] = { ...allUsers[p.username], ...p };
                fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
            } catch (e) {}
            delete activePlayers[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

// ────────────────────────────────────────────────
// HTTP YOLLARI
// ────────────────────────────────────────────────
app.get('/reset-password', (req, res) => {
    const token = req.query.token;
    if (!token || !passwordResetTokens[token] || Date.now() > passwordResetTokens[token].expires) {
        return res.status(400).send('<html><body style="background:#0a0806;color:#c9a84c;text-align:center;padding:50px;"><h2>Bağlantı geçersiz veya süresi dolmuş.</h2></body></html>');
    }
    res.send(`
        <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Şifre Sıfırla</title>
        <style>body{background:#0a0806;color:#e8d8a0;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}
        .box{background:#1c1508;padding:40px;border-radius:8px;border:1px solid #3a2a10;width:320px;text-align:center;}
        input{width:100%;padding:10px;margin-bottom:10px;background:#0a0806;border:1px solid #3a2a10;color:#fff;}
        button{width:100%;padding:10px;background:#c9a84c;border:none;cursor:pointer;font-weight:bold;}</style></head>
        <body><div class="box"><h2>Şifre Sıfırla</h2>
        <input type="password" id="p1" placeholder="Yeni Şifre"><button onclick="reset()">GÜNCELLE</button><p id="m"></p></div>
        <script>async function reset(){
            const p = document.getElementById('p1').value;
            const res = await fetch('/reset-password', {
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({token:new URLSearchParams(window.location.search).get('token'), password:p})
            });
            const d = await res.json();
            if(d.success){ document.getElementById('m').innerText='Başarılı!'; setTimeout(()=>window.location.href='/',2000); }
            else{ document.getElementById('m').innerText=d.error; }
        }</script></body></html>
    `);
});

app.post('/reset-password', (req, res) => {
    const { token, password } = req.body;
    const resetData = passwordResetTokens[token];
    if (!resetData || Date.now() > resetData.expires) return res.json({ success: false, error: 'Süre dolmuş.' });
    try {
        let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
        allUsers[resetData.username].password = password;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete passwordResetTokens[token];
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: 'Sunucu hatası.' }); }
});

// ── BAŞLATMA ──
client.once('ready', () => { console.log(`✅ Discord: ${client.user.tag} hazır`); });
client.login(process.env.token);

server.listen(PORT, () => {
    console.log(`[✓] Sunucu Port ${PORT} üzerinde aktif.`);
});
