const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Dosya Yolu Ayarları
let DATA_DIR = process.env.DATA_DIR || '/var/data';
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (err) {
    console.error(`⚠️ "${DATA_DIR}" klasörüne yazılamıyor. Render'da Disk eklenmemiş olabilir.`);
    DATA_DIR = path.join(__dirname, 'data');
    console.error(`⚠️ Bunun yerine "${DATA_DIR}" kullanılıyor.`);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const playersDataPath = path.join(DATA_DIR, 'players.json');
const worldDataPath = path.join(DATA_DIR, 'world.json');
const clansDataPath = path.join(DATA_DIR, 'clans.json');

if (!fs.existsSync(playersDataPath)) fs.writeFileSync(playersDataPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(worldDataPath)) fs.writeFileSync(worldDataPath, JSON.stringify({ cities: {}, mines: {}, bosses: {} }, null, 2));
if (!fs.existsSync(clansDataPath)) fs.writeFileSync(clansDataPath, JSON.stringify({}, null, 2));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// ═══════════════════════════════════════════
// MAİL SİSTEMİ (service: 'gmail' KULLANILARAK TIMEOUT HATASI ÇÖZÜLDÜ)
// ═══════════════════════════════════════════
const MAIL_FROM_NAME = 'AtlasWarfare';
const MAIL_USER = process.env.EMAIL_USER || 'atlaswarfare.com@gmail.com';
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USER, pass: process.env.google }
});

function sendEmail(to, subject, body) {
    const mailOptions = { 
        from: `"${MAIL_FROM_NAME}" <${MAIL_USER}>`, 
        to, 
        subject, 
        text: body 
    };
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('❌ [MAIL] E-posta Hatası:', error);
        } else {
            console.log('📧 [MAIL] E-posta Gönderildi: ' + info.response);
        }
    });
}

// ═══════════════════════════════════════════
// SABİT VERİLER
// ═══════════════════════════════════════════
const CITIES = [
    { id:"tokyo", name:"Tokyo", type:"capital", lat:35.68, lng:139.69, garrison:5000, bonus:{damage:0.20, defense:0.15, ryo:0.30} },
    { id:"london", name:"Londra", type:"capital", lat:51.50, lng:-0.12, garrison:4500, bonus:{defense:0.25, ryo:0.20} },
    { id:"paris", name:"Paris", type:"capital", lat:48.85, lng:2.35, garrison:4000, bonus:{damage:0.15, ryo:0.25} },
    { id:"berlin", name:"Berlin", type:"capital", lat:52.52, lng:13.40, garrison:4500, bonus:{defense:0.20, damage:0.10} },
    { id:"moscow", name:"Moskova", type:"capital", lat:55.75, lng:37.61, garrison:5500, bonus:{damage:0.25, defense:0.20} },
    { id:"beijing", name:"Pekin", type:"capital", lat:39.90, lng:116.40, garrison:5000, bonus:{damage:0.20, ryo:0.25} },
    { id:"washington", name:"Washington", type:"capital", lat:38.90, lng:-77.03, garrison:4500, bonus:{defense:0.20, ryo:0.30} },
    { id:"istanbul", name:"İstanbul", type:"capital", lat:41.00, lng:28.97, garrison:4000, bonus:{damage:0.15, defense:0.15, ryo:0.15} },
    { id:"cairo", name:"Kahire", type:"capital", lat:30.04, lng:31.23, garrison:3500, bonus:{ryo:0.35, defense:0.10} },
    { id:"rome", name:"Roma", type:"capital", lat:41.90, lng:12.49, garrison:4000, bonus:{defense:0.20, ryo:0.20} },
    { id:"osaka", name:"Osaka", type:"normal", lat:34.69, lng:135.50, garrison:1500, bonus:{damage:0.08} },
    { id:"shanghai", name:"Şanghay", type:"normal", lat:31.23, lng:121.47, garrison:2000, bonus:{ryo:0.15} },
    { id:"newyork", name:"New York", type:"normal", lat:40.71, lng:-74.00, garrison:2000, bonus:{ryo:0.15} },
    { id:"losangeles", name:"Los Angeles", type:"normal", lat:34.05, lng:-118.24, garrison:1500, bonus:{ryo:0.12} },
    { id:"sydney", name:"Sydney", type:"normal", lat:-33.86, lng:151.20, garrison:1200, bonus:{defense:0.10} },
    { id:"dubai", name:"Dubai", type:"normal", lat:25.20, lng:55.27, garrison:1800, bonus:{ryo:0.20} },
    { id:"singapore", name:"Singapur", type:"normal", lat:1.35, lng:103.81, garrison:2000, bonus:{ryo:0.18} },
    { id:"madrid", name:"Madrid", type:"normal", lat:40.41, lng:-3.70, garrison:1200, bonus:{defense:0.08} }
];

const MINES = [
    { id:"mine_gold1", name:"Altın Madeni", type:"gold", lat:36, lng:140, yield:200 },
    { id:"mine_gold2", name:"Altın Madeni", type:"gold", lat:51, lng:0, yield:200 },
    { id:"mine_iron1", name:"Demir Madeni", type:"iron", lat:45, lng:13, yield:100 },
    { id:"mine_iron2", name:"Demir Madeni", type:"iron", lat:35, lng:139, yield:100 },
    { id:"mine_iron3", name:"Demir Madeni", type:"iron", lat:39, lng:116, yield:100 }
];

const BIJUU_LAIRS = [
    { id:"bijuu1", beast:"Matatabi (2 Kuyruk)", lat:35, lng:139, hp:50000, reward:50000 },
    { id:"bijuu2", beast:"Isobu (3 Kuyruk)", lat:-33, lng:151, hp:60000, reward:60000 },
    { id:"bijuu8", beast:"Kurama (9 Kuyruk)", lat:35, lng:0, hp:200000, reward:200000 }
];

const CHARACTERS = [
    { id:"kyuubi", name:"Kyuubi Varisi", element:"fire", ability:"Rasengan", damage:50, defense:20, hp:500, desc:"Ateş enerjisiyle devasa top fırlatır" },
    { id:"alchemist", name:"Alchemist General", element:"earth", ability:"Transmutation", damage:40, defense:40, hp:800, desc:"Yeri parçalayarak alan hasarı verir" },
    { id:"mistsword", name:"Sis Hashira", element:"water", ability:"Mist Breathing", damage:45, defense:30, hp:600, desc:"Sis bulutu içinde hızlı kesikler atar" },
    { id:"raikage", name:"Yıldırım Varisi", element:"lightning", ability:"Chidori", damage:60, defense:15, hp:400, desc:"Yıldırım hızında delici saldırı" },
    { id:"soulreaper", name:"Ruh Savasan", element:"wind", ability:"Bankai", damage:55, defense:25, hp:550, desc:"Dev kılıçla geniş alan hasarı verir" },
    { id:"titan", name:"İzci Teğmen", element:"earth", ability:"ODM Slash", damage:65, defense:10, hp:350, desc:"Yüksek hızla düşmanı deler geçer" },
    { id:"rubber", name:"Lastik Komutan", element:"lightning", ability:"Gear Second", damage:50, defense:30, hp:600, desc:"Esnek yumruklarla sarsıcı darbe vurur" },
    { id:"icequeen", name:"Buz Kraliçesi", element:"water", ability:"Ice Mirror", damage:40, defense:35, hp:650, desc:"Ayna teknikleriyle buz şarırağı yağdırır" }
];

const SHIELD_DURATION = 12 * 60 * 60 * 1000;

// ═══════════════════════════════════════════
// DÜNYA YÖNETİMİ
// ═══════════════════════════════════════════
function initWorld() {
    let world = {};
    try { world = JSON.parse(fs.readFileSync(worldDataPath, 'utf8')); } catch(e) { world = { cities: {}, mines: {}, bosses: {} }; }
    if (!world.cities || Object.keys(world.cities).length === 0) {
        world = { cities: {}, mines: {}, bosses: {}, createdAt: Date.now() };
        CITIES.forEach(c => world.cities[c.id] = { ...c, x: (c.lng / 180) * 500, z: -(c.lat / 90) * 250, owner: null, ownerClan: null, empireColor: null, playerDefenders: { infantry: 0, archer: 0, cavalry: 0 }, shieldUntil: 0, lastIncome: Date.now() });
        MINES.forEach(m => world.mines[m.id] = { ...m, x: (m.lng / 180) * 500, z: -(m.lat / 90) * 250, owner: null, empireColor: null, occupierArmy: { infantry: 0, archer: 0, cavalry: 0 }, lastCollection: Date.now() });
        BIJUU_LAIRS.forEach(b => world.bosses[b.id] = { ...b, x: (b.lng / 180) * 500, z: -(b.lat / 90) * 250, currentHp: b.hp, defeated: false, respawnAt: Date.now() + 2 * 60 * 60 * 1000, attackers: {} });
        fs.writeFileSync(worldDataPath, JSON.stringify(world, null, 2));
    }
    return world;
}
function loadWorld() { try { return JSON.parse(fs.readFileSync(worldDataPath, 'utf8')); } catch(e) { return initWorld(); } }
function saveWorld(w) { fs.writeFileSync(worldDataPath, JSON.stringify(w, null, 2)); }
function loadClans() { try { return JSON.parse(fs.readFileSync(clansDataPath, 'utf8')); } catch(e) { return {}; } }
function saveClans(c) { fs.writeFileSync(clansDataPath, JSON.stringify(c, null, 2)); }
initWorld();

// ═══════════════════════════════════════════
// MAFIA CITY SAVAŞ MANTIĞI
// ═══════════════════════════════════════════
function calculateBattle(attackArmy, attackStats, defenseArmy, defenseStats) {
    const UNIT_STATS = { infantry: { atk: 10, def: 10, hp: 100 }, archer: { atk: 15, def: 5, hp: 80 }, cavalry: { atk: 20, def: 15, hp: 150 } };
    let atkPower = attackArmy.infantry * (UNIT_STATS.infantry.atk + UNIT_STATS.infantry.hp * 0.5) + attackArmy.archer * (UNIT_STATS.archer.atk + UNIT_STATS.archer.hp * 0.5) + attackArmy.cavalry * (UNIT_STATS.cavalry.atk + UNIT_STATS.cavalry.hp * 0.5);
    atkPower *= (1 + (attackStats.damage || 0));
    let defPower = (defenseArmy.garrison || 0) * 15 + (defenseArmy.infantry || 0) * (UNIT_STATS.infantry.def + UNIT_STATS.infantry.hp) + (defenseArmy.archer || 0) * (UNIT_STATS.archer.def + UNIT_STATS.archer.hp) + (defenseArmy.cavalry || 0) * (UNIT_STATS.cavalry.def + UNIT_STATS.cavalry.hp);
    defPower *= (1 + (defenseStats.defense || 0));

    atkPower *= (0.9 + Math.random() * 0.2);
    defPower *= (0.9 + Math.random() * 0.2);

    const totalPower = atkPower + defPower || 1;
    const atkRatio = atkPower / totalPower;
    const attackerLossRatio = atkPower > defPower ? (1 - atkRatio) * 0.5 : 0.8;
    const defenderLossRatio = atkPower > defPower ? 0.8 : (1 - (1 - atkRatio)) * 0.5;

    const attackerLosses = { infantry: Math.floor(attackArmy.infantry * attackerLossRatio), archer: Math.floor(attackArmy.archer * attackerLossRatio), cavalry: Math.floor(attackArmy.cavalry * attackerLossRatio) };
    const defenderLosses = { garrison: Math.floor((defenseArmy.garrison || 0) * defenderLossRatio), infantry: Math.floor((defenseArmy.infantry || 0) * defenderLossRatio), archer: Math.floor((defenseArmy.archer || 0) * defenderLossRatio), cavalry: Math.floor((defenseArmy.cavalry || 0) * defenderLossRatio) };
    const attackerSurvivors = { infantry: Math.max(0, attackArmy.infantry - attackerLosses.infantry), archer: Math.max(0, attackArmy.archer - attackerLosses.archer), cavalry: Math.max(0, attackArmy.cavalry - attackerLosses.cavalry) };
    const attackerHospital = { infantry: Math.floor(attackerLosses.infantry * 0.7), archer: Math.floor(attackerLosses.archer * 0.7), cavalry: Math.floor(attackerLosses.cavalry * 0.7) };

    return { attackerWins: atkPower > defPower, atkPower: Math.round(atkPower), defPower: Math.round(defPower), attackerLosses, defenderLosses, attackerSurvivors, attackerHospital };
}

function calculatePlayerPower(player) {
    if (!player) return 0;
    let power = (player.army?.infantry || 0) * 10 + (player.army?.archer || 0) * 15 + (player.army?.cavalry || 0) * 25;
    power += (player.hospital?.infantry || 0) * 5 + (player.hospital?.archer || 0) * 7.5 + (player.hospital?.cavalry || 0) * 12.5;
    const world = loadWorld();
    Object.values(world.cities).forEach(c => { if (c.owner === player.username) power += c.type === 'capital' ? 5000 : 2000; });
    Object.values(world.mines || {}).forEach(m => { if (m.owner === player.username) power += 1000; });
    if (player.character) { const c = CHARACTERS.find(x => x.id === player.character); if (c) power += c.damage * 10 + c.defense * 10 + c.hp; }
    if (player.base) power += player.base.level * 3000;
    return Math.floor(power);
}

function checkQuestReset(player) {
    if (!player.lastQuestReset || (Date.now() - player.lastQuestReset) > 24 * 60 * 60 * 1000) {
        player.quests = { train: { target: 100, current: 0, reward: 2000, claimed: false }, attack: { target: 1, current: 0, reward: 3000, claimed: false }, boss: { target: 1, current: 0, reward: 5000, claimed: false } };
        player.lastQuestReset = Date.now();
    }
}

// ═══════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════
function hashPassword(p) { const s = crypto.randomBytes(16).toString('hex'); const h = crypto.scryptSync(p, s, 64).toString('hex'); return `${s}:${h}`; }
function verifyPassword(p, s) { if (!s || !s.includes(':')) return false; const [salt, hash] = s.split(':'); const check = crypto.scryptSync(p, salt, 64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex')); }
function publicPlayer(p) { if (!p) return p; const { password, ...safe } = p; return safe; }
function signToken(u) { const payload = Buffer.from(JSON.stringify({ u, exp: Date.now() + 90 * 24 * 60 * 60 * 1000 })).toString('base64url'); const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url'); return payload + '.' + sig; }
function verifyToken(t) { if (!t || !t.includes('.')) return null; const [p, sig] = t.split('.'); const exp = crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url'); if (sig !== exp) return null; try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); if (Date.now() > d.exp) return null; return d.u; } catch (e) { return null; } }

const pendingVerifications = {};
const passwordResetCodes = {}; 
let activePlayers = {};

function generateVerifyCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

function buildPlayerData(username, data) {
    return {
        username, email: data.email, password: hashPassword(data.password),
        x: 0, y: 0, z: 0, empireColor: null, character: null,
        hp: 100, maxHp: 100, level: 1, xp: 0, ryo: 15000,
        inventory: { wood: 0, stone: 0 }, stats: { damage: 0, defense: 0 },
        items: {}, equip: { weapon: null, armor: null }, clan: null,
        army: { infantry: 100, archer: 50, cavalry: 20 },
        hospital: { infantry: 0, archer: 0, cavalry: 0 },
        quests: { train: { target: 100, current: 0, reward: 2000, claimed: false }, attack: { target: 1, current: 0, reward: 3000, claimed: false }, boss: { target: 1, current: 0, reward: 5000, claimed: false } },
        lastQuestReset: Date.now(), inbox: [], base: null, verified: false
    };
}

function loadAllUsers() { try { return JSON.parse(fs.readFileSync(playersDataPath, 'utf8')); } catch(e) { return {}; } }
function saveAllUsers(u) { fs.writeFileSync(playersDataPath, JSON.stringify(u, null, 2)); }

// ═══════════════════════════════════════════
// PASİF GELİR VE BOSS RESPAWN
// ═══════════════════════════════════════════
setInterval(() => {
    const world = loadWorld(); const now = Date.now(); const allUsers = loadAllUsers(); let updated = false;
    Object.values(world.cities).forEach(city => { if (city.owner && allUsers[city.owner]) { allUsers[city.owner].ryo += Math.floor((city.bonus?.ryo || 0.1) * 1000); city.lastIncome = now; updated = true; } });
    Object.values(world.mines).forEach(mine => { if (mine.owner && allUsers[mine.owner]) { const m = Math.floor((now - mine.lastCollection) / 60000); if (m >= 1) { allUsers[mine.owner].ryo += mine.yield * m; mine.lastCollection = now; updated = true; } } });
    Object.values(world.bosses).forEach(boss => { if (boss.defeated && now >= boss.respawnAt) { boss.defeated = false; boss.currentHp = boss.hp; boss.attackers = {}; io.emit('toast', { type: 'info', msg: `⚠️ ${boss.beast} yeniden uyandı!` }); updated = true; } });
    if (updated) {
        saveWorld(world); saveAllUsers(allUsers);
        Object.values(activePlayers).forEach(p => { if (allUsers[p.username]) { p.ryo = allUsers[p.username].ryo; const s = Object.keys(activePlayers).find(k => activePlayers[k] === p); if (s) io.to(s).emit('ryoUpdate', p.ryo); } });
        io.emit('worldData', world);
    }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════
// SOCKET.IO EVENTLERİ
// ═══════════════════════════════════════════
io.on('connection', (socket) => {
    function activatePlayer(socketId, username, playerData) { activePlayers[socketId] = { ...playerData, id: socketId }; }

    socket.on('loginWithToken', (token) => {
        const u = verifyToken(token); if (!u) return socket.emit('loginError', 'Oturum süresi dolmuş.');
        const all = loadAllUsers(); if (!all[u]) return socket.emit('loginError', 'Hesap bulunamadı.');
        activatePlayer(socket.id, u, all[u]);
        socket.emit('loginSuccess', { token: signToken(u), ...publicPlayer(all[u]) });
        socket.emit('worldData', loadWorld()); socket.emit('charactersData', CHARACTERS); socket.emit('clansData', loadClans());
    });

    socket.on('register', (data) => {
        const { username, email, password, passwordConfirm } = data;
        if (!username || username.length < 3 || username.length > 16) return socket.emit('loginError', 'Kahraman adı 3-16 karakter olmalı.');
        if (!/^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ]+$/.test(username)) return socket.emit('loginError', 'Geçersiz karakter adı.');
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return socket.emit('loginError', 'Geçerli e-posta gir.');
        if (!password || password.length < 6) return socket.emit('loginError', 'Şifre en az 6 karakter.');
        if (password !== passwordConfirm) return socket.emit('loginError', 'Şifreler eşleşmiyor.');
        
        const all = loadAllUsers();
        if (Object.keys(all).some(u => u.toLowerCase() === username.toLowerCase())) return socket.emit('loginError', 'Bu ad alınmış.');
        if (Object.values(all).some(u => u.email && u.email.toLowerCase() === email.toLowerCase())) return socket.emit('loginError', 'Bu e-posta kayırlı.');

        const code = generateVerifyCode();
        pendingVerifications[username] = { code, email, password, userData: buildPlayerData(username, { email, password }) };
        sendEmail(email, '⚔️ AtlasWarfare - Doğrulama', `Kahraman ${username}, doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir.`);
        setTimeout(() => { delete pendingVerifications[username]; }, 10 * 60 * 1000);
        socket.emit('registerSuccess', { username });
    });

    socket.on('verifyEmail', (data) => {
        const { username, code } = data; const p = pendingVerifications[username];
        if (!p || p.code !== code) return socket.emit('loginError', 'Kod hatalı veya süresi dolmuş.');
        const all = loadAllUsers(); p.userData.verified = true; all[username] = p.userData; saveAllUsers(all); delete pendingVerifications[username];
        activatePlayer(socket.id, username, all[username]);
        socket.emit('verifySuccess', { token: signToken(username), ...publicPlayer(all[username]) });
        socket.emit('worldData', loadWorld()); socket.emit('charactersData', CHARACTERS); socket.emit('clansData', loadClans());
    });

    socket.on('resendVerifyCode', (data) => {
        const { username } = data; const p = pendingVerifications[username];
        if (!p) return socket.emit('loginError', 'Doğrulama isteği bulunamadı.');
        const newCode = generateVerifyCode(); p.code = newCode;
        sendEmail(p.email, '⚔️ AtlasWarfare - Yeni Doğrulama Kodu', `Yeni doğrulama kodunuz: ${newCode}`);
        socket.emit('loginError', '');
    });

    socket.on('forgotPassword', (data) => {
        const { email } = data; const all = loadAllUsers();
        const user = Object.values(all).find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
        if (!user) return socket.emit('loginError', 'E-posta kayırlı değil.');
        const code = generateVerifyCode();
        passwordResetCodes[email.toLowerCase()] = { code, username: user.username, expires: Date.now() + 10 * 60 * 1000 };
        sendEmail(email, '⚔️ AtlasWarfare - Şifre Sıfırlama', `Merhaba ${user.username}, şifre sıfırlama kodun: ${code}`);
        socket.emit('forgotPasswordCodeSent');
    });

    socket.on('verifyResetCode', (data) => {
        const { email, code } = data; const r = passwordResetCodes[email.toLowerCase()];
        if (!r || Date.now() > r.expires) return socket.emit('resetCodeError', 'Kod süresi dolmuş.');
        if (r.code !== code) return socket.emit('resetCodeError', 'Kod hatalı.');
        socket.emit('resetCodeVerified', { email: email.toLowerCase(), username: r.username });
    });

    socket.on('resetPassword', (data) => {
        const { email, newPassword } = data;
        if (!newPassword || newPassword.length < 6) return socket.emit('resetPasswordError', 'Şifre en az 6 karakter.');
        const all = loadAllUsers();
        const entry = Object.entries(all).find(([_, u]) => u.email && u.email.toLowerCase() === email.toLowerCase());
        if (!entry) return socket.emit('resetPasswordError', 'Kullanıcı yok.');
        const [username, user] = entry; user.password = hashPassword(newPassword); all[username] = user; saveAllUsers(all);
        delete passwordResetCodes[email.toLowerCase()];
        socket.emit('resetPasswordSuccess');
    });

    socket.on('login', (data) => {
        const { username, password } = data; const all = loadAllUsers();
        let u = all[username] || Object.values(all).find(x => x.email && x.email.toLowerCase() === username.toLowerCase());
        if (!u) return socket.emit('loginError', 'Hesap bulunamadı.');
        if (!verifyPassword(password, u.password)) return socket.emit('loginError', 'Şifre hatalı.');
        if (!u.verified) return socket.emit('loginError', 'E-posta doğrulanmamış.');
        activatePlayer(socket.id, u.username, u);
        socket.emit('loginSuccess', { token: signToken(u.username), ...publicPlayer(u) });
        socket.emit('worldData', loadWorld()); socket.emit('charactersData', CHARACTERS); socket.emit('clansData', loadClans());
    });

    socket.on('selectCharacter', (data) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const c = CHARACTERS.find(x => x.id === data.characterId); if (!c) return;
        p.character = c.id; p.stats.damage = (p.stats.damage || 0) + c.damage * 0.01; p.stats.defense = (p.stats.defense || 0) + c.defense * 0.01;
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].character = c.id; all[p.username].stats = p.stats; saveAllUsers(all); }
        socket.emit('characterSelected', { character: c.id, stats: p.stats });
    });

    socket.on('setEmpireColor', (data) => {
        const p = activePlayers[socket.id]; if (!p) return; p.empireColor = data.color;
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].empireColor = data.color; saveAllUsers(all); }
        socket.emit('empireColorSet', { color: data.color });
    });

    socket.on('trainArmy', (data) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const costs = { infantry: 100, archer: 150, cavalry: 250 };
        const cost = (data.infantry||0)*costs.infantry + (data.archer||0)*costs.archer + (data.cavalry||0)*costs.cavalry;
        if (p.ryo < cost) return socket.emit('error', 'Yetersiz Ryo!');
        p.ryo -= cost; p.army.infantry += data.infantry||0; p.army.archer += data.archer||0; p.army.cavalry += data.cavalry||0;
        if (p.quests) p.quests.train.current += (data.infantry||0)+(data.archer||0)+(data.cavalry||0);
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].ryo = p.ryo; all[p.username].army = p.army; all[p.username].quests = p.quests; saveAllUsers(all); }
        socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
        socket.emit('toast', { type: 'success', msg: `${(data.infantry||0)+(data.archer||0)+(data.cavalry||0)} asker eğitildi!` });
    });

    socket.on('healArmy', (data) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const cost = 50 * (Math.min(p.hospital.infantry, data.infantry||0) + Math.min(p.hospital.archer, data.archer||0) + Math.min(p.hospital.cavalry, data.cavalry||0));
        if (p.ryo < cost) return socket.emit('error', 'Yetersiz Ryo!');
        p.ryo -= cost;
        p.army.infantry += Math.min(p.hospital.infantry, data.infantry||0); p.hospital.infantry -= Math.min(p.hospital.infantry, data.infantry||0);
        p.army.archer += Math.min(p.hospital.archer, data.archer||0); p.hospital.archer -= Math.min(p.hospital.archer, data.archer||0);
        p.army.cavalry += Math.min(p.hospital.cavalry, data.cavalry||0); p.hospital.cavalry -= Math.min(p.hospital.cavalry, data.cavalry||0);
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].ryo = p.ryo; all[p.username].army = p.army; all[p.username].hospital = p.hospital; saveAllUsers(all); }
        socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
        socket.emit('toast', { type: 'success', msg: `Askerler iyileştirildi!` });
    });

    socket.on('attackCity', (data) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const world = loadWorld(); const city = world.cities[data.cityId];
        if (!city || city.shieldUntil > Date.now()) return socket.emit('error', 'Şehir kalkanlı!');
        const sent = data.army; if (sent.infantry + sent.archer + sent.cavalry === 0) return socket.emit('error', 'Ordu gönder!');
        const def = { garrison: city.garrison, ...city.playerDefenders };
        const res = calculateBattle(sent, { damage: p.stats.damage }, def, { defense: city.bonus?.defense || 0 });
        
        p.army.infantry = Math.max(0, p.army.infantry - sent.infantry + res.attackerSurvivors.infantry);
        p.army.archer = Math.max(0, p.army.archer - sent.archer + res.attackerSurvivors.archer);
        p.army.cavalry = Math.max(0, p.army.cavalry - sent.cavalry + res.attackerSurvivors.cavalry);
        p.hospital.infantry += res.attackerHospital.infantry; p.hospital.archer += res.attackerHospital.archer; p.hospital.cavalry += res.attackerHospital.cavalry;

        if (res.attackerWins) {
            city.owner = p.username; city.ownerClan = p.clan; city.empireColor = p.empireColor;
            city.playerDefenders = res.attackerSurvivors; city.garrison = 0; city.shieldUntil = Date.now() + SHIELD_DURATION;
            socket.emit('toast', { type: 'victory', msg: `🏆 ${city.name} ele geçirildi!` });
        } else {
            city.garrison = Math.max(100, def.garrison - res.defenderLosses.garrison);
            city.playerDefenders.infantry = Math.max(0, def.infantry - res.defenderLosses.infantry);
            city.playerDefenders.archer = Math.max(0, def.archer - res.defenderLosses.archer);
            city.playerDefenders.cavalry = Math.max(0, def.cavalry - res.defenderLosses.cavalry);
            socket.emit('toast', { type: 'defeat', msg: `💀 ${city.name} savunması kırılamadı!` });
        }
        if (p.quests) p.quests.attack.current += 1;
        saveWorld(world); const all = loadAllUsers(); if (all[p.username]) { all[p.username].army = p.army; all[p.username].hospital = p.hospital; all[p.username].quests = p.quests; saveAllUsers(all); }
        io.emit('battleAnimation', { cityId: city.id, characterId: p.character, attackerColor: p.empireColor, result: res });
        io.emit('worldData', world); socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
    });

    socket.on('occupyMine', (data) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const world = loadWorld(); const mine = world.mines[data.mineId]; if (!mine) return;
        const sent = data.army; if (sent.infantry + sent.archer + sent.cavalry === 0) return socket.emit('error', 'Ordu gönder!');
        const def = { garrison: mine.occupierArmy.infantry + mine.occupierArmy.archer + mine.occupierArmy.cavalry > 0 ? 0 : 200, ...mine.occupierArmy };
        const res = calculateBattle(sent, { damage: p.stats.damage }, def, { defense: 0 });
        p.army.infantry = Math.max(0, p.army.infantry - sent.infantry + res.attackerSurvivors.infantry);
        p.army.archer = Math.max(0, p.army.archer - sent.archer + res.attackerSurvivors.archer);
        p.army.cavalry = Math.max(0, p.army.cavalry - sent.cavalry + res.attackerSurvivors.cavalry);
        p.hospital.infantry += res.attackerHospital.infantry; p.hospital.archer += res.attackerHospital.archer; p.hospital.cavalry += res.attackerHospital.cavalry;
        if (res.attackerWins) { mine.owner = p.username; mine.empireColor = p.empireColor; mine.occupierArmy = res.attackerSurvivors; mine.lastCollection = Date.now(); socket.emit('toast', { type: 'success', msg: `⛏️ ${mine.name} ele geçirildi!` }); }
        else socket.emit('toast', { type: 'defeat', msg: `⛏️ ${mine.name} savunuldu!` });
        saveWorld(world); const all = loadAllUsers(); if (all[p.username]) { all[p.username].army = p.army; all[p.username].hospital = p.hospital; saveAllUsers(all); }
        io.emit('battleAnimation', { cityId: mine.id, characterId: p.character, attackerColor: p.empireColor, result: res });
        io.emit('worldData', world); socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
    });

    socket.on('attackBoss', (data) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const world = loadWorld(); const boss = world.bosses[data.bossId]; if (!boss || boss.defeated) return socket.emit('error', 'Boss yok!');
        const sent = data.army; if (sent.infantry + sent.archer + sent.cavalry === 0) return socket.emit('error', 'Ordu gönder!');
        let dmg = (sent.infantry * 15 + sent.archer * 20 + sent.cavalry * 30) * (1 + (p.stats.damage || 0)); dmg = Math.floor(dmg);
        const lossR = 0.4;
        const losses = { infantry: Math.floor(sent.infantry * lossR), archer: Math.floor(sent.archer * lossR), cavalry: Math.floor(sent.cavalry * lossR) };
        p.army.infantry -= losses.infantry; p.army.archer -= losses.archer; p.army.cavalry -= losses.cavalry;
        p.hospital.infantry += Math.floor(losses.infantry * 0.6); p.hospital.archer += Math.floor(losses.archer * 0.6); p.hospital.cavalry += Math.floor(losses.cavalry * 0.6);
        boss.currentHp = Math.max(0, boss.currentHp - dmg); if (!boss.attackers[p.username]) boss.attackers[p.username] = 0; boss.attackers[p.username] += dmg;
        if (p.quests) p.quests.boss.current += 1;
        if (boss.currentHp <= 0) {
            boss.defeated = true; boss.respawnAt = Date.now() + 2 * 60 * 60 * 1000;
            const sorted = Object.entries(boss.attackers).sort((a, b) => b[1] - a[1]);
            const all = loadAllUsers();
            sorted.forEach(([un, d], i) => { const share = i === 0 ? 0.6 : 0.4 / Math.max(1, sorted.length - 1); const r = Math.floor(boss.reward * share); if (all[un]) { all[un].ryo += r; const s = Object.keys(activePlayers).find(k => activePlayers[k].username === un); if (s) { activePlayers[s].ryo = all[un].ryo; io.to(s).emit('ryoUpdate', all[un].ryo); io.to(s).emit('toast', { type: 'victory', msg: `🏆 ${boss.beast} yenildi! Ödül: ${r} Ryo!` }); } } });
            saveAllUsers(all); io.emit('toast', { type: 'info', msg: `⚔️ ${boss.beast} ${sorted[0][0]} tarafından öldürüldü!` });
        } else socket.emit('toast', { type: 'info', msg: `💥 ${boss.beast}'a ${dmg} hasar! (Kalan: ${boss.currentHp})` });
        saveWorld(world); const all = loadAllUsers(); if (all[p.username]) { all[p.username].army = p.army; all[p.username].hospital = p.hospital; all[p.username].quests = p.quests; saveAllUsers(all); }
        io.emit('battleAnimation', { cityId: boss.id, characterId: p.character, attackerColor: p.empireColor, result: { attackerWins: boss.defeated, atkPower: dmg, defPower: 0 } });
        io.emit('worldData', world); socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
    });

    socket.on('deployDefenders', (data) => {
        const p = activePlayers[socket.id]; if (!p) return;
        const world = loadWorld(); const city = world.cities[data.cityId];
        if (!city || city.owner !== p.username) return socket.emit('error', 'Şehir senin değil!');
        if (p.army.infantry < (data.infantry||0) || p.army.archer < (data.archer||0) || p.army.cavalry < (data.cavalry||0)) return socket.emit('error', 'Yetersiz asker!');
        p.army.infantry -= data.infantry||0; city.playerDefenders.infantry += data.infantry||0;
        p.army.archer -= data.archer||0; city.playerDefenders.archer += data.archer||0;
        p.army.cavalry -= data.cavalry||0; city.playerDefenders.cavalry += data.cavalry||0;
        saveWorld(world); const all = loadAllUsers(); if (all[p.username]) { all[p.username].army = p.army; saveAllUsers(all); }
        io.emit('worldData', world); socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
    });

    socket.on('createClan', (data) => {
        const p = activePlayers[socket.id]; if (!p || p.clan) return socket.emit('error', 'Zaten klandasın.');
        if (!data.name || data.name.length < 3) return socket.emit('error', 'Klan adı en az 3 karakter.');
        const clans = loadClans(); const id = data.name.toLowerCase().replace(/\s+/g, '_');
        if (clans[id]) return socket.emit('error', 'Klan adı var.');
        clans[id] = { name: data.name, leader: p.username, flag: data.flag || '🐉', color: p.empireColor || 0xff6600, members: [p.username], createdAt: Date.now() };
        saveClans(clans); p.clan = id;
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].clan = id; saveAllUsers(all); }
        io.emit('clansData', clans); socket.emit('toast', { type: 'success', msg: `Klan kuruldu!` });
    });
    socket.on('joinClan', (data) => {
        const p = activePlayers[socket.id]; if (!p || p.clan) return socket.emit('error', 'Zaten klandasın.');
        const clans = loadClans(); const c = clans[data.clanId]; if (!c || c.members.length >= 30) return socket.emit('error', 'Klan dolu/yok.');
        c.members.push(p.username); p.clan = data.clanId; saveClans(clans);
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].clan = data.clanId; saveAllUsers(all); }
        io.emit('clansData', clans); socket.emit('toast', { type: 'success', msg: `Klana katıldın!` });
    });
    socket.on('leaveClan', () => {
        const p = activePlayers[socket.id]; if (!p || !p.clan) return;
        const clans = loadClans(); const c = clans[p.clan]; if (c) { c.members = c.members.filter(m => m !== p.username); if (c.members.length === 0) delete clans[p.clan]; else if (c.leader === p.username) c.leader = c.members[0]; saveClans(clans); }
        p.clan = null; const all = loadAllUsers(); if (all[p.username]) { all[p.username].clan = null; saveAllUsers(all); }
        io.emit('clansData', clans);
    });

    socket.on('getLeaderboard', () => {
        const all = loadAllUsers(); const world = loadWorld();
        const arr = Object.values(all).map(p => { const c = { ...publicPlayer(p) }; c.power = calculatePlayerPower(p); c.cityCount = Object.values(world.cities).filter(x => x.owner === p.username).length; c.mineCount = Object.values(world.mines||{}).filter(x => x.owner === p.username).length; return c; });
        arr.sort((a, b) => b.power - a.power); socket.emit('leaderboardData', arr.slice(0, 100));
    });
    socket.on('getProfile', () => {
        const p = activePlayers[socket.id]; if (!p) return; checkQuestReset(p);
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].quests = p.quests; all[p.username].lastQuestReset = p.lastQuestReset; saveAllUsers(all); }
        socket.emit('profileData', { ...publicPlayer(p), power: calculatePlayerPower(p) });
    });
    socket.on('claimQuest', (data) => {
        const p = activePlayers[socket.id]; if (!p) return; checkQuestReset(p);
        const q = p.quests[data.questId]; if (!q || q.claimed || q.current < q.target) return socket.emit('error', 'Görev tamamlanmamış!');
        q.claimed = true; p.ryo += q.reward;
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].quests = p.quests; all[p.username].ryo = p.ryo; saveAllUsers(all); }
        socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
        socket.emit('toast', { type: 'success', msg: `Ödül alındı: ${q.reward} Ryo!` });
        socket.emit('profileData', { ...publicPlayer(p), power: calculatePlayerPower(p) });
    });

    socket.on('sendMessage', (data) => {
        const p = activePlayers[socket.id]; if (!p || !data.to || !data.msg) return;
        const all = loadAllUsers(); const t = Object.values(all).find(u => u.username.toLowerCase() === data.to.toLowerCase());
        if (!t) return socket.emit('error', 'Oyuncu yok.');
        if (!t.inbox) t.inbox = []; t.inbox.unshift({ from: p.username, msg: data.msg, date: Date.now(), read: false });
        if (t.inbox.length > 50) t.inbox.pop(); saveAllUsers(all);
        const s = Object.keys(activePlayers).find(k => activePlayers[k].username === t.username); if (s) io.to(s).emit('newMessage', { from: p.username, msg: data.msg, date: Date.now() });
        socket.emit('toast', { type: 'success', msg: 'Mesaj gönderildi.' });
    });
    socket.on('getInbox', () => { const p = activePlayers[socket.id]; if (!p) return; const all = loadAllUsers(); if (all[p.username] && all[p.username].inbox) { all[p.username].inbox.forEach(m => m.read = true); saveAllUsers(all); p.inbox = all[p.username].inbox; } socket.emit('inboxData', p.inbox || []); });
    socket.on('deleteMessage', (data) => { const p = activePlayers[socket.id]; if (!p) return; const all = loadAllUsers(); if (all[p.username] && all[p.username].inbox) { all[p.username].inbox = all[p.username].inbox.filter(m => m.date !== data.date); saveAllUsers(all); p.inbox = all[p.username].inbox; socket.emit('inboxData', p.inbox); } });

    socket.on('buildBase', (data) => {
        const p = activePlayers[socket.id]; if (!p || p.base) return socket.emit('error', 'Zaten üssün var!');
        if (p.ryo < 10000) return socket.emit('error', '10.000 Ryo gerekli!');
        p.ryo -= 10000; p.base = { x: data.x, z: data.z, level: 1, hp: 5000 };
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].ryo = p.ryo; all[p.username].base = p.base; saveAllUsers(all); }
        socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
        socket.emit('baseBuilt', p.base); socket.emit('toast', { type: 'victory', msg: '🏆 Ana Üssün kuruldu!' });
    });
    socket.on('upgradeBase', () => {
        const p = activePlayers[socket.id]; if (!p || !p.base) return;
        const cost = p.base.level * 5000; if (p.ryo < cost) return socket.emit('error', `${cost} Ryo gerekli!`);
        p.ryo -= cost; p.base.level += 1; p.base.hp += 2000;
        const all = loadAllUsers(); if (all[p.username]) { all[p.username].ryo = p.ryo; all[p.username].base = p.base; saveAllUsers(all); }
        socket.emit('armyUpdated', { army: p.army, ryo: p.ryo, hospital: p.hospital });
        socket.emit('baseBuilt', p.base); socket.emit('toast', { type: 'success', msg: `Üs Seviye ${p.base.level}'e yükseltildi!` });
    });

    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            const p = activePlayers[socket.id]; const all = loadAllUsers();
            if (all[p.username]) { all[p.username].ryo = p.ryo; all[p.username].army = p.army; all[p.username].hospital = p.hospital; all[p.username].quests = p.quests; all[p.username].clan = p.clan; saveAllUsers(all); }
            delete activePlayers[socket.id];
        }
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`[✓] AtlasWarfare Sunucu Port ${PORT} üzerinde aktif.`));