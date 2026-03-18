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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ────────────────────────────────────────────────
// KALICI DİSK VE VERİ YOLLARI
// ────────────────────────────────────────────────
const dbPath = '/var/data/kanal-ayar.json';
const cooldownPath = '/var/data/partner-cooldowns.json';
const playersDataPath = path.join(__dirname, 'players.json');

if (!fs.existsSync('/var/data')) {
    try { fs.mkdirSync('/var/data', { recursive: true }); } catch (e) {}
}

// ────────────────────────────────────────────────
// NODEMAILER (GMAIL UYGULAMA ŞİFRESİ İLE)
// ────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'atlaswarfare.com@gmail.com',
        pass: process.env.google // 16 haneli Gmail Uygulama Şifresi buraya gelmeli
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
        if (error) console.log('❌ E-posta Hatası:', error);
        else console.log('📧 E-posta Gönderildi: ' + info.response);
    });
}

// ────────────────────────────────────────────────
// DISCORD PARTNER SİSTEMİ FONKSİYONLARI
// ────────────────────────────────────────────────
function dbSet(key, value) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (err) {}
    data[key] = value;
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function dbGet(key) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        return data[key] ?? null;
    } catch (err) { return null; }
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
            .setColor('#c9a84c')
            .addFields(
                { name: '#partner-yetkili @rol', value: 'Yetkili rolü ayarlar', inline: true },
                { name: '#partner-sistem #kanal', value: 'Başvuru kanalını ayarlar', inline: true },
                { name: '#partner-kanal #kanal', value: 'Reklam kanalını ayarlar', inline: true },
                { name: '#partner-mesaj [mesaj]', value: 'Davet metnini ayarlar' }
            );
        return message.channel.send({ embeds: [embed] });
    }

    // Ayar Komutları
    if (prefix === '#partner-yetkili') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply('❌ Rol etiketle!');
        dbSet(`hedefRol_${message.guild.id}`, role.id);
        return message.reply('✅ Rol ayarlandı.');
    }

    if (prefix === '#partner-sistem') {
        const chan = message.mentions.channels.first();
        if (!chan) return message.reply('❌ Kanal etiketle!');
        dbSet(`sistemKanal_${message.guild.id}`, chan.id);
        return message.reply('✅ Başvuru kanalı ayarlandı.');
    }

    // Başvuru Butonu Gönderme (Eğer etiketlenen rol ise)
    const hedefRolId = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRolId && message.mentions.roles.has(hedefRolId)) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('p_basvuru').setLabel('🤝 Partnerlik Başvurusu').setStyle(ButtonStyle.Success)
        );
        message.channel.send({ content: 'Partnerlik yapmak için butona tıklayın!', components: [row] });
    }
});

// ────────────────────────────────────────────────
// OYUN VE WEB MANTIĞI
// ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessionTokens = {}; 
const pendingVerifications = {}; 
const passwordResetTokens = {};  
let activePlayers = {};

io.on('connection', (socket) => {
    
    // KAYIT (Register)
    socket.on('register', (data) => {
        const { username, email, password } = data;
        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        
        if (users[username]) return socket.emit('loginError', 'Bu isim zaten kullanımda.');

        const code = String(Math.floor(100000 + Math.random() * 900000));
        pendingVerifications[username] = {
            code, email, password,
            userData: { username, email, password, x: 0, y: 0, z: 0, hp: 100, inventory: { wood: 0, stone: 0, sword: 0, pickaxe: 0, axe: 0 }, verified: false }
        };

        sendEmail(email, '⚔️ Survival Evolution Doğrulama', `Hoş geldin ${username}!\n\nDoğrulama kodun: ${code}`);
        socket.emit('registerSuccess', { username });
    });

    // DOĞRULAMA (Verify)
    socket.on('verifyEmail', (data) => {
        const { username, code } = data;
        const pending = pendingVerifications[username];
        if (!pending || pending.code !== code) return socket.emit('loginError', 'Kod hatalı.');

        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        pending.userData.verified = true;
        users[username] = pending.userData;
        fs.writeFileSync(playersDataPath, JSON.stringify(users, null, 2));
        
        delete pendingVerifications[username];
        socket.emit('verifySuccess');
    });

    // GİRİŞ (Login)
    socket.on('login', (data) => {
        const { username, password } = data;
        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        const user = users[username];

        if (!user || user.password !== password) return socket.emit('loginError', 'Giriş bilgileri hatalı.');
        if (!user.verified) return socket.emit('loginError', 'Lütfen önce e-postanızı doğrulayın.');

        const token = crypto.randomBytes(32).toString('hex');
        sessionTokens[token] = username;
        activePlayers[socket.id] = { ...user, id: socket.id };
        
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', user.inventory);
        socket.emit('currentPlayers', activePlayers);
        socket.broadcast.emit('newPlayer', activePlayers[socket.id]);
    });

    // ŞİFREMİ UNUTTUM
    socket.on('forgotPassword', (data) => {
        const { email } = data;
        let users = {};
        try { users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) {}
        const user = Object.values(users).find(u => u.email === email);
        
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            passwordResetTokens[token] = { username: user.username, expires: Date.now() + 1800000 };
            const link = `http://atlaswarfare.com:3000/reset-password?token=${token}`;
            sendEmail(email, '⚔️ Şifre Sıfırlama', `Şifrenizi sıfırlamak için tıklayın: ${link}`);
        }
        socket.emit('forgotPasswordSent');
    });

    // OYUN İÇİ MEKANİKLER (Toplama & Hareket)
    socket.on('playerMovement', (data) => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].x = data.x;
            activePlayers[socket.id].z = data.z;
            activePlayers[socket.id].rotationY = data.rotationY;
            socket.broadcast.emit('playerMoved', activePlayers[socket.id]);
        }
    });

    socket.on('collect', (type) => {
        const p = activePlayers[socket.id];
        if (p && p.inventory[type] !== undefined) {
            p.inventory[type]++;
            socket.emit('updateInventory', p.inventory);
        }
    });

    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            let users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
            users[activePlayers[socket.id].username].inventory = activePlayers[socket.id].inventory;
            fs.writeFileSync(playersDataPath, JSON.stringify(users, null, 2));
            delete activePlayers[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

// ────────────────────────────────────────────────
// ŞİFRE SIFIRLAMA SAYFALARI (GET/POST)
// ────────────────────────────────────────────────
app.get('/reset-password', (req, res) => {
    const token = req.query.token;
    if (!token || !passwordResetTokens[token] || Date.now() > passwordResetTokens[token].expires) {
        return res.status(400).send('<h1>Bağlantı geçersiz veya süresi dolmuş.</h1>');
    }
    res.send(`
        <!DOCTYPE html><html><head><title>Şifre Sıfırla</title>
        <style>body{background:#0a0806;color:#c9a84c;display:flex;justify-content:center;padding:50px;font-family:sans-serif;}
        .card{background:#1c1710;padding:30px;border:1px solid #7a5c1e;width:300px;text-align:center;}
        input{width:100%;padding:10px;margin:10px 0;background:#000;border:1px solid #7a5c1e;color:#fff;}
        button{background:#c9a84c;border:none;padding:10px 20px;cursor:pointer;font-weight:bold;}</style></head>
        <body><div class="card"><h2>Yeni Şifre</h2><input type="password" id="p" placeholder="Şifre"><button onclick="send()">GÜNCELLE</button><p id="m"></p></div>
        <script>async function send(){
            const p=document.getElementById('p').value;
            const res=await fetch('/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:new URLSearchParams(window.location.search).get('token'),password:p})});
            const d=await res.json(); document.getElementById('m').innerText=d.success?'Başarılı!':'Hata!';
        }</script></body></html>
    `);
});

app.post('/reset-password', (req, res) => {
    const { token, password } = req.body;
    const data = passwordResetTokens[token];
    if (!data || Date.now() > data.expires) return res.json({ success: false });
    
    let users = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
    users[data.username].password = password;
    fs.writeFileSync(playersDataPath, JSON.stringify(users, null, 2));
    delete passwordResetTokens[token];
    res.json({ success: true });
});

// ── BAŞLATMA ──
client.login(process.env.token);
server.listen(PORT, () => console.log(`🚀 Sistem ${PORT} portunda aktif.`));
