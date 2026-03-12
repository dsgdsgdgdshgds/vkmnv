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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// PORT Tanımı - Sadece bir kez tanımlanmalıdır
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────
// KALICI DİSK YOLLARI
// ────────────────────────────────────────────────
// Render gibi platformlarda /var/data kullanılır, yerelde çalıştırıyorsanız bu klasörü oluşturun.
const baseDataPath = '/var/data';
const dbPath = path.join(baseDataPath, 'kanal-ayar.json');
const cooldownPath = path.join(baseDataPath, 'partner-cooldowns.json');
const playersDataPath = path.join(baseDataPath, 'players_db.json');

// Klasör ve Dosyaların Kontrolü
if (!fs.existsSync(baseDataPath)) {
    try {
        fs.mkdirSync(baseDataPath, { recursive: true });
    } catch (e) {
        // Eğer /var/data izni yoksa çalışma dizinine oluşturur
        console.warn("Kalıcı disk yolu bulunamadı, yerel dizin kullanılıyor.");
    }
}

[dbPath, cooldownPath, playersDataPath].forEach(p => {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(p)) {
        fs.writeFileSync(p, JSON.stringify({}, null, 2), 'utf8');
    }
});

// ────────────────────────────────────────────────
// DATABASE YARDIMCI FONKSİYONLARI
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
        return null; 
    }
}

function getCooldowns() {
    try { return JSON.parse(fs.readFileSync(cooldownPath, 'utf8')); }
    catch (err) { return {}; }
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
// DISCORD BOT OLAYLARI
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
        if (!target) return message.reply('⚠️ Bir rol etiketleyin');
        dbSet(`hedefRol_${message.guild.id}`, target.id);
        return message.reply(`✅ Partner yetkili rolü ayarlandı`);
    }

    if (prefix === '#partner-sistem') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketleyin');
        dbSet(`sistemKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Başvuru butonu kanalı ayarlandı`);
    }

    if (prefix === '#partner-kanal') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketleyin');
        dbSet(`reklamKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Tanıtım gönderim kanalı ayarlandı`);
    }

    if (prefix === '#partner-log') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketleyin');
        dbSet(`logKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Log kanalı ayarlandı`);
    }

    if (prefix === '#partner-mesaj') {
        if (!args.trim()) return message.reply('⚠️ Mesaj içeriği yazmalısınız');
        dbSet(`davetMesaji_${message.guild.id}`, args);
        return message.reply(`✅ Davet mesajı kaydedildi`);
    }

    if (prefix === '#partner-bekleme') {
        if (!args.trim()) {
            const current = dbGet(`cooldown_${message.guild.id}`) || "ayarlanmamış";
            return message.reply(`Mevcut bekleme süresi: **${current}**`);
        }
        if (args === '0') {
            dbSet(`cooldown_${message.guild.id}`, null);
            return message.reply('✅ Bekleme süresi kapatıldı.');
        }
        const ms = parseDuration(args);
        if (ms < 1000) return message.reply('❌ Geçersiz süre formatı.');
        dbSet(`cooldown_${message.guild.id}`, args);
        return message.reply(`✅ Bekleme süresi **${args}** olarak ayarlandı.`);
    }

    const hedefRolId = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRolId && message.mentions.roles.has(hedefRolId)) {
        const sistemKanalId = dbGet(`sistemKanal_${message.guild.id}`);
        if (!sistemKanalId || message.channel.id !== sistemKanalId) return;

        const embed = new EmbedBuilder()
            .setTitle('🤝 Partnerlik Başvurusu')
            .setDescription(`Partnerlik başvurusu yapmak için aşağıdaki butona tıklayın.\n<@${message.author.id}>`)
            .setColor('#00D166');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('p_basvuru').setLabel('Başvuru Yap').setStyle(ButtonStyle.Success)
        );
        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder().setCustomId('p_modal').setTitle('Partnerlik Başvurusu');
        const input = new TextInputBuilder()
            .setCustomId('p_text')
            .setLabel('Sunucu Tanıtım Metni')
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
            const now = Date.now();
            const userUntil = getUserCooldownUntil(userId, guildId);
            if (userUntil > now) {
                return interaction.editReply({ 
                    content: `⏳ Beklemen gerekiyor: **${formatRemaining(userUntil - now)}**`,
                    ephemeral: true 
                });
            }
        }

        const text = interaction.fields.getTextInputValue('p_text');
        const reklamKanalId = dbGet(`reklamKanal_${guildId}`);
        const logKanalId = dbGet(`logKanal_${guildId}`);
        const davetMesaji = dbGet(`davetMesaji_${guildId}`);

        if (!davetMesaji) return interaction.editReply({ content: '❌ Davet mesajı ayarlanmamış.' });

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
                    .setDescription(`**Kullanıcı:** ${interaction.user}`)
                    .setTimestamp();
                await ch.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }

        if (cooldownStr && cooldownStr !== '0') {
            const ms = parseDuration(cooldownStr);
            if (ms > 0) setUserCooldown(userId, guildId, Date.now() + ms);
        }

        await interaction.editReply({ content: davetMesaji });
    }
});

// ────────────────────────────────────────────────
// EXPRESS / SOCKET.IO SUNUCUSU
// ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: 'atlaswarfare.com@gmail.com', 
        pass: 'actd oipe dhmi dyvi' 
    }
});

const sessionTokens = {}; 
const pendingVerifications = {}; 
let activePlayers = {};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateVerifyCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function sendEmail(to, subject, body) {
    const mailOptions = {
        from: '"Survival Evolution" <atlaswarfare.com@gmail.com>',
        to: to,
        subject: subject,
        text: body
    };
    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error(`E-posta hatası:`, error);
    }
}

io.on('connection', (socket) => {
    socket.on('loginWithToken', (token) => {
        const username = sessionTokens[token];
        if (!username) return socket.emit('loginError', 'Oturum geçersiz.');

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        if (!allUsers[username]) return socket.emit('loginError', 'Hesap bulunamadı.');

        activePlayers[socket.id] = { ...allUsers[username], id: socket.id };
        socket.emit('loginSuccess', { token, username });
    });

    socket.on('register', (data) => {
        const { username, email, password } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        if (allUsers[username]) return socket.emit('loginError', 'Bu ad alınmış.');

        const code = generateVerifyCode();
        pendingVerifications[username] = {
            code, email, password,
            userData: { username, email, password, hp: 100, inventory: {}, verified: false }
        };

        sendEmail(email, 'Doğrulama Kodu', `Kodunuz: ${code}`);
        socket.emit('registerSuccess', { username });
    });

    socket.on('verifyEmail', (data) => {
        const { username, code } = data;
        const pending = pendingVerifications[username];

        if (!pending || pending.code !== code) return socket.emit('loginError', 'Kod hatalı.');

        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }

        pending.userData.verified = true;
        allUsers[username] = pending.userData;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        
        const token = generateToken();
        sessionTokens[token] = username;
        socket.emit('verifySuccess');
        socket.emit('loginSuccess', { token, username });
    });
});

// Bot ve Sunucuyu Başlat
server.listen(PORT, () => {
    console.log(`Web Sunucu ${PORT} portunda aktif.`);
});

client.login(process.env.token);