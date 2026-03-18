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
//          GENEL AYARLAR ve SUNUCU
// ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ────────────────────────────────────────────────
//          DISCORD BOT
// ────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ────────────────────────────────────────────────
//          DOSYA YOLLARI
// ────────────────────────────────────────────────
const dbPath               = '/var/data/kanal-ayar.json';
const cooldownPath         = '/var/data/partner-cooldowns.json';
const playersDataPath      = path.join(__dirname, 'players.json');

// Klasör oluşturma
if (!fs.existsSync('/var/data')) {
    fs.mkdirSync('/var/data', { recursive: true });
}

// ────────────────────────────────────────────────
//    DISCORD DATABASE YARDIMCILARI
// ────────────────────────────────────────────────
function dbSet(key, value) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch {}
    data[key] = value;
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

function dbGet(key) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        return data[key] ?? null;
    } catch {
        return null;
    }
}

function getCooldowns() {
    try { return JSON.parse(fs.readFileSync(cooldownPath, 'utf8')); } catch { return {}; }
}

function saveCooldowns(cooldowns) {
    fs.writeFileSync(cooldownPath, JSON.stringify(cooldowns, null, 2), 'utf8');
}

function setUserCooldown(userId, guildId, until) {
    const cd = getCooldowns();
    cd[`\( {userId}_ \){guildId}`] = until;
    saveCooldowns(cd);
}

function getUserCooldownUntil(userId, guildId) {
    return getCooldowns()[`\( {userId}_ \){guildId}`] || 0;
}

function parseDuration(str) {
    if (!str || str === '0') return 0;
    let total = 0;
    const regex = /(\d+)([smhd])/gi;
    let match;
    while ((match = regex.exec(str)) !== null) {
        const val = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        if (unit === 's') total += val * 1000;
        if (unit === 'm') total += val * 60000;
        if (unit === 'h') total += val * 3600000;
        if (unit === 'd') total += val * 86400000;
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
//       DISCORD KOMUTLARI & PARTNER SİSTEMİ
// ────────────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    const args = message.content.trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    if (!cmd) return;

    if (cmd === '#yardım') {
        const embed = new EmbedBuilder()
            .setTitle('Partner Bot Komutları')
            .setColor('#00D166')
            .addFields(
                { name: '#partner-yetkili @rol',     value: 'Yetkili rolü', inline: true },
                { name: '#partner-sistem #kanal',     value: 'Başvuru kanalı', inline: true },
                { name: '#partner-kanal #kanal',      value: 'Reklam kanalı', inline: true },
                { name: '#partner-log #kanal',        value: 'Log kanalı', inline: true },
                { name: '#partner-mesaj',             value: 'Davet metni', inline: false },
                { name: '#partner-bekleme [süre]',    value: 'Cooldown (30m, 1h, 2d vb.)', inline: false }
            );
        return message.channel.send({ embeds: [embed] });
    }

    if (cmd === '#partner-yetkili') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply('Rol etiketlemelisin.');
        dbSet(`hedefRol_${message.guild.id}`, role.id);
        return message.reply('✅ Yetkili rolü ayarlandı.');
    }

    if (cmd === '#partner-sistem') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('Kanal etiketlemelisin.');
        dbSet(`sistemKanal_${message.guild.id}`, ch.id);
        return message.reply('✅ Başvuru sistemi kanalı ayarlandı.');
    }

    if (cmd === '#partner-kanal') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('Kanal etiketlemelisin.');
        dbSet(`reklamKanal_${message.guild.id}`, ch.id);
        return message.reply('✅ Reklam kanalı ayarlandı.');
    }

    if (cmd === '#partner-log') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('Kanal etiketlemelisin.');
        dbSet(`logKanal_${message.guild.id}`, ch.id);
        return message.reply('✅ Log kanalı ayarlandı.');
    }

    if (cmd === '#partner-mesaj') {
        const text = args.join(' ');
        if (!text) return message.reply('Mesaj yazmalısın.');
        dbSet(`davetMesaji_${message.guild.id}`, text);
        return message.reply('✅ Davet mesajı kaydedildi.');
    }

    if (cmd === '#partner-bekleme') {
        const süre = args[0];
        if (süre === '0') {
            dbSet(`cooldown_${message.guild.id}`, null);
            return message.reply('✅ Cooldown kapatıldı.');
        }
        dbSet(`cooldown_${message.guild.id}`, süre);
        return message.reply(`✅ Cooldown ${süre} olarak ayarlandı.`);
    }

    // Yetkili rolü mention edildiğinde başvuru butonu
    const hedefRol = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRol && message.mentions.roles.has(hedefRol)) {
        const sistemK = dbGet(`sistemKanal_${message.guild.id}`);
        if (message.channel.id !== sistemK) return;

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('p_basvuru')
                    .setLabel('Başvuru Yap')
                    .setStyle(ButtonStyle.Success)
            );

        await message.channel.send({
            content: '🤝 **Partnerlik Başvurusu**',
            components: [row]
        });
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder()
            .setCustomId('p_modal')
            .setTitle('Partner Başvuru');

        const textInput = new TextInputBuilder()
            .setCustomId('p_text')
            .setLabel('Sunucu Tanıtım Metni')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'p_modal') {
        await interaction.deferReply({ ephemeral: true });

        const cdStr = dbGet(`cooldown_${interaction.guild.id}`);
        if (cdStr) {
            const until = getUserCooldownUntil(interaction.user.id, interaction.guild.id);
            if (until > Date.now()) {
                return interaction.editReply(`⏳ Bekletme süresi: **${formatRemaining(until - Date.now())}**`);
            }
        }

        const text = interaction.fields.getTextInputValue('p_text');
        const reklamK = dbGet(`reklamKanal_${interaction.guild.id}`);
        const davetMsg = dbGet(`davetMesaji_${interaction.guild.id}`) || '✅ Başvurunuz alındı!';

        if (reklamK) {
            const channel = client.channels.cache.get(reklamK);
            if (channel) await channel.send(text).catch(()=>{});
        }

        if (cdStr) {
            setUserCooldown(interaction.user.id, interaction.guild.id, Date.now() + parseDuration(cdStr));
        }

        await interaction.editReply(davetMsg);
    }
});

// ────────────────────────────────────────────────
//          E-POSTA (nodemailer)
// ────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'atlaswarfare.com@gmail.com',
        pass: process.env.google
    }
});

// ────────────────────────────────────────────────
//          OYUN VERİ YAPISI
// ────────────────────────────────────────────────
const sessionTokens       = {};     // token → username
const pendingVerifications = {};    // username → {code, email, password, userData}
const passwordResetTokens = {};     // token → {username, expires}
let activePlayers = {};             // socket.id → player objesi

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateVerifyCode() {
    return String(100000 + Math.floor(Math.random() * 900000));
}

function sendEmail(to, subject, text) {
    transporter.sendMail({
        from: '"Survival Evolution" <atlaswarfare.com@gmail.com>',
        to,
        subject,
        text
    }, (err, info) => {
        if (err) console.error('E-posta gönderim hatası:', err);
        else console.log('E-posta gönderildi:', info?.response);
    });
}

// ────────────────────────────────────────────────
//          SOCKET.IO – OYUN MANTIKLARI
// ────────────────────────────────────────────────
io.on('connection', socket => {

    // Token ile otomatik giriş
    socket.on('loginWithToken', token => {
        const username = sessionTokens[token];
        if (!username) return socket.emit('loginError', 'Geçersiz veya süresi dolmuş oturum.');

        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}
        if (!users[username]) return socket.emit('loginError', 'Hesap bulunamadı.');

        activePlayers[socket.id] = {
            ...users[username],
            id: socket.id,
            hp: users[username].hp ?? 100
        };

        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    // Kullanıcı adı müsait mi?
    socket.on('checkUsername', username => {
        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}
        socket.emit('usernameAvailable', { available: !users[username] });
    });

    // Kayıt
    socket.on('register', ({ username, email, password }) => {
        if (!username || username.length < 3 || username.length > 16) {
            return socket.emit('loginError', 'Kullanıcı adı 3-16 karakter olmalı.');
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return socket.emit('loginError', 'Geçersiz karakter içeriyor.');
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return socket.emit('loginError', 'Geçerli e-posta girin.');
        }
        if (!password || password.length < 6) {
            return socket.emit('loginError', 'Şifre en az 6 karakter olmalı.');
        }

        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}

        if (users[username]) return socket.emit('loginError', 'Bu kullanıcı adı alınmış.');
        if (Object.values(users).some(u => u.email === email)) {
            return socket.emit('loginError', 'Bu e-posta zaten kayıtlı.');
        }

        const code = generateVerifyCode();
        pendingVerifications[username] = {
            code,
            email,
            password,
            userData: {
                username,
                email,
                password,
                x: 0, y: 0, z: 0,
                color: Math.floor(Math.random() * 16777215),
                hp: 100,
                inventory: { wood: 0, stone: 0, sword: 0, pickaxe: 0, axe: 0 },
                verified: false
            }
        };

        sendEmail(
            email,
            '⚔️ Survival Evolution - Doğrulama Kodu',
            `Merhaba ${username},\n\nDoğrulama kodun: ${code}\n\n10 dakika içinde kullanılmalıdır.`
        );

        setTimeout(() => delete pendingVerifications[username], 10*60*1000);
        socket.emit('registerSuccess', { username });
    });

    // Doğrulama
    socket.on('verifyEmail', ({ username, code }) => {
        const pend = pendingVerifications[username];
        if (!pend) return socket.emit('loginError', 'Doğrulama isteği bulunamadı veya süresi doldu.');
        if (pend.code !== code) return socket.emit('loginError', 'Yanlış doğrulama kodu.');

        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}
        pend.userData.verified = true;
        users[username] = pend.userData;
        fs.writeFileSync(playersDataPath, JSON.stringify(users, null, 2));

        delete pendingVerifications[username];

        const token = generateToken();
        sessionTokens[token] = username;
        activePlayers[socket.id] = { ...pend.userData, id: socket.id };

        socket.emit('verifySuccess');
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    // Kod tekrar gönder
    socket.on('resendVerifyCode', ({ username }) => {
        const pend = pendingVerifications[username];
        if (!pend) return socket.emit('loginError', 'Kayıt bulunamadı.');

        const newCode = generateVerifyCode();
        pend.code = newCode;

        sendEmail(
            pend.email,
            '⚔️ Survival Evolution - Yeni Doğrulama Kodu',
            `Yeni kodunuz: ${newCode}\n\n10 dakika geçerlidir.`
        );

        socket.emit('resendSuccess');
    });

    // Giriş
    socket.on('login', ({ username, password }) => {
        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}

        const user = users[username] || Object.values(users).find(u => u.email === username);
        if (!user) return socket.emit('loginError', 'Kullanıcı bulunamadı.');
        if (user.password !== password) return socket.emit('loginError', 'Yanlış şifre.');
        if (!user.verified) return socket.emit('loginError', 'E-posta doğrulanmamış.');

        const token = generateToken();
        sessionTokens[token] = user.username;
        activePlayers[socket.id] = { ...user, id: socket.id };

        socket.emit('loginSuccess', { token, username: user.username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    // Şifremi unuttum
    socket.on('forgotPassword', ({ email }) => {
        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}

        const user = Object.values(users).find(u => u.email === email);
        if (!user) return socket.emit('forgotPasswordSent'); // güvenlik için gerçek bilgi vermiyoruz

        const token = generateToken();
        passwordResetTokens[token] = {
            username: user.username,
            expires: Date.now() + 30*60*1000
        };

        const resetUrl = `http://atlaswarfare.com:\( {PORT}/reset-password?token= \){token}`;

        sendEmail(
            email,
            '⚔️ Survival Evolution - Şifre Sıfırlama',
            `Merhaba \( {user.username},\n\nŞifrenizi sıfırlamak için:\n \){resetUrl}\n\nBağlantı 30 dk geçerlidir.`
        );

        socket.emit('forgotPasswordSent');
    });

    // ─── OYUN OLAYLARI ───

    socket.on('playerMovement', data => {
        if (!activePlayers[socket.id]) return;
        activePlayers[socket.id].x = data.x;
        activePlayers[socket.id].y = data.y ?? 0;
        activePlayers[socket.id].z = data.z;
        activePlayers[socket.id].rotationY = data.rotationY;
        socket.broadcast.emit('playerMoved', activePlayers[socket.id]);
    });

    socket.on('collect', resource => {
        const p = activePlayers[socket.id];
        if (!p) return;
        if (resource === 'wood' || resource === 'stone') {
            p.inventory[resource] = (p.inventory[resource] || 0) + 1;
            socket.emit('updateInventory', p.inventory);
        }
    });

    socket.on('craft', item => {
        const p = activePlayers[socket.id];
        if (!p) return;
        let success = false;
        const inv = p.inventory;

        if (item === 'sword'   && inv.wood >= 2 && inv.stone >= 2) { inv.wood -= 2; inv.stone -= 2; inv.sword = (inv.sword||0) + 1; success = true; }
        if (item === 'pickaxe' && inv.wood >= 3 && inv.stone >= 1) { inv.wood -= 3; inv.stone -= 1; inv.pickaxe = (inv.pickaxe||0) + 1; success = true; }
        if (item === 'axe'     && inv.wood >= 1 && inv.stone >= 3) { inv.wood -= 1; inv.stone -= 3; inv.axe = (inv.axe||0) + 1; success = true; }

        if (success) socket.emit('updateInventory', inv);
    });

    socket.on('attack', targetId => {
        const att = activePlayers[socket.id];
        const tgt = activePlayers[targetId];
        if (!att || !tgt) return;

        const dist = Math.hypot(att.x - tgt.x, att.z - tgt.z);
        if (dist < 5) {
            const dmg = att.inventory.sword > 0 ? 30 : 10;
            tgt.hp -= dmg;
            if (tgt.hp <= 0) {
                tgt.hp = 100;
                tgt.x = 0;
                tgt.z = 0;
                io.emit('playerMoved', tgt);
            }
            io.emit('hpUpdate', { id: targetId, hp: tgt.hp });
        }
    });

    socket.on('disconnect', () => {
        if (!activePlayers[socket.id]) return;

        try {
            let users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
            const p = activePlayers[socket.id];
            users[p.username] = {
                ...users[p.username],
                inventory: p.inventory,
                x: p.x ?? 0,
                y: p.y ?? 0,
                z: p.z ?? 0,
                hp: p.hp
            };
            fs.writeFileSync(playersDataPath, JSON.stringify(users, null, 2));
        } catch {}

        // Token temizle
        for (const [t, u] of Object.entries(sessionTokens)) {
            if (u === activePlayers[socket.id].username) delete sessionTokens[t];
        }

        io.emit('playerDisconnected', socket.id);
        delete activePlayers[socket.id];
    });
});

// ────────────────────────────────────────────────
//          HTTP – ŞİFRE SIFIRLAMA
// ────────────────────────────────────────────────
app.get('/status', (req, res) => res.send('Sistem çalışıyor'));

app.get('/reset-password', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token gerekli');

    const data = passwordResetTokens[token];
    if (!data || Date.now() > data.expires) {
        return res.send('<h2 style="color:#c0392b;text-align:center;padding:100px">Bağlantı geçersiz veya süresi dolmuş.</h2>');
    }

    res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Şifre Sıfırla - Survival Evolution</title>
  <style>
    body{background:#0a0806;color:#e8d8a0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
    .container{background:#1c1508;border:1px solid #3a2a10;border-radius:8px;padding:40px;width:380px;text-align:center;}
    h2{color:#c9a84c;margin-bottom:30px;}
    input{width:100%;padding:14px;margin:10px 0;background:#0f0b07;border:1px solid #4a3614;color:#e8d8a0;border-radius:4px;font-size:16px;box-sizing:border-box;}
    button{width:100%;padding:14px;margin-top:15px;background:linear-gradient(#4a3614,#2a1e0b);border:1px solid #7a5c1e;color:#ffd070;font-size:16px;letter-spacing:1px;cursor:pointer;border-radius:4px;}
    .msg{padding:12px;margin:15px 0;border-radius:4px;display:none;}
    .error{background:#c0392b33;border:1px solid #c0392b;color:#e74c3c;}
    .success{background:#27ae6033;border:1px solid #27ae60;color:#2ecc71;}
  </style>
</head>
<body>
<div class="container">
  <h2>⚔️ Şifre Sıfırlama</h2>
  <div id="msg" class="msg"></div>
  <input type="password" id="p1" placeholder="Yeni şifre" autocomplete="new-password">
  <input type="password" id="p2" placeholder="Şifreyi tekrar girin" autocomplete="new-password">
  <button onclick="resetPassword()">Şifreyi Güncelle</button>
</div>

<script>
const token = "${token.replace(/"/g,'\\"')}";

async function resetPassword() {
  const msg = document.getElementById('msg');
  const pass1 = document.getElementById('p1').value.trim();
  const pass2 = document.getElementById('p2').value.trim();

  if (!pass1 || !pass2) {
    msg.className='msg error'; msg.textContent='Alanlar boş bırakılamaz.'; msg.style.display='block'; return;
  }
  if (pass1 !== pass2) {
    msg.className='msg error'; msg.textContent='Şifreler eşleşmiyor.'; msg.style.display='block'; return;
  }
  if (pass1.length < 6) {
    msg.className='msg error'; msg.textContent='Şifre en az 6 karakter olmalı.'; msg.style.display='block'; return;
  }

  try {
    const res = await fetch('/reset-password', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({token, password: pass1})
    });
    const data = await res.json();

    if (data.success) {
      msg.className='msg success';
      msg.textContent='Şifre güncellendi! Ana sayfaya yönlendiriliyorsunuz...';
      msg.style.display='block';
      setTimeout(() => location.href = '/', 2200);
    } else {
      msg.className='msg error';
      msg.textContent = data.error || 'Hata oluştu.';
      msg.style.display='block';
    }
  } catch(e) {
    msg.className='msg error';
    msg.textContent = 'Sunucuyla bağlantı kurulamadı.';
    msg.style.display='block';
  }
}
</script>
</body>
</html>
    `);
});

app.post('/reset-password', (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.json({success:false, error:'Eksik veri'});

    const data = passwordResetTokens[token];
    if (!data) return res.json({success:false, error:'Geçersiz token'});
    if (Date.now() > data.expires) {
        delete passwordResetTokens[token];
        return res.json({success:false, error:'Token süresi dolmuş'});
    }

    let users = {};
    try {
        users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
        if (!users[data.username]) throw new Error('Kullanıcı yok');
        users[data.username].password = password;
        fs.writeFileSync(playersDataPath, JSON.stringify(users, null, 2));
        delete passwordResetTokens[token];
        res.json({success:true});
    } catch (err) {
        console.error(err);
        res.json({success:false, error:'Sunucu hatası'});
    }
});

// ────────────────────────────────────────────────
//          BAŞLATMA
// ────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
    console.log(`Discord bot hazır → ${client.user.tag}`);
});

client.login(process.env.token).catch(console.error);

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});