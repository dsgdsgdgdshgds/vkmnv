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
require('dotenv').config();

// ────────────────────────────────────────────────
// GENEL AYARLAR VE SUNUCU
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

let DATA_DIR = process.env.DATA_DIR || '/var/data';
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (err) {
    console.error(`⚠️ "${DATA_DIR}" klasörüne yazılamıyor (${err.code}).`);
    DATA_DIR = path.join(__dirname, 'data');
    console.error(`⚠️ Bunun yerine "${DATA_DIR}" kullanılıyor.`);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
const dbPath = path.join(DATA_DIR, 'kanal-ayar.json');
const cooldownPath = path.join(DATA_DIR, 'partner-cooldowns.json');
const playersDataPath = path.join(DATA_DIR, 'players.json');
const marketPath = path.join(DATA_DIR, 'market.json');

if (!fs.existsSync(playersDataPath)) fs.writeFileSync(playersDataPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(marketPath)) fs.writeFileSync(marketPath, JSON.stringify({
    items: [
        { id: 'health_potion', name: 'Can İksiri', price: 50, type: 'consumable', effect: 30 },
        { id: 'chakra_potion', name: 'Chakra İksiri', price: 40, type: 'consumable', effect: 50 },
        { id: 'katana', name: 'Katana', price: 200, type: 'weapon', damage: 15 },
        { id: 'shuriken_pack', name: 'Shuriken Seti', price: 80, type: 'weapon', damage: 8 },
        { id: 'armor_light', name: 'Hafif Zırh', price: 150, type: 'armor', defense: 5 },
        { id: 'armor_heavy', name: 'Ağır Zırh', price: 350, type: 'armor', defense: 12 },
        { id: 'scroll_fire', name: 'Ateş Fırlatma Fermanı', price: 500, type: 'jutsu_scroll', jutsu: 'fireball' },
        { id: 'scroll_water', name: 'Su Köpüğü Fermanı', price: 500, type: 'jutsu_scroll', jutsu: 'water_bullet' },
        { id: 'exp_boost', name: 'XP Takviyesi', price: 100, type: 'boost', effect: 50 }
    ]
}, null, 2));

// ────────────────────────────────────────────────
// YARDIMCI FONKSİYONLAR
// ────────────────────────────────────────────────
function dbSet(key, value) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (err) {}
    data[key] = value;
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
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
    fs.writeFileSync(cooldownPath, JSON.stringify(cooldowns, null, 2), 'utf8');
}

function setUserCooldown(userId, guildId, untilTimestamp) {
    const cooldowns = getCooldowns();
    cooldowns[`${userId}_${guildId}`] = untilTimestamp;
    saveCooldowns(cooldowns);
}

function getUserCooldownUntil(userId, guildId) {
    return getCooldowns()[`${userId}_${guildId}`] || 0;
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
    return `${Math.floor(m / 60)} saat`;
}

function hashPassword(plain) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const check = crypto.scryptSync(plain, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function publicPlayer(p) {
    if (!p) return p;
    const { password, ...safe } = p;
    return safe;
}

function publicPlayers(all) {
    const out = {};
    for (const id of Object.keys(all)) out[id] = publicPlayer(all[id]);
    return out;
}

// ────────────────────────────────────────────────
// JUTSU SİSTEMİ
// ────────────────────────────────────────────────
const JUTSU_TYPES = {
    fire: { name: 'Ateş', baseDamage: 25, color: '#e2543a', glow: '#ffcf6b', element: 'ateş' },
    water: { name: 'Su', baseDamage: 22, color: '#3aa0e2', glow: '#bdf0ff', element: 'su' },
    lightning: { name: 'Şimşek', baseDamage: 28, color: '#e2d23a', glow: '#fff7bd', element: 'şimşek' },
    wind: { name: 'Rüzgâr', baseDamage: 20, color: '#7fe2b0', glow: '#e6fff2', element: 'rüzgâr' },
    earth: { name: 'Toprak', baseDamage: 24, color: '#a3703f', glow: '#e6c79a', element: 'toprak' }
};

function getJutsuDamage(jutsuType, level) {
    const base = JUTSU_TYPES[jutsuType]?.baseDamage || 20;
    return Math.floor(base + (level - 1) * 3 + Math.random() * 5);
}

function getRequiredXp(level) {
    return Math.floor(100 * Math.pow(1.5, level - 1));
}

function levelUpCheck(player) {
    let leveled = false;
    while (player.xp >= getRequiredXp(player.level)) {
        player.xp -= getRequiredXp(player.level);
        player.level += 1;
        player.maxHp = 100 + (player.level - 1) * 15;
        player.hp = player.maxHp;
        leveled = true;
    }
    return leveled;
}

// ────────────────────────────────────────────────
// CANAVAR (MOB) SİSTEMİ
// ────────────────────────────────────────────────
const MOB_TYPES = [
    { id: 'zombie', name: 'Zombi Shinobi', hp: 60, damage: 8, xp: 15, gold: 10, color: '#5a7a5a', level: 1, speed: 40 },
    { id: 'bandit', name: 'Çete Üyesi', hp: 80, damage: 12, xp: 25, gold: 18, color: '#8b4513', level: 2, speed: 50 },
    { id: 'rogue_ninja', name: 'Haydut Ninja', hp: 120, damage: 18, xp: 40, gold: 30, color: '#4a0080', level: 3, speed: 55 },
    { id: 'summon_snake', name: 'Yılan Çağrısı', hp: 150, damage: 22, xp: 55, gold: 45, color: '#2d5a27', level: 4, speed: 45 },
    { id: 'puppet', name: 'Kukla Savaşçı', hp: 100, damage: 15, xp: 35, gold: 25, color: '#8b7355', level: 3, speed: 35 },
    { id: 'dark_ninja', name: 'Karanlık Shinobi', hp: 200, damage: 28, xp: 80, gold: 60, color: '#1a1a2e', level: 5, speed: 60 },
    { id: 'beast', name: 'Vahşi Canavar', hp: 250, damage: 32, xp: 100, gold: 80, color: '#8b0000', level: 6, speed: 50 },
    { id: 'boss_akatsuki', name: 'Kırmızı Pelerinli', hp: 500, damage: 45, xp: 250, gold: 200, color: '#ff0000', level: 10, speed: 45 }
];

let mobs = [];
const WORLD_SIZE = 2000;
const MOB_COUNT = 35;
const MOB_RESPAWN_TIME = 15000;

function spawnMob() {
    const type = MOB_TYPES[Math.floor(Math.random() * MOB_TYPES.length)];
    const x = (Math.random() - 0.5) * WORLD_SIZE;
    const z = (Math.random() - 0.5) * WORLD_SIZE;
    return {
        id: crypto.randomUUID(),
        type: type.id,
        name: type.name,
        x: x,
        z: z,
        hp: type.hp,
        maxHp: type.hp,
        damage: type.damage,
        xp: type.xp,
        gold: type.gold,
        color: type.color,
        level: type.level,
        speed: type.speed,
        alive: true,
        targetId: null,
        lastAttack: 0,
        hitFlash: 0
    };
}

function initMobs() {
    mobs = [];
    for (let i = 0; i < MOB_COUNT; i++) {
        mobs.push(spawnMob());
    }
}

function updateMobs(dt) {
    const now = Date.now();
    mobs.forEach(mob => {
        if (!mob.alive) return;

        // En yakın oyuncuyu bul
        let nearest = null;
        let nearestDist = 250;
        Object.values(activePlayers).forEach(p => {
            const dist = Math.hypot(p.x - mob.x, p.z - mob.z);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = p;
            }
        });

        if (nearest) {
            mob.targetId = nearest.id;
            const dx = nearest.x - mob.x;
            const dz = nearest.z - mob.z;
            const dist = Math.hypot(dx, dz);

            if (dist > 35) {
                mob.x += (dx / dist) * mob.speed * dt;
                mob.z += (dz / dist) * mob.speed * dt;
            } else if (now - mob.lastAttack > 1200) {
                // Saldır
                mob.lastAttack = now;
                const p = activePlayers[nearest.id];
                if (p) {
                    const def = p.equipped?.armor?.defense || 0;
                    const dmg = Math.max(1, mob.damage - def);
                    p.hp -= dmg;
                    if (p.hp <= 0) {
                        p.hp = p.maxHp;
                        p.x = 0; p.z = 0;
                        io.emit('playerMoved', publicPlayer(p));
                    }
                    io.emit('hpUpdate', { id: nearest.id, hp: p.hp, maxHp: p.maxHp, source: 'mob', mobName: mob.name, damage: dmg });
                }
            }
        }

        if (mob.hitFlash > 0) mob.hitFlash -= dt;
    });
}

setInterval(() => {
    updateMobs(1/20);
    io.emit('mobUpdate', mobs.filter(m => m.alive).map(m => ({
        id: m.id, x: m.x, z: m.z, hp: m.hp, maxHp: m.maxHp,
        type: m.type, name: m.name, color: m.color, level: m.level, hitFlash: m.hitFlash > 0
    })));
}, 50);

// Ölen canavarları respawn et
setInterval(() => {
    const deadCount = mobs.filter(m => !m.alive).length;
    for (let i = 0; i < deadCount; i++) {
        setTimeout(() => {
            const idx = mobs.findIndex(m => !m.alive);
            if (idx !== -1) mobs[idx] = spawnMob();
        }, MOB_RESPAWN_TIME + Math.random() * 5000);
    }
}, MOB_RESPAWN_TIME);

// ────────────────────────────────────────────────
// NPC / MARKET SİSTEMİ
// ────────────────────────────────────────────────
const NPCS = [
    { id: 'merchant', name: 'Tüccar Taro', x: 200, z: 200, type: 'market', color: '#d4a843' },
    { id: 'blacksmith', name: 'Demirci Ken', x: -200, z: 150, type: 'blacksmith', color: '#8b4513' },
    { id: 'healer', name: 'Şifacı Mei', x: 150, z: -200, type: 'healer', color: '#4ce0c4' }
];

// ────────────────────────────────────────────────
// MESAJ KOMUTLARI (Discord)
// ────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const prefix = message.content.trim().split(/ +/)[0].toLowerCase();
    const args = message.content.trim().split(/ +/).slice(1).join(' ');

    if (prefix === '#yardım') {
        const embed = new EmbedBuilder()
            .setTitle('Survival Evolution Komutları')
            .setColor('#00D166')
            .addFields(
                { name: '#partner-yetkili @rol', value: 'Yetkili rolü', inline: true },
                { name: '#partner-sistem #kanal', value: 'Başvuru kanalı', inline: true },
                { name: '#partner-kanal #kanal', value: 'Reklam kanalı', inline: true },
                { name: '#partner-log #kanal', value: 'Log kanalı', inline: true },
                { name: '#partner-mesaj [mesaj]', value: 'Davet metni', inline: false },
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
// NODEMAILER
// ────────────────────────────────────────────────
const MAIL_FROM_NAME = 'Survival Evolution';
const MAIL_USER = process.env.EMAIL_USER || 'atlaswarfare.com@gmail.com';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USER, pass: process.env.google }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.error('⚠️ SESSION_SECRET ortam değişkeni ayarlı değil.');
}

function signToken(username) {
    const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + 90 * 24 * 60 * 60 * 1000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    return payload + '.' + sig;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    if (sig !== expectedSig) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (Date.now() > data.exp) return null;
        return data.u;
    } catch (e) { return null; }
}

const pendingVerifications = {};
const passwordResetCodes = {};
let activePlayers = {};

function generateVerifyCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function sendEmail(to, subject, body) {
    const mailOptions = {
        from: `"${MAIL_FROM_NAME}" <${MAIL_USER}>`,
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
// SOCKET.IO - OYUN & KULLANICI SİSTEMİ
// ────────────────────────────────────────────────

initMobs();

io.on('connection', (socket) => {

    socket.on('loginWithToken', (token) => {
        const username = verifyToken(token);
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
        // Yeni alanları ekle (eski hesaplar için)
        if (!allUsers[username].level) allUsers[username].level = 1;
        if (!allUsers[username].xp) allUsers[username].xp = 0;
        if (!allUsers[username].gold) allUsers[username].gold = 0;
        if (!allUsers[username].maxHp) allUsers[username].maxHp = 100;
        if (!allUsers[username].jutsuType) allUsers[username].jutsuType = ['fire','water','lightning','wind','earth'][Math.floor(Math.random()*5)];
        if (!allUsers[username].equipped) allUsers[username].equipped = {};
        if (!allUsers[username].consumables) allUsers[username].consumables = [];

        activePlayers[socket.id] = {
            ...allUsers[username],
            id: socket.id,
            hp: allUsers[username].hp || allUsers[username].maxHp
        };
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('updateStats', {
            level: activePlayers[socket.id].level,
            xp: activePlayers[socket.id].xp,
            maxXp: getRequiredXp(activePlayers[socket.id].level),
            gold: activePlayers[socket.id].gold,
            hp: activePlayers[socket.id].hp,
            maxHp: activePlayers[socket.id].maxHp,
            jutsuType: activePlayers[socket.id].jutsuType
        });
        socket.emit('currentPlayers', publicPlayers(activePlayers));
        socket.emit('npcList', NPCS);
        socket.emit('mobList', mobs.filter(m => m.alive).map(m => ({
            id: m.id, x: m.x, z: m.z, hp: m.hp, maxHp: m.maxHp,
            type: m.type, name: m.name, color: m.color, level: m.level
        })));
        socket.broadcast.emit('newPlayer', publicPlayer(activePlayers[socket.id]));
    });

    socket.on('checkUsername', (username) => {
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        const usernameExists = Object.keys(allUsers).some(u => u.toLowerCase() === username.toLowerCase());
        socket.emit('usernameAvailable', { available: !usernameExists });
    });

    socket.on('register', (data) => {
        const { username, email, password } = data;
        if (!username || username.length < 3 || username.length > 16) {
            socket.emit('loginError', 'Kahraman adı 3-16 karakter arasında olmalıdır.');
            return;
        }
        if (!/^[a-zA-Z0-9_ğüşöçıĞÜŞÖÇİ]+$/.test(username)) {
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
        const jutsuType = ['fire','water','lightning','wind','earth'][Math.floor(Math.random()*5)];
        const code = generateVerifyCode();
        pendingVerifications[username] = {
            code, email, password,
            userData: {
                username, email,
                password: hashPassword(password),
                x: 0, y: 0, z: 0,
                color: Math.floor(Math.random() * 16777215),
                hp: 100, maxHp: 100,
                level: 1, xp: 0, gold: 50,
                jutsuType: jutsuType,
                inventory: { wood: 0, stone: 0, sword: 0, pickaxe: 0, axe: 0 },
                equipped: {},
                consumables: [],
                verified: false
            }
        };
        sendEmail(email, '⚔️ Survival Evolution - E-posta Doğrulama',
            `Kahraman ${username}, doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir. Jutsu tipiniz: ${JUTSU_TYPES[jutsuType].name}`);
        setTimeout(() => { delete pendingVerifications[username]; }, 10 * 60 * 1000);
        socket.emit('registerSuccess', { username, jutsuType });
    });

    socket.on('verifyEmail', (data) => {
        const { username, code } = data;
        const pending = pendingVerifications[username];
        if (!pending) {
            socket.emit('loginError', 'Doğrulama isteği bulunamadı veya süresi doldu.');
            return;
        }
        if (pending.code !== code) {
            socket.emit('loginError', 'Doğrulama kodu hatalı.');
            return;
        }
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        pending.userData.verified = true;
        allUsers[username] = pending.userData;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete pendingVerifications[username];
        const token = signToken(username);
        activePlayers[socket.id] = { ...allUsers[username], id: socket.id };
        socket.emit('verifySuccess');
        socket.emit('loginSuccess', { token, username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('updateStats', {
            level: activePlayers[socket.id].level,
            xp: activePlayers[socket.id].xp,
            maxXp: getRequiredXp(activePlayers[socket.id].level),
            gold: activePlayers[socket.id].gold,
            hp: activePlayers[socket.id].hp,
            maxHp: activePlayers[socket.id].maxHp,
            jutsuType: activePlayers[socket.id].jutsuType
        });
        socket.emit('currentPlayers', publicPlayers(activePlayers));
        socket.emit('npcList', NPCS);
        socket.broadcast.emit('newPlayer', publicPlayer(activePlayers[socket.id]));
    });

    socket.on('resendVerifyCode', (data) => {
        const { username } = data;
        const pending = pendingVerifications[username];
        if (!pending) {
            socket.emit('loginError', 'Doğrulama isteği bulunamadı.');
            return;
        }
        const newCode = generateVerifyCode();
        pending.code = newCode;
        sendEmail(pending.email, '⚔️ Survival Evolution - Yeni Doğrulama Kodu',
            `Yeni doğrulama kodunuz: ${newCode}\n\nBu kod 10 dakika geçerlidir.`);
        socket.emit('loginError', '');
    });

    socket.on('login', (data) => {
        const { username, password } = data;
        let allUsers = {};
        try { allUsers = JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch (e) { allUsers = {}; }
        let foundUser = null;
        let foundKey = null;
        if (allUsers[username]) {
            foundUser = allUsers[username];
            foundKey = username;
        } else {
            const usernameLower = username.toLowerCase();
            const userKey = Object.keys(allUsers).find(u => u.toLowerCase() === usernameLower);
            if (userKey) { foundUser = allUsers[userKey]; foundKey = userKey; }
        }
        if (!foundUser) {
            foundUser = Object.values(allUsers).find(u => u.email.toLowerCase() === username.toLowerCase());
            if (foundUser) foundKey = foundUser.username;
        }
        if (!foundUser) {
            socket.emit('loginError', 'Bu kahraman adı veya e-posta kayıtlı değil.');
            return;
        }
        if (!verifyPassword(password, foundUser.password)) {
            socket.emit('loginError', 'Şifre hatalı.');
            return;
        }
        if (!foundUser.verified) {
            socket.emit('loginError', 'E-posta adresiniz henüz doğrulanmamış.');
            return;
        }
        // Migrate old accounts
        if (!foundUser.level) { foundUser.level = 1; foundUser.xp = 0; foundUser.gold = 0; }
        if (!foundUser.maxHp) foundUser.maxHp = 100;
        if (!foundUser.jutsuType) foundUser.jutsuType = 'fire';
        if (!foundUser.equipped) foundUser.equipped = {};
        if (!foundUser.consumables) foundUser.consumables = [];
        allUsers[foundKey] = foundUser;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));

        const token = signToken(foundUser.username);
        activePlayers[socket.id] = { ...foundUser, id: socket.id };
        socket.emit('loginSuccess', { token, username: foundUser.username });
        socket.emit('updateInventory', activePlayers[socket.id].inventory);
        socket.emit('updateStats', {
            level: activePlayers[socket.id].level,
            xp: activePlayers[socket.id].xp,
            maxXp: getRequiredXp(activePlayers[socket.id].level),
            gold: activePlayers[socket.id].gold,
            hp: activePlayers[socket.id].hp,
            maxHp: activePlayers[socket.id].maxHp,
            jutsuType: activePlayers[socket.id].jutsuType
        });
        socket.emit('currentPlayers', publicPlayers(activePlayers));
        socket.emit('npcList', NPCS);
        socket.emit('mobList', mobs.filter(m => m.alive).map(m => ({
            id: m.id, x: m.x, z: m.z, hp: m.hp, maxHp: m.maxHp,
            type: m.type, name: m.name, color: m.color, level: m.level
        })));
        socket.broadcast.emit('newPlayer', publicPlayer(activePlayers[socket.id]));
    });

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
        passwordResetCodes[email.toLowerCase()] = { code, username: user.username, expires: Date.now() + 10 * 60 * 1000 };
        sendEmail(email, '⚔️ Survival Evolution - Şifre Sıfırlama Kodu',
            `Merhaba ${user.username},\n\nŞifrenizi sıfırlamak için kullanacağınız kod: ${code}\n\nBu kod 10 dakika geçerlidir.`);
        socket.emit('forgotPasswordCodeSent');
    });

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
        user.password = hashPassword(newPassword);
        allUsers[username] = user;
        fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
        delete passwordResetCodes[email.toLowerCase()];
        socket.emit('resetPasswordSuccess');
        sendEmail(email, '⚔️ Survival Evolution - Şifre Değişikliği',
            `Merhaba ${user.username},\n\nŞifreniz başarıyla değiştirilmiştir.`);
    });

    // ── SOHBET ──
    socket.on('chatMessage', (text) => {
        const p = activePlayers[socket.id];
        if (!p || !text) return;
        const clean = String(text).trim().slice(0, 140);
        if (!clean) return;
        io.emit('chatMessage', { id: socket.id, username: p.username, text: clean });
    });

    // ── HAREKET ──
    socket.on('playerMovement', (data) => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].x = data.x;
            activePlayers[socket.id].y = data.y || 0;
            activePlayers[socket.id].z = data.z;
            activePlayers[socket.id].rotationY = data.rotationY;
            socket.broadcast.emit('playerMoved', publicPlayer(activePlayers[socket.id]));
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

    // ── ÜRETİM ──
    socket.on('craft', (item) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        let success = false;
        const inv = p.inventory;
        if (item === 'sword' && inv.wood >= 2 && inv.stone >= 2) { inv.wood -= 2; inv.stone -= 2; inv.sword += 1; success = true; }
        else if (item === 'pickaxe' && inv.wood >= 3 && inv.stone >= 1) { inv.wood -= 3; inv.stone -= 1; inv.pickaxe += 1; success = true; }
        else if (item === 'axe' && inv.wood >= 1 && inv.stone >= 3) { inv.wood -= 1; inv.stone -= 3; inv.axe += 1; success = true; }
        if (success) {
            socket.emit('updateInventory', inv);
            socket.emit('craftSuccess', item);
        } else {
            socket.emit('craftFail', 'Yetersiz malzeme!');
        }
    });

    // ── EŞYA KULLANMA ──
    socket.on('useItem', (itemType) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        if (itemType === 'sword' && p.inventory.sword > 0) {
            p.equipped = p.equipped || {};
            p.equipped.weapon = { type: 'sword', damage: 20 };
            socket.emit('itemEquipped', { slot: 'weapon', item: 'sword' });
        } else if (itemType === 'pickaxe' && p.inventory.pickaxe > 0) {
            p.equipped = p.equipped || {};
            p.equipped.tool = 'pickaxe';
            socket.emit('itemEquipped', { slot: 'tool', item: 'pickaxe' });
        } else if (itemType === 'axe' && p.inventory.axe > 0) {
            p.equipped = p.equipped || {};
            p.equipped.tool = 'axe';
            socket.emit('itemEquipped', { slot: 'tool', item: 'axe' });
        }
    });

    // ── JUTSU ATMA ──
    socket.on('castJutsu', (data) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        const jutsu = JUTSU_TYPES[p.jutsuType];
        if (!jutsu) return;
        const dmg = getJutsuDamage(p.jutsuType, p.level);
        io.emit('jutsuCast', {
            id: socket.id,
            x: p.x,
            z: p.z,
            jutsuType: p.jutsuType,
            damage: dmg,
            element: jutsu.element,
            color: jutsu.color,
            glow: jutsu.glow
        });
    });

    // ── MOB SALDIRISI ──
    socket.on('attackMob', (data) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        const mob = mobs.find(m => m.id === data.mobId && m.alive);
        if (!mob) return;
        const dist = Math.hypot(p.x - mob.x, p.z - mob.z);
        if (dist > 80) return;

        let damage = 10 + (p.level - 1) * 2;
        if (p.equipped?.weapon?.damage) damage += p.equipped.weapon.damage;
        if (p.inventory.sword > 0 && !p.equipped?.weapon) damage += 15;

        mob.hp -= damage;
        mob.hitFlash = 0.2;

        io.emit('mobHit', { mobId: mob.id, damage: damage, hp: mob.hp, maxHp: mob.maxHp, attacker: socket.id });

        if (mob.hp <= 0) {
            mob.alive = false;
            p.xp += mob.xp;
            p.gold += mob.gold;
            const leveled = levelUpCheck(p);
            io.emit('mobKilled', { mobId: mob.id, killer: socket.id, xp: mob.xp, gold: mob.gold, levelUp: leveled });
            socket.emit('updateStats', {
                level: p.level,
                xp: p.xp,
                maxXp: getRequiredXp(p.level),
                gold: p.gold,
                hp: p.hp,
                maxHp: p.maxHp,
                jutsuType: p.jutsuType
            });
        }
    });

    // ── OYUNCU SALDIRISI ──
    socket.on('attack', (targetId) => {
        const attacker = activePlayers[socket.id];
        const target = activePlayers[targetId];
        if (attacker && target) {
            const dist = Math.sqrt(Math.pow(attacker.x - target.x, 2) + Math.pow(attacker.z - target.z, 2));
            if (dist < 5) {
                let damage = attacker.inventory.sword > 0 ? 30 : 10;
                if (attacker.equipped?.weapon?.damage) damage += attacker.equipped.weapon.damage;
                damage += (attacker.level - 1) * 2;
                const def = target.equipped?.armor?.defense || 0;
                damage = Math.max(1, damage - def);
                target.hp -= damage;
                if (target.hp <= 0) {
                    target.hp = target.maxHp;
                    target.x = 0; target.z = 0;
                    io.emit('playerMoved', publicPlayer(target));
                }
                io.emit('hpUpdate', { id: targetId, hp: target.hp, maxHp: target.maxHp, source: 'player', damage: damage });
            }
        }
    });

    // ── MARKET İŞLEMLERİ ──
    socket.on('getMarket', () => {
        const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
        socket.emit('marketData', market.items);
    });

    socket.on('buyItem', (itemId) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
        const item = market.items.find(i => i.id === itemId);
        if (!item) return;
        if (p.gold < item.price) {
            socket.emit('marketError', 'Yetersiz ryo!');
            return;
        }
        p.gold -= item.price;
        if (item.type === 'consumable' || item.type === 'boost') {
            p.consumables = p.consumables || [];
            p.consumables.push(item);
        } else if (item.type === 'weapon') {
            p.equipped = p.equipped || {};
            p.equipped.weapon = { type: item.id, damage: item.damage };
        } else if (item.type === 'armor') {
            p.equipped = p.equipped || {};
            p.equipped.armor = { type: item.id, defense: item.defense };
        } else if (item.type === 'jutsu_scroll') {
            p.jutsuType = item.jutsu;
        }
        socket.emit('marketSuccess', `Satın alındı: ${item.name}`);
        socket.emit('updateStats', {
            level: p.level, xp: p.xp, maxXp: getRequiredXp(p.level),
            gold: p.gold, hp: p.hp, maxHp: p.maxHp, jutsuType: p.jutsuType
        });
    });

    socket.on('sellResource', (data) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        const { type, amount } = data;
        if (!p.inventory[type] || p.inventory[type] < amount) {
            socket.emit('marketError', 'Yetersiz malzeme!');
            return;
        }
        const pricePerUnit = type === 'wood' ? 2 : 3;
        const total = pricePerUnit * amount;
        p.inventory[type] -= amount;
        p.gold += total;
        socket.emit('marketSuccess', `Satıldı: ${amount} ${type} = ${total} ryo`);
        socket.emit('updateInventory', p.inventory);
        socket.emit('updateStats', {
            level: p.level, xp: p.xp, maxXp: getRequiredXp(p.level),
            gold: p.gold, hp: p.hp, maxHp: p.maxHp, jutsuType: p.jutsuType
        });
    });

    // ── NPC İLE ETKİLEŞİM ──
    socket.on('interactNPC', (npcId) => {
        const p = activePlayers[socket.id];
        if (!p) return;
        const npc = NPCS.find(n => n.id === npcId);
        if (!npc) return;
        const dist = Math.hypot(p.x - npc.x, p.z - npc.z);
        if (dist > 80) {
            socket.emit('npcError', 'Çok uzaktasın!');
            return;
        }
        if (npc.type === 'healer') {
            const cost = Math.floor((p.maxHp - p.hp) * 0.5);
            if (p.gold >= cost) {
                p.gold -= cost;
                p.hp = p.maxHp;
                socket.emit('npcHeal', { cost, hp: p.hp });
                socket.emit('updateStats', {
                    level: p.level, xp: p.xp, maxXp: getRequiredXp(p.level),
                    gold: p.gold, hp: p.hp, maxHp: p.maxHp, jutsuType: p.jutsuType
                });
            } else {
                socket.emit('npcError', 'Yetersiz ryo!');
            }
        } else if (npc.type === 'market') {
            const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
            socket.emit('marketData', market.items);
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
                    allUsers[p.username].level = p.level;
                    allUsers[p.username].xp = p.xp;
                    allUsers[p.username].gold = p.gold;
                    allUsers[p.username].equipped = p.equipped;
                    allUsers[p.username].consumables = p.consumables;
                    fs.writeFileSync(playersDataPath, JSON.stringify(allUsers, null, 2));
                }
            } catch (e) {
                console.log('❌ Oyuncu verisi kaydedilemedi:', e.message);
            }
            delete activePlayers[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

app.get('/status', (req, res) => res.send('Sistem Aktif!'));

process.on('unhandledRejection', (error) => {
    console.error('❌ Yakalanmamış promise hatası:', error);
});

client.once('ready', () => {
    console.log(`✅ Discord: ${client.user.tag} hazır`);
});

if (!process.env.token) {
    console.error('❌ HATA: "token" environment variable tanımlı değil!');
} else {
    client.login(process.env.token).catch(err => {
        console.error('❌ Discord login hatası:', err.message);
    });
}

server.listen(PORT, () => {
    console.log(`[✓] Sunucu ve Oyun Port ${PORT} üzerinde aktif.`);
    console.log(`[✓] Veriler kaydediliyor: ${playersDataPath}`);
    console.log(`[✓] ${MOB_COUNT} canavar aktif.`);
}); 