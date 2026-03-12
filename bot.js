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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// PORT Tanımı (Render için kritik)
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────
// KALICI DİSK YOLLARI (Render Disk → /var/data)
// ────────────────────────────────────────────────
const dbPath = '/var/data/kanal-ayar.json';
const cooldownPath = '/var/data/partner-cooldowns.json';
const playersDataPath = '/var/data/players_db.json';

// Klasör ve Dosyaların Kontrolü
if (!fs.existsSync('/var/data')) {
    fs.mkdirSync('/var/data', { recursive: true });
}

[dbPath, cooldownPath, playersDataPath].forEach(p => {
    if (!fs.existsSync(p)) {
        fs.writeFileSync(p, JSON.stringify({}, null, 2), 'utf8');
    }
});

// ────────────────────────────────────────────────
// DATABASE YARDIMCI FONKSİYONLARI (1. Koddan Aktarılanlar)
// ────────────────────────────────────────────────
function dbSet(key, value) {
    let data = {};
    try {
        data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (err) { console.error('Ayar JSON okuma hatası:', err); }
    data[key] = value;
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) { console.error('Ayar JSON yazma hatası:', err); }
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

function getCooldowns() {
    try { return JSON.parse(fs.readFileSync(cooldownPath, 'utf8')); }
    catch (err) { console.error('Cooldown JSON okuma hatası:', err); return {}; }
}

function saveCooldowns(cooldowns) {
    try { fs.writeFileSync(cooldownPath, JSON.stringify(cooldowns, null, 2), 'utf8'); }
    catch (err) { console.error('Cooldown JSON yazma hatası:', err); }
}

function setUserCooldown(userId, guildId, untilTimestamp) {
    const cooldowns = getCooldowns();
    const key = `${userId}_${guildId}`; 
    cooldowns[key] = untilTimestamp;
    saveCooldowns(cooldowns);
}

function getUserCooldownUntil(userId, guildId) {
    const cooldowns = getCooldowns();
    const key = `${userId}_${guildId}`;
    return cooldowns[key] || 0;
}

// Süre ve Format Fonksiyonları
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
    if (ms <= 0) return "0 saniye";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} saniye`;
    const m = Math.floor(s / 60); const sn = s % 60;
    if (m < 60) return `${m} dk${sn > 0 ? ` ${sn} sn` : ''}`;
    const h = Math.floor(m / 60); const dk = m % 60;
    if (h < 24) return `${h} saat${dk > 0 ? ` ${dk} dk` : ''}`;
    const d = Math.floor(h / 24); const saat = h % 24;
    return `${d} gün${saat > 0 ? ` ${saat} saat` : ''}`;
}

const KURULUM_SIRASI = `**Önerilen kurulum sırası:**
1. #partner-yetkili @rol  
2. #partner-sistem #kanal  
3. #partner-kanal #kanal  
4. #partner-log #kanal  
5. #partner-mesaj ← bu zorunlu!  
6. #partner-bekleme 30m ← opsiyonel`;

// ────────────────────────────────────────────────
// DISCORD BOT KOMUTLARI (1. Kodun Birebir Kopyası)
// ────────────────────────────────────────────────
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
            new ButtonBuilder().setCustomId('p_basvuru').setLabel('Başvuru Yap').setStyle(ButtonStyle.Success)
        );
        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder().setCustomId('p_modal').setTitle('Partnerlik Başvurusu');
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

        if (cooldownStr && cooldownStr !== '0') {
            const cooldownMs = parseDuration(cooldownStr);
            const now = Date.now();
            const userUntil = getUserCooldownUntil(userId, guildId);
            if (userUntil > now) {
                const remainingText = formatRemaining(userUntil - now);
                return interaction.editReply({ 
                    content: `⏳ Bir sonraki başvurun için **${remainingText}** beklemelisin.\n(Bekleme süresi: ${cooldownStr})`,
                    ephemeral: true 
                });
            }
        }

        const text = interaction.fields.getTextInputValue('p_text');
        const reklamKanalId = dbGet(`reklamKanal_${guildId}`);
        const logKanalId = dbGet(`logKanal_${guildId}`);
        const davetMesaji = dbGet(`davetMesaji_${guildId}`);

        if (!davetMesaji) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF5555')
                .setTitle('❌ Eksik Ayar')
                .setDescription('Sunucu sahibi `#partner-mesaj` komutunu kullanarak davet mesajını ayarlamamış.\nBaşvuru şu an mümkün değil.');
            return interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
        }

        if (reklamKanalId) {
            const ch = interaction.client.channels.cache.get(reklamKanalId);
            if (ch) await ch.send(text).catch(() => {});
        }

        if (logKanalId) {
            const ch = interaction.client.channels.cache.get(logKanalId);
            if (ch) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#00D166')
                    .setTitle('✅ Partnerlik Tamamlandı')
                    .setDescription(`**Kullanıcı:** ${interaction.user}\n**Kullanıcı Adı:** ${interaction.user.tag}\n**Kullanıcı ID:** ${interaction.user.id}\n**Başvuru zamanı:** <t:${Math.floor(Date.now() / 1000)}:F>`)
                    .setTimestamp();
                await ch.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }

        if (cooldownStr && cooldownStr !== '0') {
            const ms = parseDuration(cooldownStr);
            if (ms > 0) setUserCooldown(userId, guildId, Date.now() + ms);
        }

        try {
            await interaction.followUp({ content: davetMesaji, ephemeral: true });
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







const crypto = require('crypto');
const nodemailer = require('nodemailer'); // Eklendi

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const playersDataPath = path.join(__dirname, 'players.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // JSON gövdesi okumak için gerekli

// ── NODEMAILER / SMTP AYARLARI ──
// Burayı kendi e-posta servis bilgilerinize göre doldurun.
const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: 'atlaswarfare.com@gmail.com', // E-posta adresiniz
        pass: 'actd oipe dhmi dyvi'         // Gmail'den aldığınız "Uygulama Şifresi"
    }
});

// ── Token store ──
const sessionTokens = {}; // token -> username

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ── E-posta doğrulama kodları ──
const pendingVerifications = {}; // username -> { code, email, userData }
const passwordResetTokens = {};  // token -> { email, expires }

// ── E-posta gönderici (GÜNCELLENDİ: Gerçek SMTP kullanıyor) ──
async function sendEmail(to, subject, body) {
    console.log(`📧 E-POSTA GÖNDERİLİYOR: ${to}`);
    
    const mailOptions = {
        from: '"Survival Evolution" <GMAIL_ADRESINIZ@gmail.com>',
        to: to,
        subject: subject,
        text: body
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ E-posta başarıyla iletildi.`);
    } catch (error) {
        console.error(`❌ E-posta gönderim hatası:`, error);
    }
}

function generateVerifyCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

let activePlayers = {};

io.on('connection', (socket) => {

    // ════════════════════════════════════════════
    //  TOKEN İLE OTOMATİK GİRİŞ
    // ════════════════════════════════════════════
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

    // ════════════════════════════════════════════
    //  KULLANICI ADI KONTROL
    // ════════════════════════════════════════════
    socket.on('checkUsername', (username) => {
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        socket.emit('usernameAvailable', { available: !allUsers[username] });
    });

    // ════════════════════════════════════════════
    //  KAYIT OL (e-posta doğrulamalı)
    // ════════════════════════════════════════════
    socket.on('register', (data) => {
        const { username, email, password } = data;

        if (!username || username.length < 3 || username.length > 16) {
            socket.emit('loginError', 'Kahraman adı 3-16 karakter arasında olmalıdır.');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            socket.emit('loginError', 'Kahraman adında geçersiz karakter var.');
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

        if (allUsers[username]) {
            socket.emit('loginError', 'Bu kahraman adı zaten alınmış.');
            return;
        }

        const emailUsed = Object.values(allUsers).some(u => u.email === email);
        if (emailUsed) {
            socket.emit('loginError', 'Bu e-posta adresi zaten kayıtlı.');
            return;
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
            '⚔️ Survival Evolution - E-posta Doğrulama',
            `Kahraman ${username}, doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir.`
        );

        setTimeout(() => { delete pendingVerifications[username]; }, 10 * 60 * 1000);
        socket.emit('registerSuccess', { username });
    });

    // ════════════════════════════════════════════
    //  E-POSTA DOĞRULAMA KODU
    // ════════════════════════════════════════════
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

    // ════════════════════════════════════════════
    //  DOĞRULAMA KODUNU TEKRAR GÖNDER
    // ════════════════════════════════════════════
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
    });

    // ════════════════════════════════════════════
    //  GİRİŞ YAP
    // ════════════════════════════════════════════
    socket.on('login', (data) => {
        const { username, password } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        let foundUser = allUsers[username] || Object.values(allUsers).find(u => u.email === username);

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

    // ════════════════════════════════════════════
    //  ŞİFREMİ UNUTTUM
    // ════════════════════════════════════════════
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

        const resetUrl = `http://localhost:${PORT}/reset-password?token=${resetToken}`;

        sendEmail(
            email,
            '⚔️ Survival Evolution - Şifre Sıfırlama',
            `Merhaba ${user.username},\n\nŞifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:\n${resetUrl}\n\nBu bağlantı 30 dakika geçerlidir.`
        );

        setTimeout(() => { delete passwordResetTokens[resetToken]; }, 30 * 60 * 1000);
        socket.emit('forgotPasswordSent');
    });

    // ════════════════════════════════════════════
    //  OYUNCU HAREKETİ VE DİĞER FONKSİYONLAR
    // ════════════════════════════════════════════
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

    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            try {
                let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
                const p = activePlayers[socket.id];
                allUsers[p.username].inventory = p.inventory;
                allUsers[p.username].x = p.x || 0;
                allUsers[p.username].y = p.y || 0;
                allUsers[p.username].z = p.z || 0;
                allUsers[p.username].hp = p.hp;
                fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
            } catch (e) {}
            delete activePlayers[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

// ════════════════════════════════════════════
//  HTTP ENDPOINTS
// ════════════════════════════════════════════
app.get('/status', (req, res) => res.send('Sistem Aktif!'));

app.get('/reset-password', (req, res) => {
    const { token } = req.query;
    const resetData = passwordResetTokens[token];

    if (!resetData || Date.now() > resetData.expires) {
        return res.send(`<html><body style="background:#0a0806;color:#c9a84c;text-align:center;padding:60px"><h2>⚠️ Bağlantı geçersiz.</h2></body></html>`);
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
                h2 { color:#c9a84c; text-align:center; }
                input { width:100%; padding:12px; background:#0a0806; border:1px solid #3a2a10; color:#e8d8a0; border-radius:3px; margin-bottom:14px; box-sizing:border-box; }
                button { width:100%; padding:13px; background:#3a2a0a; border:1px solid #7a5c1e; color:#f0d080; cursor:pointer; }
            </style>
        </head>
        <body>
        <div class="box">
            <h2>⚔️ Şifre Sıfırla</h2>
            <input type="password" id="pass1" placeholder="Yeni şifre">
            <input type="password" id="pass2" placeholder="Şifreyi tekrar edin">
            <button onclick="doReset()">🔑 ŞİFREYİ GÜNCELLE</button>
        </div>
        <script>
            async function doReset() {
                const p1 = document.getElementById('pass1').value;
                const p2 = document.getElementById('pass2').value;
                if (p1 !== p2) { alert('Şifreler uyuşmuyor'); return; }
                const res = await fetch('/reset-password', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ token: '${token}', password: p1 })
                });
                const data = await res.json();
                if (data.success) { alert('Şifre başarıyla güncellendi!'); window.location.href = '/'; }
                else { alert(data.error || 'Hata oluştu.'); }
            }
        </script>
        </body></html>
    `);
});

app.post('/reset-password', (req, res) => {
    const { token, password } = req.body;
    const resetData = passwordResetTokens[token];

    if (!resetData || Date.now() > resetData.expires) {
        return res.json({ success: false, error: 'Bağlantı geçersiz.' });
    }

    try {
        let allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8'));
        allUsers[resetData.username].password = password;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete passwordResetTokens[token];
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: 'Sunucu hatası.' });
    }
});

server.listen(PORT, () => {
    console.log(`[✓] Sunucu Port ${PORT} üzerinde aktif.`);
});