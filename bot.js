const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let DATA_DIR = process.env.DATA_DIR || '/var/data';
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (err) {
    DATA_DIR = path.join(__dirname, 'data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const playersDataPath = path.join(DATA_DIR, 'players.json');
const worldDataPath = path.join(DATA_DIR, 'world.json');
const clansDataPath = path.join(DATA_DIR, 'clans.json');

// index.html 'public' klasöründe yoksa sunucu dosyasının yanındakini kullan
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;

app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
app.use(express.json({ limit: '10mb' }));

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('⚠️ SESSION_SECRET tanımlı değil — sunucu her yeniden başladığında oyuncuların oturumu düşer.');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

// ═══════════════════════════════════════════
// MAİL SİSTEMİ (RESEND API - HTTPS üzerinden, Render free tier SMTP portlarını engellediği için)
// ═══════════════════════════════════════════
const MAIL_FROM_NAME = 'AtlasWarfare';
// Resend'de doğrulanmış bir domain yoksa bu adresi kullanmak zorundasın (test için):
const MAIL_FROM_ADDRESS = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
    console.error('❌ [MAIL] RESEND_API_KEY environment variable tanımlı değil! Kodlar e-posta yerine konsola yazılacak.');
} else {
    console.log('✅ [MAIL] Resend API anahtarı yüklendi, mail göndermeye hazır.');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function sendEmail(to, subject, body) {
    if (!resend) {
        console.log(`📧 [MAIL-KONSOL] Alıcı: ${to} | ${subject}\n${body}`);
        return false;
    }
    try {
        const { data, error } = await resend.emails.send({
            from: `${MAIL_FROM_NAME} <${MAIL_FROM_ADDRESS}>`,
            to: [to],
            subject: subject,
            text: body
        });
        if (error) {
            console.error('❌ [MAIL] E-posta Hatası:', error.message || error);
            return false;
        }
        console.log('📧 [MAIL] E-posta Başarıyla Gönderildi:', data?.id);
        return true;
    } catch (error) {
        console.error('❌ [MAIL] E-posta Hatası:', error.message);
        return false;
    }
}

// ═══════════════════════════════════════════
// SABİT VERİLER
// ═══════════════════════════════════════════
const CITIES = [
    { id:"tokyo", name:"Tokyo", type:"capital", lat:35.68, lng:139.69, garrison:5000, bonus:{damage:0.20, defense:0.15, cash:0.30} },
    { id:"london", name:"Londra", type:"capital", lat:51.50, lng:-0.12, garrison:4500, bonus:{defense:0.25, cash:0.20} },
    { id:"paris", name:"Paris", type:"capital", lat:48.85, lng:2.35, garrison:4000, bonus:{damage:0.15, cash:0.25} },
    { id:"berlin", name:"Berlin", type:"capital", lat:52.52, lng:13.40, garrison:4500, bonus:{defense:0.20, damage:0.10} },
    { id:"moscow", name:"Moskova", type:"capital", lat:55.75, lng:37.61, garrison:5500, bonus:{damage:0.25, defense:0.20} },
    { id:"beijing", name:"Pekin", type:"capital", lat:39.90, lng:116.40, garrison:5000, bonus:{damage:0.20, cash:0.25} },
    { id:"washington", name:"Washington", type:"capital", lat:38.90, lng:-77.03, garrison:4500, bonus:{defense:0.20, cash:0.30} },
    { id:"istanbul", name:"İstanbul", type:"capital", lat:41.00, lng:28.97, garrison:4000, bonus:{damage:0.15, defense:0.15, cash:0.15} },
    { id:"cairo", name:"Kahire", type:"capital", lat:30.04, lng:31.23, garrison:3500, bonus:{cash:0.35, defense:0.10} },
    { id:"rome", name:"Roma", type:"capital", lat:41.90, lng:12.49, garrison:4000, bonus:{defense:0.20, cash:0.20} },
    { id:"osaka", name:"Osaka", type:"normal", lat:34.69, lng:135.50, garrison:1500, bonus:{damage:0.08} },
    { id:"shanghai", name:"Şanghay", type:"normal", lat:31.23, lng:121.47, garrison:2000, bonus:{cash:0.15} },
    { id:"newyork", name:"New York", type:"normal", lat:40.71, lng:-74.00, garrison:2000, bonus:{cash:0.15} },
    { id:"losangeles", name:"Los Angeles", type:"normal", lat:34.05, lng:-118.24, garrison:1500, bonus:{cash:0.12} },
    { id:"sydney", name:"Sydney", type:"normal", lat:-33.86, lng:151.20, garrison:1200, bonus:{defense:0.10} },
    { id:"dubai", name:"Dubai", type:"normal", lat:25.20, lng:55.27, garrison:1800, bonus:{cash:0.20} },
    { id:"singapore", name:"Singapur", type:"normal", lat:1.35, lng:103.81, garrison:2000, bonus:{cash:0.18} },
    { id:"madrid", name:"Madrid", type:"normal", lat:40.41, lng:-3.70, garrison:1200, bonus:{defense:0.08} }
];

// gold → Cash, iron → Metal üretir (dakika başına)
const MINES = [
    { id:"mine_gold1", name:"Altın Madeni", type:"gold", lat:36, lng:140, yield:200 },
    { id:"mine_gold2", name:"Altın Madeni", type:"gold", lat:51, lng:0, yield:200 },
    { id:"mine_iron1", name:"Demir Madeni", type:"iron", lat:45, lng:13, yield:100 },
    { id:"mine_iron2", name:"Demir Madeni", type:"iron", lat:35, lng:139, yield:100 },
    { id:"mine_iron3", name:"Demir Madeni", type:"iron", lat:39, lng:116, yield:100 }
];
const MINE_GUARD = 300;

const BOSSES = [
    { id:"bijuu1", beast:"Vinnie (Tefeci)", lat:35, lng:139, hp:50000, reward:50000 },
    { id:"bijuu2", beast:"Salvo (Liman Patronu)", lat:-33, lng:151, hp:60000, reward:60000 },
    { id:"bijuu8", beast:"Baron (Kartel Lideri)", lat:35, lng:0, hp:200000, reward:200000 }
];
const BOSS_RESPAWN = 2 * 60 * 60 * 1000;

const CHARACTERS = [
    { id:"kyuubi", name:"Ateşçi Vito", element:"fire", role:"Kundakçı", ability:"Molotof Yağmuru", icon:"🔥", damage:50, defense:20, hp:500 },
    { id:"alchemist", name:"Kasa Ustası Marco", element:"earth", role:"Kasacı", ability:"Çelik Kasa", icon:"🧰", damage:40, defense:40, hp:800 },
    { id:"mistsword", name:"Gölge Lucia", element:"water", role:"Suikastçı", ability:"Sessiz Bıçak", icon:"🥷", damage:45, defense:30, hp:600 },
    { id:"raikage", name:"Tetikçi Rocco", element:"lightning", role:"Keskin Nişancı", ability:"Tek Kurşun", icon:"🎯", damage:60, defense:15, hp:400 },
    { id:"soulreaper", name:"Don Salvatore", element:"wind", role:"Aile Babası", ability:"Aile Onuru", icon:"🎩", damage:55, defense:25, hp:550 },
    { id:"titan", name:"Bıçakçı Nico", element:"earth", role:"Sokak Savaşçısı", ability:"Çapraz Kesik", icon:"🔪", damage:65, defense:10, hp:350 },
    { id:"rubber", name:"Boksör Tony", element:"lightning", role:"Fedai", ability:"Demir Yumruk", icon:"👊", damage:50, defense:30, hp:600 },
    { id:"icequeen", name:"Elena 'Kara Dul'", element:"water", role:"Kara Dul", ability:"Soğuk Hesap", icon:"💎", damage:40, defense:35, hp:650 }
];

const SHIELD_DURATION = 12 * 60 * 60 * 1000;     // ele geçirilen şehir kalkanı
const NEWBIE_SHIELD = 24 * 60 * 60 * 1000;       // yeni oyuncu koruması (ilk saldırıda kalkar)
const RAID_SHIELD = 60 * 60 * 1000;              // yağmalanan üsse 1 saat koruma
const MAX_LEVEL = 30;
const OFFLINE_CAP = 12 * 60 * 60 * 1000;         // çevrimdışı üretim en fazla 12 saat birikir

// Askerin maliyeti (Mafia City: eğitim Cash + Cargo + Arms + Metal ister)
const TROOP_COST = { cash: 50, cargo: 20, arms: 15, metal: 15 };
const HEAL_COST = { cash: 25 };
const BASE_BUILD_COST = 5000;

// Bina yükseltme maliyeti — istemcideki computeNextCost ile birebir aynı
const UPGRADE_COST = {
    mansion: { cash: 5000, cargo: 5000 }, wall: { cash: 2000, cargo: 2000 },
    cargo: { cash: 1000 }, counterfeiter: { cash: 1000 },
    ammu: { cargo: 1500 }, smelter: { cargo: 1500 },
    invest: { cash: 3000 }, diner: { cash: 2500 }, hospital: { cash: 2500 },
    camp: { cargo: 2000 }, vault: { cash: 5000 }, pawnbroker: { cash: 2000 },
    blackmarket: { cargo: 2500 }, radar: { cash: 4000, cargo: 4000 }, security: { cash: 3500, cargo: 3500 }
};
function upgradeCost(kind, level) {
    const base = UPGRADE_COST[kind] || UPGRADE_COST.wall; const out = {};
    Object.entries(base).forEach(([r, v]) => out[r] = Math.floor(v * Math.pow(1.5, level)));
    return out;
}

// Üssün etrafındaki binalar (ox/oz: mansion'a göre konum). id'ler sabit, istemci bunlarla yükseltme ister.
const BASE_LAYOUT = [
    { id:'cargo_1', kind:'cargo', ox:60, oz:40 },
    { id:'counterfeiter_1', kind:'counterfeiter', ox:-60, oz:40 },
    { id:'invest_main', kind:'invest', ox:0, oz:80 },
    { id:'diner_main', kind:'diner', ox:0, oz:-80 },
    { id:'ammu_1', kind:'ammu', ox:80, oz:0 },
    { id:'smelter_1', kind:'smelter', ox:-80, oz:0 },
    { id:'cargo_2', kind:'cargo', ox:120, oz:60 },
    { id:'counterfeiter_2', kind:'counterfeiter', ox:-120, oz:60 },
    { id:'cargo_3', kind:'cargo', ox:120, oz:-60 },
    { id:'counterfeiter_3', kind:'counterfeiter', ox:-120, oz:-60 },
    { id:'hospital_main', kind:'hospital', ox:140, oz:0 },
    { id:'diner_2', kind:'diner', ox:-140, oz:0 },
    { id:'camp_main', kind:'camp', ox:60, oz:-120 },
    { id:'vault_main', kind:'vault', ox:-60, oz:-120 },
    { id:'wall_main', kind:'wall', ox:0, oz:140 }
];

// Dakika başına üretim (bina seviyesi ile çarpılır)
const PRODUCTION = { counterfeiter: { cash: 30 }, cargo: { cargo: 30 }, ammu: { arms: 15 }, smelter: { metal: 15 } };

// Yatırım Merkezi — isimler istemcideki listeyle birebir aynı
const INVESTMENTS = {
    economy: { 'Cash Üretim +5%': { cost: 1000, effect: 'cashProd', value: 0.05 }, 'Cargo Üretim +5%': { cost: 1000, effect: 'cargoProd', value: 0.05 }, 'Depolama +10%': { cost: 1500, effect: 'storage', value: 0.10 } },
    military: { 'Saldırı +3%': { cost: 2000, effect: 'attack', value: 0.03 }, 'Savunma +3%': { cost: 2000, effect: 'defense', value: 0.03 }, 'Eğitim Hızı +5%': { cost: 1500, effect: 'trainCost', value: 0.05 } },
    resource: { 'Arms Üretimi +5%': { cost: 1800, effect: 'armsProd', value: 0.05 }, 'Metal Üretimi +5%': { cost: 1800, effect: 'metalProd', value: 0.05 } },
    crime: { 'Crime Ops +50': { cost: 3000, effect: 'crimeOps', value: 50 }, 'Yağma Hızı +10%': { cost: 2500, effect: 'plunder', value: 0.10 } },
    defense: { 'Duvar Dayanıklılığı +5%': { cost: 1500, effect: 'wall', value: 0.05 }, 'Tuzak Hasarı +10%': { cost: 2000, effect: 'trap', value: 0.10 } }
};
function investCost(baseCost, level) { return Math.floor(baseCost * Math.pow(1.5, level)); }

// Mansion seviyesine göre açılan kahramanlar (karakterine göre)
const HERO_UNLOCK_LEVEL = 5;

// ═══════════════════════════════════════════
// KAYIT / YÜKLEME (bellekte tutulur, gecikmeli diske yazılır)
// ═══════════════════════════════════════════
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function writeJsonAtomic(p, data) { const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, p); }

let users = readJson(playersDataPath, {});
let world = readJson(worldDataPath, null);
let clans = readJson(clansDataPath, {});

const dirty = { users: false, world: false, clans: false };
function markDirty(k) { dirty[k] = true; }
function flushAll() {
    try {
        if (dirty.users) { writeJsonAtomic(playersDataPath, users); dirty.users = false; }
        if (dirty.world) { writeJsonAtomic(worldDataPath, world); dirty.world = false; }
        if (dirty.clans) { writeJsonAtomic(clansDataPath, clans); dirty.clans = false; }
    } catch (e) { console.error('❌ Kayıt hatası:', e.message); }
}
setInterval(flushAll, 3000);
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { flushAll(); process.exit(0); }));

function initWorld() {
    if (!world || !world.cities || Object.keys(world.cities).length === 0) {
        world = { cities: {}, mines: {}, bosses: {}, createdAt: Date.now() };
    }
    world.mines = world.mines || {}; world.bosses = world.bosses || {};
    CITIES.forEach(c => {
        const ex = world.cities[c.id] || {};
        const defenders = typeof ex.defenders === 'number' ? ex.defenders
            : Object.values(ex.playerDefenders || {}).reduce((a, b) => a + (b || 0), 0);
        world.cities[c.id] = {
            ...c, x: (c.lng / 180) * 500, z: -(c.lat / 90) * 250,
            owner: ex.owner || null, ownerClan: ex.ownerClan || null, empireColor: ex.empireColor || null,
            garrison: typeof ex.garrison === 'number' ? ex.garrison : c.garrison, baseGarrison: c.garrison,
            defenders, shieldUntil: ex.shieldUntil || 0, lastIncome: ex.lastIncome || Date.now()
        };
    });
    MINES.forEach(m => {
        const ex = world.mines[m.id] || {};
        world.mines[m.id] = { ...m, x: (m.lng / 180) * 500, z: -(m.lat / 90) * 250, owner: ex.owner || null, empireColor: ex.empireColor || null, guard: MINE_GUARD, lastCollection: ex.lastCollection || Date.now() };
    });
    BOSSES.forEach(b => {
        const ex = world.bosses[b.id] || {};
        world.bosses[b.id] = { ...b, x: (b.lng / 180) * 500, z: -(b.lat / 90) * 250, currentHp: typeof ex.currentHp === 'number' ? Math.min(ex.currentHp, b.hp) : b.hp, defeated: !!ex.defeated, respawnAt: ex.respawnAt || 0, attackers: ex.attackers || {} };
    });
    markDirty('world');
}
initWorld();

// ═══════════════════════════════════════════
// OYUNCU VERİSİ
// ═══════════════════════════════════════════
function hashPassword(p) { const s = crypto.randomBytes(16).toString('hex'); const h = crypto.scryptSync(p, s, 64).toString('hex'); return `${s}:${h}`; }
function verifyPassword(p, s) { if (!s || !s.includes(':')) return false; const [salt, hash] = s.split(':'); const check = crypto.scryptSync(String(p || ''), salt, 64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex')); }
function signToken(u) { const payload = Buffer.from(JSON.stringify({ u, exp: Date.now() + 90 * 24 * 60 * 60 * 1000 })).toString('base64url'); const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url'); return payload + '.' + sig; }
function verifyToken(t) { if (typeof t !== 'string' || !t.includes('.')) return null; const [p, sig] = t.split('.'); const exp = crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url'); if (sig !== exp) return null; try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); if (Date.now() > d.exp) return null; return d.u; } catch (e) { return null; } }
function generateVerifyCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function int(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; }

function freshQuests() {
    return { train: { target: 100, current: 0, reward: 2000, claimed: false }, attack: { target: 1, current: 0, reward: 3000, claimed: false }, boss: { target: 1, current: 0, reward: 5000, claimed: false }, upgrade: { target: 3, current: 0, reward: 4000, claimed: false } };
}

function buildPlayerData(username, data) {
    return {
        username, email: data.email, password: hashPassword(data.password),
        empireColor: null, character: null, level: 1, xp: 0,
        cash: 20000, cargo: 15000, arms: 5000, metal: 5000,
        crew: 500, hospital: { infantry: 0, archer: 0, cavalry: 0 },
        stats: { damage: 0, defense: 0 }, clan: null,
        base: null, buildings: [], investments: {}, heroes: [],
        shieldUntil: Date.now() + NEWBIE_SHIELD,
        quests: freshQuests(), lastQuestReset: Date.now(), lastTick: Date.now(),
        inbox: [], verified: false, createdAt: Date.now()
    };
}

function makeBuildings(base) {
    return BASE_LAYOUT.map(l => ({ id: l.id, kind: l.kind, level: 1, x: base.x + l.ox, z: base.z + l.oz }));
}

// Eski (Naruto/ryo) kayıtları yeni Mafia City yapısına çevirir; eksik alanları tamamlar
function migrateUser(u) {
    if (!u) return u;
    if (u.cash === undefined) u.cash = typeof u.ryo === 'number' ? u.ryo : 20000;
    delete u.ryo;
    if (u.cargo === undefined) u.cargo = 15000;
    if (u.arms === undefined) u.arms = 5000;
    if (u.metal === undefined) u.metal = 5000;
    if (u.crew === undefined) {
        const a = u.army || {}; u.crew = (a.infantry || 0) + (a.archer || 0) + (a.cavalry || 0) + (a.total || 0);
        if (!u.crew) u.crew = 500;
    }
    delete u.army;
    const h = u.hospital || {};
    u.hospital = { infantry: (h.infantry || 0) + (h.archer || 0) + (h.cavalry || 0), archer: 0, cavalry: 0 };
    if (!u.investments) u.investments = {};
    if (!u.heroes) u.heroes = [];
    u.heroes.forEach(h => { const c = CHARACTERS.find(x => x.id === h.id); if (c) { h.name = c.name; h.icon = c.icon; } });
    if (!u.inbox) u.inbox = [];
    if (!u.quests || !u.quests.upgrade) { u.quests = freshQuests(); u.lastQuestReset = Date.now(); }
    if (!u.lastTick) u.lastTick = Date.now();
    if (u.shieldUntil === undefined) u.shieldUntil = 0;
    if (u.base) {
        u.base.level = u.base.level || 1;
        if (!Array.isArray(u.buildings) || u.buildings.length === 0) u.buildings = makeBuildings(u.base);
        // sonradan eklenen yerleşim binalarını tamamla
        BASE_LAYOUT.forEach(l => { if (!u.buildings.some(b => b.id === l.id)) u.buildings.push({ id: l.id, kind: l.kind, level: 1, x: u.base.x + l.ox, z: u.base.z + l.oz }); });
    } else u.buildings = [];
    applyCharacterStats(u);
    delete u.inventory; delete u.items; delete u.equip; delete u.hp; delete u.maxHp; delete u.x; delete u.y; delete u.z;
    return u;
}
function applyCharacterStats(u) {
    const c = CHARACTERS.find(x => x.id === u.character);
    u.stats = { damage: c ? c.damage / 500 : 0, defense: c ? c.defense / 500 : 0 };
}
Object.values(users).forEach(migrateUser); markDirty('users');

// ── Türetilmiş değerler ──
function bLevels(u, kind) { return (u.buildings || []).filter(b => b.kind === kind).reduce((a, b) => a + (b.level || 1), 0); }
function bLevel(u, id) { const b = (u.buildings || []).find(x => x.id === id); return b ? b.level : 0; }
function invLevel(u, effect) {
    let lvl = 0;
    Object.entries(INVESTMENTS).forEach(([cat, items]) => Object.entries(items).forEach(([name, it]) => { if (it.effect === effect) lvl += (u.investments || {})[cat + ':' + name] || 0; }));
    return lvl;
}
function invBonus(u, effect) {
    let v = 0;
    Object.entries(INVESTMENTS).forEach(([cat, items]) => Object.entries(items).forEach(([name, it]) => { if (it.effect === effect) v += ((u.investments || {})[cat + ':' + name] || 0) * it.value; }));
    return v;
}
function heroBonus(u) { return (u.heroes || []).reduce((a, h) => a + (h.stars || 1) * 0.02, 0); }
function cityBonus(u, key) { return Object.values(world.cities).filter(c => c.owner === u.username).reduce((a, c) => a + (c.bonus?.[key] || 0), 0); }
function attackMult(u) { return 1 + (u.stats?.damage || 0) + invBonus(u, 'attack') + heroBonus(u) + cityBonus(u, 'damage'); }
function defenseMult(u) { return 1 + (u.stats?.defense || 0) + invBonus(u, 'defense') + invBonus(u, 'wall') + invBonus(u, 'trap') + heroBonus(u) + cityBonus(u, 'defense'); }
function crimeOps(u) { return 300 + bLevels(u, 'diner') * 300 + invBonus(u, 'crimeOps'); }       // tek seferde gönderilebilecek asker
function trainCap(u) { return u.base ? 500 + bLevels(u, 'camp') * 500 : 500; }                      // tek seferde eğitilebilecek asker
function hospitalCap(u) { return 500 + bLevels(u, 'hospital') * 2000; }
function protectedAmount(u) { return Math.floor((5000 + bLevels(u, 'vault') * 10000) * (1 + invBonus(u, 'storage'))); } // kasa korur
function vipLevel(u) { return 1 + Math.floor(((u.base?.level) || 1) / 3); }

function productionPerMin(u) {
    const p = { cash: 0, cargo: 0, arms: 0, metal: 0 };
    if (!u.base) return p;
    (u.buildings || []).forEach(b => { const prod = PRODUCTION[b.kind]; if (prod) Object.entries(prod).forEach(([r, v]) => p[r] += v * (b.level || 1)); });
    p.cash *= 1 + invBonus(u, 'cashProd'); p.cargo *= 1 + invBonus(u, 'cargoProd');
    p.arms *= 1 + invBonus(u, 'armsProd'); p.metal *= 1 + invBonus(u, 'metalProd');
    return p;
}

// Son tick'ten beri biriken üretimi ekle
function accrue(u) {
    const now = Date.now();
    const elapsed = Math.min(OFFLINE_CAP, Math.max(0, now - (u.lastTick || now)));
    u.lastTick = now;
    if (!elapsed || !u.base) return;
    const p = productionPerMin(u); const mins = elapsed / 60000;
    u._frac = u._frac || {};
    ['cash', 'cargo', 'arms', 'metal'].forEach(r => {
        const add = p[r] * mins + (u._frac[r] || 0);
        const whole = Math.floor(add); u[r] = (u[r] || 0) + whole; u._frac[r] = add - whole;
    });
}

function calculatePlayerPower(u) {
    if (!u) return 0;
    let power = (u.crew || 0) * 3 + (u.hospital?.infantry || 0);
    power += (u.buildings || []).reduce((a, b) => a + (b.level || 1) * 150, 0);
    if (u.base) power += (u.base.level || 1) * 1000;
    Object.values(world.cities).forEach(c => { if (c.owner === u.username) power += c.type === 'capital' ? 5000 : 2000; });
    Object.values(world.mines).forEach(m => { if (m.owner === u.username) power += 1000; });
    power += Object.values(u.investments || {}).reduce((a, b) => a + b * 200, 0);
    power += (u.heroes || []).reduce((a, h) => a + (h.stars || 1) * 500, 0);
    return Math.floor(power);
}

function checkQuestReset(u) {
    if (!u.lastQuestReset || (Date.now() - u.lastQuestReset) > 24 * 60 * 60 * 1000) { u.quests = freshQuests(); u.lastQuestReset = Date.now(); }
}
function questProgress(u, key, n = 1) { checkQuestReset(u); if (u.quests[key]) u.quests[key].current += n; }

function publicPlayer(u) {
    if (!u) return u;
    const { password, _frac, ...safe } = u;
    return { ...safe, army: { total: u.crew }, power: calculatePlayerPower(u), crimeOps: crimeOps(u), vip: vipLevel(u), trainCap: trainCap(u), hospitalCap: hospitalCap(u), production: productionPerMin(u) };
}
function resourceSnapshot(u) {
    return { cash: u.cash, cargo: u.cargo, arms: u.arms, metal: u.metal, crew: u.crew, army: { total: u.crew }, hospital: u.hospital, power: calculatePlayerPower(u), crimeOps: crimeOps(u), vip: vipLevel(u), trainCap: trainCap(u), hospitalCap: hospitalCap(u), investments: u.investments, heroes: u.heroes, shieldUntil: u.shieldUntil, production: productionPerMin(u) };
}

// ═══════════════════════════════════════════
// BAĞLANTI YÖNETİMİ
// ═══════════════════════════════════════════
const pendingVerifications = {};
const passwordResetCodes = {};
const sessions = {}; // socket.id → username
function socketsOf(username) { return Object.keys(sessions).filter(id => sessions[id] === username); }
function emitTo(username, ev, data) { socketsOf(username).forEach(id => io.to(id).emit(ev, data)); }
function pushResources(username) { const u = users[username]; if (u) emitTo(username, 'resourcesUpdate', resourceSnapshot(u)); }
function isOnline(username) { return socketsOf(username).length > 0; }
function broadcastWorld() { io.emit('worldData', world); }

function canAfford(u, cost) { return Object.entries(cost).every(([r, v]) => (u[r] || 0) >= v); }
function pay(u, cost) { Object.entries(cost).forEach(([r, v]) => u[r] -= v); }
function costText(cost) { const names = { cash: 'Cash', cargo: 'Cargo', arms: 'Arms', metal: 'Metal' }; return Object.entries(cost).map(([r, v]) => `${v.toLocaleString('tr-TR')} ${names[r]}`).join(' + '); }
function sameClan(a, b) { return a && b && a.clan && a.clan === b.clan; }

// Yaralıları hastaneye yatır; kapasite dolarsa kalanlar ölür
function sendToHospital(u, wounded) {
    const room = Math.max(0, hospitalCap(u) - (u.hospital.infantry || 0));
    const admitted = Math.min(room, wounded);
    u.hospital.infantry += admitted;
    return { admitted, dead: wounded - admitted };
}

// ═══════════════════════════════════════════
// SAVAŞ MANTIĞI (Mafia City tarzı: güç oranı → kayıplar, yaralılar hastaneye)
// ═══════════════════════════════════════════
function resolveBattle(attackTroops, atkMult, defenseTroops, defMult) {
    let atkPower = attackTroops * 10 * atkMult * (0.9 + Math.random() * 0.2);
    let defPower = defenseTroops * 12 * defMult * (0.9 + Math.random() * 0.2);
    const attackerWins = atkPower > defPower;
    let atkLossRate, defLossRate;
    if (attackerWins) {
        const r = defPower / Math.max(1, atkPower);   // 0..1 — savunma ne kadar güçlüyse kayıp o kadar büyük
        atkLossRate = 0.1 + 0.4 * r; defLossRate = 0.6 + 0.3 * (1 - r);
    } else {
        const r = atkPower / Math.max(1, defPower);   // 0..1
        atkLossRate = 0.8 - 0.3 * r; defLossRate = 0.5 * r;
    }
    const attackerLosses = Math.floor(attackTroops * atkLossRate);
    const defenderLosses = Math.floor(defenseTroops * defLossRate);
    return {
        attackerWins, atkPower: Math.round(atkPower), defPower: Math.round(defPower),
        attackerLosses, defenderLosses, attackerSurvivors: attackTroops - attackerLosses,
        attackerWounded: Math.floor(attackerLosses * 0.7), defenderWounded: Math.floor(defenderLosses * 0.7)
    };
}

// Saldırıya çıkacak askeri doğrula
function takeMarch(socket, u, data) {
    const want = int(data && (data.army?.total ?? data.total ?? data.amount));
    if (!want) { socket.emit('error', 'Gönderilecek asker sayısını gir!'); return 0; }
    if (want > u.crew) { socket.emit('error', `Yetersiz asker! (Mevcut: ${u.crew})`); return 0; }
    const cap = crimeOps(u);
    if (want > cap) { socket.emit('error', `Crime Ops kapasiten ${cap}. Lokantayı yükselterek artır.`); return 0; }
    return want;
}

// ═══════════════════════════════════════════
// PASİF GELİR, BOSS RESPAWN, ŞEHİR GARNİZONU (her dakika)
// ═══════════════════════════════════════════
let tickCount = 0;
setInterval(() => {
    const now = Date.now(); tickCount++; let worldChanged = false;
    // çevrimiçi oyuncuların üretimi
    new Set(Object.values(sessions)).forEach(un => { const u = users[un]; if (u) { accrue(u); markDirty('users'); } });
    // madenler: sahibine dakikada yield kadar (altın → Cash, demir → Metal)
    Object.values(world.mines).forEach(m => {
        const u = m.owner && users[m.owner]; if (!u) { m.lastCollection = now; return; }
        const mins = Math.floor((now - m.lastCollection) / 60000);
        if (mins >= 1) { u[m.type === 'gold' ? 'cash' : 'metal'] += m.yield * mins; m.lastCollection += mins * 60000; markDirty('users'); worldChanged = true; }
    });
    // şehirler: 5 dakikada bir sahibine Cash, sahipsizlerin garnizonu yavaşça yenilenir
    if (tickCount % 5 === 0) {
        Object.values(world.cities).forEach(c => {
            const u = c.owner && users[c.owner];
            if (u) { u.cash += Math.floor((c.bonus?.cash || 0.1) * 1000) + (c.type === 'capital' ? 500 : 200); c.lastIncome = now; markDirty('users'); }
            else if (c.garrison < c.baseGarrison) { c.garrison = Math.min(c.baseGarrison, c.garrison + Math.ceil(c.baseGarrison * 0.05)); worldChanged = true; }
        });
    }
    Object.values(world.bosses).forEach(b => {
        if (b.defeated && now >= b.respawnAt) { b.defeated = false; b.currentHp = b.hp; b.attackers = {}; io.emit('toast', { type: 'info', msg: `⚠️ ${b.beast} yeniden ortaya çıktı!` }); worldChanged = true; }
    });
    new Set(Object.values(sessions)).forEach(pushResources);
    if (worldChanged) { markDirty('world'); broadcastWorld(); }
}, 60 * 1000);

// ═══════════════════════════════════════════
// SOCKET.IO EVENTLERİ
// ═══════════════════════════════════════════
io.on('connection', (socket) => {
    const me = () => { const un = sessions[socket.id]; return un ? users[un] : null; };
    const on = (ev, fn) => socket.on(ev, (data) => { try { fn(data || {}); } catch (e) { console.error(`❌ [${ev}]`, e); socket.emit('error', 'Sunucu hatası.'); } });

    function startSession(username) {
        const u = users[username]; migrateUser(u); accrue(u); checkQuestReset(u);
        sessions[socket.id] = username; markDirty('users');
        // önce dünya verileri, sonra oyuncu — istemci girişte haritayı hemen çizebilsin
        socket.emit('charactersData', CHARACTERS); socket.emit('clansData', clans); socket.emit('worldData', world);
        return { token: signToken(username), ...publicPlayer(u) };
    }

    on('loginWithToken', (token) => {
        const un = verifyToken(token); if (!un) return socket.emit('loginError', 'Oturum süresi dolmuş.');
        if (!users[un]) return socket.emit('loginError', 'Hesap bulunamadı.');
        socket.emit('loginSuccess', startSession(un));
    });

    on('register', (data) => {
        const username = String(data.username || '').trim(), email = String(data.email || '').trim(), password = String(data.password || ''), passwordConfirm = String(data.passwordConfirm || '');
        if (username.length < 3 || username.length > 16) return socket.emit('loginError', 'Kahraman adı 3-16 karakter olmalı.');
        if (!/^[a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ]+$/.test(username)) return socket.emit('loginError', 'Geçersiz karakter adı.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return socket.emit('loginError', 'Geçerli e-posta gir.');
        if (password.length < 6) return socket.emit('loginError', 'Şifre en az 6 karakter.');
        if (password !== passwordConfirm) return socket.emit('loginError', 'Şifreler eşleşmiyor.');
        if (Object.keys(users).some(u => u.toLowerCase() === username.toLowerCase())) return socket.emit('loginError', 'Bu ad alınmış.');
        if (Object.values(users).some(u => u.email && u.email.toLowerCase() === email.toLowerCase())) return socket.emit('loginError', 'Bu e-posta kayıtlı.');

        const code = generateVerifyCode();
        pendingVerifications[username] = { code, email, userData: buildPlayerData(username, { email, password }), expires: Date.now() + 10 * 60 * 1000 };
        sendEmail(email, '⚔️ AtlasWarfare - Doğrulama', `Patron ${username}, doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir.`);
        socket.emit('registerSuccess', { username });
    });

    on('verifyEmail', (data) => {
        const { username, code } = data; const p = pendingVerifications[username];
        if (!p || Date.now() > p.expires || p.code !== String(code || '').trim()) return socket.emit('loginError', 'Kod hatalı veya süresi dolmuş.');
        if (users[username]) return socket.emit('loginError', 'Bu ad alınmış.');
        p.userData.verified = true; users[username] = p.userData; delete pendingVerifications[username]; markDirty('users');
        socket.emit('verifySuccess', startSession(username));
    });

    on('resendVerifyCode', (data) => {
        const p = pendingVerifications[data.username];
        if (!p) return socket.emit('loginError', 'Doğrulama isteği bulunamadı.');
        p.code = generateVerifyCode(); p.expires = Date.now() + 10 * 60 * 1000;
        sendEmail(p.email, '⚔️ AtlasWarfare - Yeni Doğrulama Kodu', `Yeni doğrulama kodunuz: ${p.code}`);
        socket.emit('loginError', '');
    });

    on('forgotPassword', (data) => {
        const email = String(data.email || '').toLowerCase();
        const user = Object.values(users).find(u => u.email && u.email.toLowerCase() === email);
        if (!user) return socket.emit('loginError', 'E-posta kayıtlı değil.');
        const code = generateVerifyCode();
        passwordResetCodes[email] = { code, username: user.username, expires: Date.now() + 10 * 60 * 1000, tries: 0 };
        sendEmail(email, '⚔️ AtlasWarfare - Şifre Sıfırlama', `Merhaba ${user.username}, şifre sıfırlama kodun: ${code}`);
        socket.emit('forgotPasswordCodeSent');
    });

    function checkResetCode(email, code) {
        const r = passwordResetCodes[email];
        if (!r || Date.now() > r.expires) return 'Kod süresi dolmuş.';
        if (r.tries >= 5) { delete passwordResetCodes[email]; return 'Çok fazla deneme. Yeni kod iste.'; }
        if (r.code !== String(code || '').trim()) { r.tries++; return 'Kod hatalı.'; }
        return null;
    }
    on('verifyResetCode', (data) => {
        const email = String(data.email || '').toLowerCase(); const err = checkResetCode(email, data.code);
        if (err) return socket.emit('resetCodeError', err);
        socket.emit('resetCodeVerified', { email, username: passwordResetCodes[email].username });
    });

    on('resetPassword', (data) => {
        const email = String(data.email || '').toLowerCase(), newPassword = String(data.newPassword || '');
        const err = checkResetCode(email, data.code);
        if (err) { socket.emit('resetPasswordError', err); return socket.emit('loginError', err); }
        if (newPassword.length < 6) { socket.emit('resetPasswordError', 'Şifre en az 6 karakter.'); return socket.emit('loginError', 'Şifre en az 6 karakter.'); }
        const user = users[passwordResetCodes[email].username];
        if (!user) return socket.emit('loginError', 'Kullanıcı yok.');
        user.password = hashPassword(newPassword); markDirty('users');
        delete passwordResetCodes[email];
        socket.emit('resetPasswordSuccess');
    });

    on('login', (data) => {
        const username = String(data.username || '').trim(), password = String(data.password || '');
        if (username === 'admin' && password === ADMIN_PASSWORD) {
            if (!users.admin) { users.admin = buildPlayerData('admin', { email: 'admin@atlaswarfare.local', password: ADMIN_PASSWORD }); users.admin.verified = true; markDirty('users'); }
            return socket.emit('loginSuccess', startSession('admin'));
        }
        const u = users[username] || Object.values(users).find(x => x.email && x.email.toLowerCase() === username.toLowerCase());
        if (!u) return socket.emit('loginError', 'Hesap bulunamadı.');
        if (!verifyPassword(password, u.password)) return socket.emit('loginError', 'Şifre hatalı.');
        if (!u.verified) return socket.emit('loginError', 'E-posta doğrulanmamış.');
        socket.emit('loginSuccess', startSession(u.username));
    });

    on('selectCharacter', (data) => {
        const u = me(); if (!u) return;
        const c = CHARACTERS.find(x => x.id === data.characterId); if (!c) return;
        u.character = c.id; applyCharacterStats(u); markDirty('users');
        socket.emit('characterSelected', { character: c.id, stats: u.stats });
    });

    on('setEmpireColor', (data) => {
        const u = me(); if (!u) return;
        const color = int(data.color); if (color > 0xffffff) return;
        u.empireColor = color; markDirty('users');
        // sahip olunan şehir/madenlerin rengini de güncelle
        Object.values(world.cities).forEach(c => { if (c.owner === u.username) c.empireColor = color; });
        Object.values(world.mines).forEach(m => { if (m.owner === u.username) m.empireColor = color; });
        markDirty('world');
        socket.emit('empireColorSet', { color });
    });

    // ── Eğitim / Hastane ──
    on('trainArmy', (data) => {
        const u = me(); if (!u) return; accrue(u);
        const n = int(data.amount ?? data.total); if (!n) return socket.emit('error', 'Eğitilecek asker sayısını gir!');
        const cap = trainCap(u); if (n > cap) return socket.emit('error', `Tek seferde en fazla ${cap} asker eğitebilirsin. Eğitim Kampı'nı yükselt.`);
        const discount = Math.max(0.5, 1 - invBonus(u, 'trainCost'));
        const cost = {}; Object.entries(TROOP_COST).forEach(([r, v]) => cost[r] = Math.ceil(v * n * discount));
        if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz kaynak! Gerekli: ${costText(cost)}`);
        pay(u, cost); u.crew += n; questProgress(u, 'train', n); markDirty('users');
        pushResources(u.username);
        socket.emit('toast', { type: 'success', msg: `👥 ${n} asker eğitildi!` });
    });

    on('healArmy', (data) => {
        const u = me(); if (!u) return; accrue(u);
        const n = Math.min(int(data.amount ?? data.infantry), u.hospital.infantry || 0);
        if (!n) return socket.emit('error', 'Hastanede iyileştirilecek asker yok.');
        const cost = { cash: HEAL_COST.cash * n };
        if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz Cash! Gerekli: ${costText(cost)}`);
        pay(u, cost); u.hospital.infantry -= n; u.crew += n; markDirty('users');
        pushResources(u.username);
        socket.emit('toast', { type: 'success', msg: `🏥 ${n} asker iyileştirildi!` });
    });

    // ── Şehir saldırısı ──
    on('attackCity', (data) => {
        const u = me(); if (!u) return;
        const city = world.cities[data.cityId]; if (!city) return socket.emit('error', 'Şehir bulunamadı.');
        if (city.owner === u.username) return socket.emit('error', 'Bu şehir zaten senin!');
        const owner = city.owner && users[city.owner];
        if (owner && sameClan(u, owner)) return socket.emit('error', 'Klan arkadaşının şehrine saldıramazsın!');
        if (city.shieldUntil > Date.now()) return socket.emit('error', `Şehir kalkanlı! (${Math.ceil((city.shieldUntil - Date.now()) / 60000)} dk)`);
        const sent = takeMarch(socket, u, data); if (!sent) return;

        const defTroops = (city.garrison || 0) + (city.defenders || 0);
        const defMult = (1 + (city.bonus?.defense || 0)) * (owner ? defenseMult(owner) : 1);
        const res = resolveBattle(sent, attackMult(u), defTroops, defMult);

        u.crew -= res.attackerLosses; const hosp = sendToHospital(u, res.attackerWounded);
        // savunma kayıpları önce oyuncu askerlerinden, sonra garnizondan düşer
        const defLossPlayer = Math.min(city.defenders || 0, Math.round(res.defenderLosses * ((city.defenders || 0) / Math.max(1, defTroops))));
        const defLossGarrison = res.defenderLosses - defLossPlayer;
        city.defenders = Math.max(0, (city.defenders || 0) - defLossPlayer);
        city.garrison = Math.max(0, (city.garrison || 0) - defLossGarrison);
        if (owner && defLossPlayer) sendToHospital(owner, Math.floor(defLossPlayer * 0.7));

        if (res.attackerWins) {
            // kalan savunmacılar eski sahibine döner
            if (owner) { owner.crew += city.defenders; emitTo(owner.username, 'toast', { type: 'defeat', msg: `💀 ${city.name} şehrini ${u.username} ele geçirdi!` }); pushResources(owner.username); }
            city.owner = u.username; city.ownerClan = u.clan; city.empireColor = u.empireColor;
            city.defenders = 0; city.garrison = 0; city.shieldUntil = Date.now() + SHIELD_DURATION;
            socket.emit('toast', { type: 'victory', msg: `🏆 ${city.name} ele geçirildi! (Kayıp: ${res.attackerLosses})` });
        } else {
            if (owner) emitTo(owner.username, 'toast', { type: 'success', msg: `🛡️ ${city.name} şehrin ${u.username} saldırısını püskürttü!` });
            socket.emit('toast', { type: 'defeat', msg: `💀 ${city.name} savunması kırılamadı! (Kayıp: ${res.attackerLosses}, hastane: ${hosp.admitted})` });
        }
        questProgress(u, 'attack'); markDirty('users'); markDirty('world');
        io.emit('battleAnimation', { cityId: city.id, characterId: u.character, attackerColor: u.empireColor, result: res });
        broadcastWorld(); pushResources(u.username);
    });

    // ── Maden işgali ──
    on('occupyMine', (data) => {
        const u = me(); if (!u) return;
        const mine = world.mines[data.mineId]; if (!mine) return socket.emit('error', 'Maden bulunamadı.');
        if (mine.owner === u.username) return socket.emit('error', 'Bu maden zaten senin!');
        const owner = mine.owner && users[mine.owner];
        if (owner && sameClan(u, owner)) return socket.emit('error', 'Klan arkadaşının madenine saldıramazsın!');
        const sent = takeMarch(socket, u, data); if (!sent) return;
        const res = resolveBattle(sent, attackMult(u), mine.guard || MINE_GUARD, owner ? defenseMult(owner) : 1);
        u.crew -= res.attackerLosses; sendToHospital(u, res.attackerWounded);
        if (res.attackerWins) {
            if (owner) emitTo(owner.username, 'toast', { type: 'defeat', msg: `⛏️ ${mine.name} madenini ${u.username} ele geçirdi!` });
            mine.owner = u.username; mine.empireColor = u.empireColor; mine.lastCollection = Date.now();
            socket.emit('toast', { type: 'victory', msg: `⛏️ ${mine.name} ele geçirildi! Dakikada ${mine.yield} ${mine.type === 'gold' ? 'Cash' : 'Metal'}.` });
        } else socket.emit('toast', { type: 'defeat', msg: `⛏️ ${mine.name} savunuldu! (Kayıp: ${res.attackerLosses})` });
        questProgress(u, 'attack'); markDirty('users'); markDirty('world');
        io.emit('battleAnimation', { cityId: mine.id, characterId: u.character, attackerColor: u.empireColor, result: res });
        broadcastWorld(); pushResources(u.username);
    });

    // ── Boss (Bounty) ──
    on('attackBoss', (data) => {
        const u = me(); if (!u) return;
        const boss = world.bosses[data.bossId]; if (!boss || boss.defeated) return socket.emit('error', 'Hedef şu an yok!');
        const sent = takeMarch(socket, u, data); if (!sent) return;
        const dmg = Math.floor(sent * 20 * attackMult(u) * (0.9 + Math.random() * 0.2));
        const losses = Math.floor(sent * 0.3);
        u.crew -= losses; sendToHospital(u, Math.floor(losses * 0.8));
        boss.currentHp = Math.max(0, boss.currentHp - dmg);
        boss.attackers[u.username] = (boss.attackers[u.username] || 0) + dmg;
        questProgress(u, 'boss');
        if (boss.currentHp <= 0) {
            boss.defeated = true; boss.respawnAt = Date.now() + BOSS_RESPAWN;
            const sorted = Object.entries(boss.attackers).sort((a, b) => b[1] - a[1]);
            sorted.forEach(([un], i) => {
                const share = sorted.length === 1 ? 1 : (i === 0 ? 0.6 : 0.4 / (sorted.length - 1));
                const cash = Math.floor(boss.reward * share), metal = Math.floor(boss.reward * share / 4);
                const t = users[un]; if (!t) return;
                t.cash += cash; t.metal += metal;
                emitTo(un, 'toast', { type: 'victory', msg: `🏆 ${boss.beast} yenildi! Ödül: ${cash.toLocaleString('tr-TR')} Cash + ${metal.toLocaleString('tr-TR')} Metal` });
                pushResources(un);
            });
            io.emit('toast', { type: 'info', msg: `⚔️ ${boss.beast}, ${sorted[0][0]} tarafından indirildi!` });
        } else socket.emit('toast', { type: 'info', msg: `💥 ${boss.beast}'a ${dmg.toLocaleString('tr-TR')} hasar! (Kalan: ${boss.currentHp.toLocaleString('tr-TR')})` });
        markDirty('users'); markDirty('world');
        io.emit('battleAnimation', { cityId: boss.id, characterId: u.character, attackerColor: u.empireColor, result: { attackerWins: boss.defeated, atkPower: dmg, defPower: 0 } });
        broadcastWorld(); pushResources(u.username);
    });

    // ── Oyuncu üssüne saldırı (yağma) ──
    on('attackPlayer', (data) => {
        const u = me(); if (!u) return;
        const t = users[data.target]; if (!t || !t.base) return socket.emit('error', 'Hedef üs bulunamadı.');
        if (t.username === u.username) return socket.emit('error', 'Kendine saldıramazsın!');
        if (sameClan(u, t)) return socket.emit('error', 'Klan arkadaşına saldıramazsın!');
        if (!u.base) return socket.emit('error', 'Önce kendi üssünü kur!');
        if (t.shieldUntil > Date.now()) return socket.emit('error', `${t.username} kalkan altında! (${Math.ceil((t.shieldUntil - Date.now()) / 60000)} dk)`);
        const sent = takeMarch(socket, u, data); if (!sent) return;
        // başka bir patrona saldıranın kalkanı kalkar (Mafia City kuralı)
        if (u.shieldUntil > Date.now()) { u.shieldUntil = 0; socket.emit('toast', { type: 'info', msg: '🛡️ Saldırıya geçtiğin için kalkanın kalktı.' }); }
        accrue(t);
        const wallGuard = bLevel(t, 'wall_main') * 200;
        const res = resolveBattle(sent, attackMult(u), (t.crew || 0) + wallGuard, defenseMult(t));
        u.crew -= res.attackerLosses; sendToHospital(u, res.attackerWounded);
        const defCrewLoss = Math.min(t.crew, Math.round(res.defenderLosses * (t.crew / Math.max(1, t.crew + wallGuard))));
        t.crew -= defCrewLoss; sendToHospital(t, Math.floor(defCrewLoss * 0.7));
        let loot = { cash: 0, cargo: 0, arms: 0, metal: 0 };
        if (res.attackerWins) {
            const rate = Math.min(0.6, 0.25 + invBonus(u, 'plunder'));
            const carry = res.attackerSurvivors * 50; const prot = protectedAmount(t);
            const avail = {}; let totalAvail = 0;
            Object.keys(loot).forEach(r => { avail[r] = Math.floor(Math.max(0, (t[r] || 0) - prot) * rate); totalAvail += avail[r]; });
            const scale = totalAvail > carry ? carry / totalAvail : 1;
            Object.keys(loot).forEach(r => { loot[r] = Math.floor(avail[r] * scale); t[r] -= loot[r]; u[r] += loot[r]; });
            t.shieldUntil = Date.now() + RAID_SHIELD;
            const lootTxt = costText(loot);
            socket.emit('toast', { type: 'victory', msg: `💰 ${t.username} yağmalandı! ${lootTxt}` });
            emitTo(t.username, 'toast', { type: 'defeat', msg: `🚨 ${u.username} üssünü yağmaladı! Kayıp: ${lootTxt}` });
        } else {
            socket.emit('toast', { type: 'defeat', msg: `💀 ${t.username} savunmayı tuttu! (Kayıp: ${res.attackerLosses})` });
            emitTo(t.username, 'toast', { type: 'success', msg: `🛡️ ${u.username} saldırısını püskürttün!` });
        }
        t.inbox = t.inbox || []; t.inbox.unshift({ from: 'Savaş Raporu', msg: res.attackerWins ? `${u.username} üssünü yağmaladı. Kayıp asker: ${defCrewLoss}. Kaynak: ${costText(loot)}` : `${u.username} saldırısını püskürttün. Kayıp asker: ${defCrewLoss}.`, date: Date.now(), read: false });
        if (t.inbox.length > 50) t.inbox.pop();
        questProgress(u, 'attack'); markDirty('users');
        io.emit('battleAnimation', { cityId: 'base_' + t.username, characterId: u.character, attackerColor: u.empireColor, result: res });
        pushResources(u.username); pushResources(t.username);
    });

    on('deployDefenders', (data) => {
        const u = me(); if (!u) return;
        const city = world.cities[data.cityId];
        if (!city || city.owner !== u.username) return socket.emit('error', 'Şehir senin değil!');
        const n = int(data.total ?? data.amount); if (!n) return socket.emit('error', 'Yerleştirilecek asker sayısını gir!');
        if (n > u.crew) return socket.emit('error', 'Yetersiz asker!');
        u.crew -= n; city.defenders = (city.defenders || 0) + n; markDirty('users'); markDirty('world');
        socket.emit('toast', { type: 'success', msg: `🛡️ ${city.name} şehrine ${n} asker yerleştirildi.` });
        broadcastWorld(); pushResources(u.username);
    });

    on('recallDefenders', (data) => {
        const u = me(); if (!u) return;
        const city = world.cities[data.cityId];
        if (!city || city.owner !== u.username) return socket.emit('error', 'Şehir senin değil!');
        const n = city.defenders || 0; if (!n) return socket.emit('error', 'Şehirde askerin yok.');
        u.crew += n; city.defenders = 0; markDirty('users'); markDirty('world');
        socket.emit('toast', { type: 'success', msg: `↩️ ${n} asker üsse döndü.` });
        broadcastWorld(); pushResources(u.username);
    });

    // ── Klan ──
    on('createClan', (data) => {
        const u = me(); if (!u) return; if (u.clan) return socket.emit('error', 'Zaten klandasın.');
        const name = String(data.name || '').trim().slice(0, 20);
        if (name.length < 3) return socket.emit('error', 'Klan adı en az 3 karakter.');
        const id = name.toLowerCase().replace(/\s+/g, '_');
        if (clans[id]) return socket.emit('error', 'Klan adı var.');
        clans[id] = { name, leader: u.username, flag: String(data.flag || '🐉').slice(0, 4), color: u.empireColor || 0xff6600, members: [u.username], createdAt: Date.now() };
        u.clan = id; markDirty('clans'); markDirty('users');
        Object.values(world.cities).forEach(c => { if (c.owner === u.username) c.ownerClan = id; }); markDirty('world');
        io.emit('clansData', clans); pushResources(u.username); socket.emit('resourcesUpdate', { clan: id });
        socket.emit('toast', { type: 'success', msg: `Klan kuruldu!` });
    });
    on('joinClan', (data) => {
        const u = me(); if (!u) return; if (u.clan) return socket.emit('error', 'Zaten klandasın.');
        const c = clans[data.clanId]; if (!c || c.members.length >= 30) return socket.emit('error', 'Klan dolu/yok.');
        c.members.push(u.username); u.clan = data.clanId; markDirty('clans'); markDirty('users');
        Object.values(world.cities).forEach(x => { if (x.owner === u.username) x.ownerClan = u.clan; }); markDirty('world');
        io.emit('clansData', clans); socket.emit('resourcesUpdate', { clan: u.clan });
        socket.emit('toast', { type: 'success', msg: `Klana katıldın!` });
    });
    on('leaveClan', () => {
        const u = me(); if (!u || !u.clan) return;
        const c = clans[u.clan];
        if (c) { c.members = c.members.filter(m => m !== u.username); if (c.members.length === 0) delete clans[u.clan]; else if (c.leader === u.username) c.leader = c.members[0]; markDirty('clans'); }
        u.clan = null; markDirty('users');
        Object.values(world.cities).forEach(x => { if (x.owner === u.username) x.ownerClan = null; }); markDirty('world');
        io.emit('clansData', clans); socket.emit('resourcesUpdate', { clan: null });
        socket.emit('toast', { type: 'info', msg: 'Klandan ayrıldın.' });
    });

    // ── Sıralama / Profil / Görevler ──
    on('getLeaderboard', () => {
        const arr = Object.values(users).filter(p => p.verified).map(p => ({
            username: p.username, power: calculatePlayerPower(p), clan: p.clan, empireColor: p.empireColor, character: p.character,
            base: p.base ? { x: p.base.x, z: p.base.z, level: p.base.level } : null, shielded: (p.shieldUntil || 0) > Date.now(),
            cityCount: Object.values(world.cities).filter(x => x.owner === p.username).length,
            mineCount: Object.values(world.mines).filter(x => x.owner === p.username).length
        }));
        arr.sort((a, b) => b.power - a.power); socket.emit('leaderboardData', arr.slice(0, 100));
    });
    on('getProfile', () => {
        const u = me(); if (!u) return; accrue(u); checkQuestReset(u); markDirty('users');
        socket.emit('profileData', publicPlayer(u));
    });
    on('claimQuest', (data) => {
        const u = me(); if (!u) return; checkQuestReset(u);
        const q = u.quests[data.questId]; if (!q || q.claimed || q.current < q.target) return socket.emit('error', 'Görev tamamlanmamış!');
        q.claimed = true; u.cash += q.reward; markDirty('users');
        pushResources(u.username);
        socket.emit('toast', { type: 'success', msg: `Ödül alındı: ${q.reward.toLocaleString('tr-TR')} Cash!` });
        socket.emit('profileData', publicPlayer(u));
    });

    // ── Mesajlar ──
    on('sendMessage', (data) => {
        const u = me(); if (!u || !data.to || !data.msg) return;
        const t = Object.values(users).find(x => x.username.toLowerCase() === String(data.to).toLowerCase());
        if (!t) return socket.emit('error', 'Oyuncu yok.');
        const msg = String(data.msg).slice(0, 500);
        t.inbox = t.inbox || []; t.inbox.unshift({ from: u.username, msg, date: Date.now(), read: false });
        if (t.inbox.length > 50) t.inbox.pop(); markDirty('users');
        emitTo(t.username, 'newMessage', { from: u.username, msg, date: Date.now() });
        socket.emit('toast', { type: 'success', msg: 'Mesaj gönderildi.' });
    });
    on('getInbox', () => { const u = me(); if (!u) return; (u.inbox || []).forEach(m => m.read = true); markDirty('users'); socket.emit('inboxData', u.inbox || []); });
    on('deleteMessage', (data) => { const u = me(); if (!u) return; u.inbox = (u.inbox || []).filter(m => m.date !== data.date); markDirty('users'); socket.emit('inboxData', u.inbox); });

    // ── Üs ve binalar ──
    on('buildBase', (data) => {
        const u = me(); if (!u) return; if (u.base) return socket.emit('error', 'Zaten üssün var!');
        const x = Math.round(Number(data.x)), z = Math.round(Number(data.z));
        if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 5000 || Math.abs(z) > 5000) return socket.emit('error', 'Geçersiz konum.');
        const tooClose = Object.values(users).some(o => o.base && Math.hypot(o.base.x - x, o.base.z - z) < 320);
        if (tooClose) return socket.emit('error', 'Bu konum başka bir patronun üssüne çok yakın!');
        accrue(u);
        if (u.cash < BASE_BUILD_COST) return socket.emit('error', `${BASE_BUILD_COST.toLocaleString('tr-TR')} Cash gerekli!`);
        u.cash -= BASE_BUILD_COST; u.base = { x, z, level: 1, hp: 5000 }; u.buildings = makeBuildings(u.base); u.lastTick = Date.now();
        markDirty('users');
        socket.emit('resourcesUpdate', { ...resourceSnapshot(u), buildings: u.buildings });
        socket.emit('baseBuilt', u.base);
        socket.emit('toast', { type: 'victory', msg: '🏆 Mansion kuruldu! Binaların üretime başladı.' });
    });

    function upgradeMansion() {
        const u = me(); if (!u) return; if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        accrue(u);
        const lvl = u.base.level || 1;
        if (lvl >= MAX_LEVEL) return socket.emit('error', 'Mansion maksimum seviyede!');
        const wall = bLevel(u, 'wall_main');
        if (wall < lvl) return socket.emit('error', `Önce Duvarı Lv ${lvl} yapmalısın! (Şu an Lv ${wall})`);
        const cost = upgradeCost('mansion', lvl);
        if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz kaynak! Gerekli: ${costText(cost)}`);
        pay(u, cost); u.base.level = lvl + 1; u.base.hp = (u.base.hp || 5000) + 2000;
        questProgress(u, 'upgrade');
        // kahraman: Mansion 5'te ilk kahraman, sonra her 5 seviyede +1 yıldız
        if (u.base.level >= HERO_UNLOCK_LEVEL) {
            const stars = Math.floor(u.base.level / HERO_UNLOCK_LEVEL);
            const c = CHARACTERS.find(x => x.id === u.character) || CHARACTERS[0];
            let h = u.heroes.find(x => x.id === c.id);
            if (!h) { h = { id: c.id, name: c.name, icon: c.icon || '🦸', stars }; u.heroes.push(h); socket.emit('toast', { type: 'victory', msg: `🦸 Yeni kahraman: ${c.name}!` }); }
            else if (h.stars < stars) { h.stars = stars; socket.emit('toast', { type: 'success', msg: `⭐ ${h.name} ${stars} yıldız oldu!` }); }
        }
        markDirty('users');
        socket.emit('buildingUpgraded', { id: 'mansion', kind: 'mansion', level: u.base.level });
        pushResources(u.username);
        socket.emit('toast', { type: 'success', msg: `🏰 Mansion Lv ${u.base.level}!` });
    }
    on('upgradeBase', upgradeMansion);

    on('upgradeBuilding', (data) => {
        if (data.kind === 'mansion' || data.id === 'mansion') return upgradeMansion();
        const u = me(); if (!u) return; if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        accrue(u);
        // id'si bilinmeyen eski istekler için aynı türdeki en düşük seviyeli binayı seç
        let b = u.buildings.find(x => x.id === data.id);
        if (!b && data.kind) b = u.buildings.filter(x => x.kind === data.kind).sort((a, c) => a.level - c.level)[0];
        if (!b) return socket.emit('error', 'Bina bulunamadı.');
        const mansionLvl = u.base.level || 1;
        if (b.level >= MAX_LEVEL) return socket.emit('error', 'Bina maksimum seviyede!');
        if (b.level >= mansionLvl) return socket.emit('error', `Önce Mansion'ı Lv ${b.level + 1} yapmalısın!`);
        const cost = upgradeCost(b.kind, b.level);
        if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz kaynak! Gerekli: ${costText(cost)}`);
        pay(u, cost); b.level += 1; questProgress(u, 'upgrade'); markDirty('users');
        socket.emit('buildingUpgraded', b);
        pushResources(u.username);
    });

    on('invest', (data) => {
        const u = me(); if (!u) return; if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        const cat = INVESTMENTS[data.category]; const it = cat && cat[data.item];
        if (!it) return socket.emit('error', 'Araştırma bulunamadı.');
        accrue(u);
        const key = data.category + ':' + data.item; const lvl = u.investments[key] || 0;
        const maxLvl = bLevel(u, 'invest_main') * 2;
        if (lvl >= maxLvl) return socket.emit('error', `Bu araştırma için Yatırım Merkezi'ni yükselt! (Maks Lv ${maxLvl})`);
        const cost = { cash: investCost(it.cost, lvl) };
        if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz Cash! Gerekli: ${costText(cost)}`);
        pay(u, cost); u.investments[key] = lvl + 1; markDirty('users');
        pushResources(u.username);
        socket.emit('toast', { type: 'success', msg: `💼 ${data.item} → Lv ${lvl + 1}` });
    });

    socket.on('disconnect', () => {
        const un = sessions[socket.id];
        if (un && users[un]) { accrue(users[un]); markDirty('users'); }
        delete sessions[socket.id];
    });
});

app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
server.listen(PORT, () => console.log(`[✓] AtlasWarfare Sunucu Port ${PORT} üzerinde aktif.`));
