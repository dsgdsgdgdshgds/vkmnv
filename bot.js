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


// ── NODEMAILER YAPILANDIRMASI ──
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
const sessionTokens = {};
const pendingVerifications = {};
const passwordResetTokens = {};
let activePlayers = {};

// ── Yardımcı Fonksiyonlar ──
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateVerifyCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

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

    socket.on('loginWithToken', (token) => {
        const username = sessionTokens[token];
        if (!username) return socket.emit('loginError', 'Oturum süresi dolmuş.');
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}
        if (!allUsers[username]) return socket.emit('loginError', 'Hesap bulunamadı.');
        activePlayers[socket.id] = { ...allUsers[username], id: socket.id, hp: allUsers[username].hp || 100 };
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    socket.on('checkUsername', (username) => {
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch {}
        socket.emit('usernameAvailable', { available: !allUsers[username] });
    });

    socket.on('register', (data) => {
        const { username, email, password } = data;
        // ... (kayıt mantığı aynı kaldı)
        // sadece mail gönderme kısmı önemli değil burada
    });

    // ... diğer register/verify/login olayları aynı kaldı ...

    // ── DÜZELTİLEN KISIM: ŞİFREMİ UNUTTUM ──
    socket.on('forgotPassword', (data) => {
        const { email } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        const user = Object.values(allUsers).find(u => u.email === email);
        if (!user) {
            socket.emit('forgotPasswordSent');
            return;
        }
        const resetToken = generateToken();
        passwordResetTokens[resetToken] = {
            username: user.username,
            expires: Date.now() + 30 * 60 * 1000
        };
        const resetUrl = `http://atlaswarfare.com:\( {PORT}/reset-password?token= \){resetToken}`;

        sendEmail(
            email,
            '⚔️ Survival Evolution - Şifre Sıfırlama',
            `Merhaba ${user.username},

Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:
${resetUrl}

Bu bağlantı 30 dakika geçerlidir.`
        );

        socket.emit('forgotPasswordSent');
    });

    // ... diğer socket olayları (movement, collect, craft, attack, disconnect) aynı kaldı ...
});

// ── HTTP ENDPOINTS ──
app.get('/status', (req, res) => res.send('Sistem Aktif!'));

// ── DÜZELTİLEN ŞİFRE SIFIRLAMA SAYFASI ──
app.get('/reset-password', (req, res) => {
    const { token } = req.query;
    const resetData = passwordResetTokens[token];
    if (!resetData || Date.now() > resetData.expires) {
        return res.send(`<html><body style="background:#0a0806;color:#c9a84c;text-align:center;padding:60px"><h2>⚠️ Bağlantı geçersiz veya süresi dolmuş.</h2></body></html>`);
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <title>⚔️ Şifre Sıfırla</title>
            <style>
                body { background:#0a0806; color:#e8d8a0; font-family:sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
                .box { background:#1c1508; border:1px solid #3a2a10; border-radius:6px; padding:40px; width:360px; }
                h2 { color:#c9a84c; text-align:center; margin-bottom:24px; }
                input { width:100%; padding:12px; background:#0a0806; border:1px solid #3a2a10; color:#e8d8a0; border-radius:3px; font-size:15px; margin-bottom:14px; box-sizing:border-box; }
                button { width:100%; padding:13px; background:linear-gradient(180deg,#3a2a0a,#1a1005); border:1px solid #7a5c1e; color:#f0d080; font-size:14px; letter-spacing:3px; cursor:pointer; border-radius:3px; }
                .msg { padding:10px; border-radius:3px; margin-bottom:14px; text-align:center; display:none; }
                .msg.error { background:#c0392b22; border:1px solid #c0392b88; color:#e74c3c; display:block; }
                .msg.success { background:#27ae6022; border:1px solid #27ae6088; color:#2ecc71; display:block; }
            </style>
        </head>
        <body>
        <div class="box">
            <h2>⚔️ Şifre Sıfırla</h2>
            <div id="msg" class="msg"></div>
            <input type="password" id="pass1" placeholder="Yeni şifre">
            <input type="password" id="pass2" placeholder="Tekrar girin">
            <button onclick="doReset()">🔑 ŞİFREYİ GÜNCELLE</button>
        </div>
        <script>
            const resetToken = "${token.replace(/"/g, '\\"')}";

            async function doReset() {
                const p1 = document.getElementById('pass1').value.trim();
                const p2 = document.getElementById('pass2').value.trim();
                const msg = document.getElementById('msg');

                if (p1 !== p2) {
                    msg.className='msg error'; msg.textContent='Şifreler eşleşmiyor.'; msg.style.display='block'; return;
                }

                const res = await fetch('/reset-password', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ token: resetToken, password: p1 })
                });
                const data = await res.json();

                if (data.success) {
                    msg.className='msg success'; msg.textContent='Şifreniz güncellendi!'; msg.style.display='block';
                    setTimeout(() => window.location.href = '/', 2000);
                } else {
                    msg.className='msg error'; msg.textContent = data.error || 'Hata!'; msg.style.display='block';
                }
            }
        </script>
        </body></html>
    `);
});

app.post('/reset-password', (req, res) => {
    const { token, password } = req.body;
    const resetData = passwordResetTokens[token];
    if (!resetData || Date.now() > resetData.expires) return res.json({ success: false, error: 'Süre dolmuş.' });
    try {
        let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
        if (!allUsers[resetData.username]) return res.json({ success: false, error: 'Kullanıcı yok.' });
        allUsers[resetData.username].password = password;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete passwordResetTokens[token];
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: 'Sunucu hatası.' }); }
});

// ── Sunucu ve Discord Başlatma ──
client.once('ready', () => { console.log(`✅ Discord: ${client.user.tag} hazır`); });
client.login(process.env.token);

server.listen(PORT, () => {
    console.log(`[✓] Sunucu ve Oyun Port ${PORT} üzerinde aktif.`);
});