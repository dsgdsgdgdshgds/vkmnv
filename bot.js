/* ============================================================
 * AtlasWarfare sunucusu (bot.js) — Mafia City tarzı mafya strateji oyunu
 *  Sistemler: hesap/oturum, villa + 15 bina (süreli inşaat; ücretsiz / altın / eşya ile hızlandırma),
 *   4 birlik türü × 8 kademe (T6–T8 elit: kamp Sv. 24/27/30 + bir kerelik pırlanta kilidi; karşı-üstünlük), eğitim kuyruğu, hastane, seferler (haritada yürüyüş, radar uyarısı),
 *   şehir / maden / bounty / oyuncu savaşları, SOKAK ÇETELERİ (Sv.1–15), KLAN BASKINI (birleşik ordu),
 *   klan + yardım + sohbet, VIP (puan + aktivasyon), çanta / mağaza (altın yalnız oyun içinde kazanılır, gerçek para yok),
 *   günlük giriş / çark / çevrimiçi ödül, hikâye (10 bölüm), lider seviyesi + yetenekler, sırdaşlar,
 *   EKİPMAN (Dökümhane atölyesi: kalite olasılığı açık, şans sayacı), etkinlik merkezi + sıralama,
 *   GARAJ (araba + parça), KAYNAK NOKTALARI (toplama), KAÇAKÇI, KAHRAMAN GELİŞİMİ (madalya → yıldız, birlik türü yeteneği),
 *   BELEDİYE SARAYI (saray + 4 kale, başkanlık savaşı, başkan unvanları, kara parayla şehir becerileri, paketler, hediye sandığı),
 *   SIRDAŞ GELİŞİMİ (Sv. 2/4/6/8 becerileri, kıyafet dolabı, elmas oyunu serisi, günlük gül),
 *   KLAN TEKNOLOJİSİ (bağış → klan bonusu, klan puanı dükkânı), HAPİSHANE KULESİ (haftalık kat kat PvE, enerji, dükkân, sıralama),
 *   VİLLA GÖRÜNÜMLERİ (parça → kalıcı görünüm + bonus, koleksiyon seti, haritada görünüm), ZAR TURU (Mafyapoly: 24 kare, tur ödülleri),
 *   KLAN FENERLERİ (3 deniz feneri: garnizon onarır / zaman aşındırır, Sv. 1–10, sahip klanın bütün üyelerine bonus),
 *   KLAN BÖLGESİ (karargâh + 3 kule: askerle inşaat, bölge etkisi, kuşatma / yıkım, bölgeye ışınlanma), BAŞARIMLAR (23 başarım × 5 kademe, 8 rütbe),
 *   KUMARHANE SAVAŞI (hafta sonu: Onur Puanı, Grand Kumarhane sitesi, fiş → rulet / kollu makine / fiş dükkânı, kişi + klan sıralama ödülü).
 *  Ortam değişkenleri: PORT, DATA_DIR, ADMIN_PASSWORD (varsayılan admin1234), SESSION_SECRET, RESEND_API_KEY
 *   yalnız test için: NEWBIE_SHIELD_MS, RALLY_MIN_MS, HALL_HOLD_MS, HALL_TERM_MS, HALL_DIRTY0, TER_BUILD_K, TER_CALM_MS, CAS_EPOCH, CAS_PERIOD_MS, CAS_ACTIVE_MS
 * ============================================================ */
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
const NEWBIE_SHIELD = process.env.NEWBIE_SHIELD_MS != null ? +process.env.NEWBIE_SHIELD_MS : 24 * 60 * 60 * 1000;       // yeni oyuncu koruması (ilk saldırıda kalkar; test için ortam değişkeniyle değiştirilebilir)
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
// MC "Güzellikle Karşılaşma": kendi karakterin Sv.5'te, diğer kahramanlar şu villa seviyelerinde sırayla katılır
const HERO_JOIN = [7, 11, 16, 19, 22, 25, 28];
function heroJoinLevels(u) { const own = u.character || CHARACTERS[0].id, r = { [own]: HERO_UNLOCK_LEVEL }; CHARACTERS.filter(c => c.id !== own).forEach((c, i) => r[c.id] = HERO_JOIN[i] || 30); return r; }
function syncHeroes(u, notify) { // seviyesi gelen kahraman katılır; katıldıktan sonra her 5 seviyede +1 yıldız (en çok 6)
    if (!u.base) return; const J = heroJoinLevels(u), lv = u.base.level || 1; u.heroes = u.heroes || [];
    CHARACTERS.forEach(c => { const j = J[c.id]; if (!j || lv < j) return; const stars = Math.min(6, 1 + Math.floor((lv - j) / 5)); const h = u.heroes.find(x => x.id === c.id);
        if (!h) { u.heroes.push({ id: c.id, name: c.name, icon: c.icon || '🦸', stars }); if (notify) emitTo(u.username, 'heroJoined', { id: c.id, name: c.name }); }
        else if ((h.stars || 1) < stars) { h.stars = stars; /* Villa tabanı; madalya yıldızı bunun üstünde kalır */ if (notify) emitTo(u.username, 'toast', { type: 'success', msg: `${h.name} ${stars} yıldız oldu!` }); } });
}

// ═══════════════════════════════════════════
// VIP (Mafia City tarzı): puanla seviye atlanır; ayrıcalıklar yalnız VIP AKTİFKEN geçerlidir
// ═══════════════════════════════════════════
const VIP_POINTS = [0, 0, 500, 1500, 3500, 7000, 12000, 20000, 32000, 50000, 80000];   // VIP n için gereken toplam puan (index = seviye)
const VIP_MAX = 10;
// her seviyenin ayrıcalıkları (oran ya da sayı): üretim, eğitim/yükseltme indirimi, sefer kapasitesi, hastane, saldırı/savunma
const VIP_PERKS = {
    prod:   [0, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.18, 0.21, 0.25, 0.30],
    train:  [0, 0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.20],
    up:     [0, 0, 0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12],
    ops:    [0, 0, 50, 100, 150, 200, 300, 400, 500, 650, 800],
    hosp:   [0, 0, 200, 400, 600, 1000, 1500, 2000, 2500, 3000, 4000],
    atk:    [0, 0, 0, 0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08],
    def:    [0, 0, 0, 0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08],
    daily:  [0, 10, 20, 30, 40, 50, 60, 80, 100, 120, 150],   // aktifken her gün bedava VIP sandığından altın
    free:   [0, 10, 11, 12, 14, 16, 18, 20, 23, 26, 30],      // "Hızlı İnşaat Süresi": kalan süre bunun altındaysa inşaat ücretsiz biter (dk)
};
// ═══ İNŞAAT SÜRESİ (MC): yükseltme zaman alır, tek inşaat ekibi; kalan süre ücretsiz sınırın altındaysa "Ücretsiz" ile biter ═══
const FREE_BASE = 5 * 60e3;   // VIP pasifken 5 dk
const BNAME = { mansion: 'Villa', wall: 'Duvar', camp: 'Eğitim Kampı', hospital: 'Hastane', diner: 'Lokanta', vault: 'Depo', invest: 'Yatırım Merkezi', counterfeiter: 'Darphane', cargo: 'Malzeme Transfer İstasyonu', ammu: 'Cephanelik', smelter: 'Dökümhane' };
function buildTime(kind, level) { return Math.round(6 * Math.pow(level, 2.35) * (kind === 'mansion' ? 1 : kind === 'wall' ? 0.9 : 0.75)) * 1000; } // level → level+1 (ms)
function instantGold(ms) { return Math.max(1, Math.ceil(ms / 60000)); } // 1 altın / dakika
const VIP_TRIAL = 24 * 60 * 60 * 1000;   // yeni oyuncuya 1 günlük VIP denemesi

// ═══════════════════════════════════════════
// EŞYALAR (çanta) — hepsi gerçek etkili; altınla (oyun içi kazanılan) mağazadan da alınabilir
// ═══════════════════════════════════════════
const ITEMS = {
    cash_1k:   { cat: 'res', name: 'Nakit Destesi (1K)', desc: '1.000 Cash verir.', give: { cash: 1000 }, gold: 10 },
    cash_10k:  { cat: 'res', name: 'Nakit Çantası (10K)', desc: '10.000 Cash verir.', give: { cash: 10000 }, gold: 80 },
    cash_50k:  { cat: 'res', name: 'Nakit Kasası (50K)', desc: '50.000 Cash verir.', give: { cash: 50000 }, gold: 350 },
    cargo_1k:  { cat: 'res', name: 'Kargo Sandığı (1K)', desc: '1.000 Cargo verir.', give: { cargo: 1000 }, gold: 10 },
    cargo_10k: { cat: 'res', name: 'Kargo Konteyneri (10K)', desc: '10.000 Cargo verir.', give: { cargo: 10000 }, gold: 80 },
    arms_1k:   { cat: 'res', name: 'Cephane Kutusu (1K)', desc: '1.000 Arms verir.', give: { arms: 1000 }, gold: 15 },
    arms_10k:  { cat: 'res', name: 'Cephane Sandığı (10K)', desc: '10.000 Arms verir.', give: { arms: 10000 }, gold: 120 },
    metal_1k:  { cat: 'res', name: 'Metal Külçe (1K)', desc: '1.000 Metal verir.', give: { metal: 1000 }, gold: 15 },
    metal_10k: { cat: 'res', name: 'Metal Yığını (10K)', desc: '10.000 Metal verir.', give: { metal: 10000 }, gold: 120 },
    res_box:   { cat: 'res', name: 'Karışık Kaynak Sandığı', desc: 'Her kaynaktan 5.000 verir.', give: { cash: 5000, cargo: 5000, arms: 5000, metal: 5000 }, gold: 150 },
    vip_10:    { cat: 'boost', name: '10 VIP Puanı', desc: 'VIP seviyeni 10 VIP puanıyla yükseltir.', vip: 10, gold: 10 },
    vip_100:   { cat: 'boost', name: '100 VIP Puanı', desc: 'VIP seviyeni 100 VIP puanıyla yükseltir.', vip: 100, gold: 100 },
    vip_300:   { cat: 'boost', name: '300 VIP Puanı', desc: 'VIP seviyeni 300 VIP puanıyla yükseltir.', vip: 300, gold: 300 },
    vip_1000:  { cat: 'boost', name: '1.000 VIP Puanı', desc: 'VIP seviyeni 1.000 VIP puanıyla yükseltir.', vip: 1000, gold: 1000 },
    vip_act_1d:{ cat: 'boost', name: 'VIP Aktivasyonu (24 saat)', desc: 'VIP ayrıcalıklarını 24 saat açar (süre üst üste eklenir).', vipAct: 24 * 3600e3, gold: 100 },
    vip_act_7d:{ cat: 'boost', name: 'VIP Aktivasyonu (7 gün)', desc: 'VIP ayrıcalıklarını 7 gün açar.', vipAct: 7 * 24 * 3600e3, gold: 500 },
    prod_8h:   { cat: 'boost', name: 'Üretim Artışı +%25 (8 saat)', desc: 'Tüm kaynak üretimini 8 saat %25 artırır.', buff: ['prod', 8 * 3600e3], gold: 120 },
    atk_2h:    { cat: 'war', name: 'Saldırı Artışı +%10 (2 saat)', desc: 'Saldırı gücünü 2 saat %10 artırır.', buff: ['atk', 2 * 3600e3], gold: 150 },
    shield_8h: { cat: 'war', name: 'Kalkan (8 saat)', desc: 'Üssün 8 saat saldırılara kapanır. Başka patrona saldırırsan kalkar.', shield: 8 * 3600e3, gold: 200 },
    shield_24h:{ cat: 'war', name: 'Kalkan (24 saat)', desc: 'Üssün 24 saat saldırılara kapanır.', shield: 24 * 3600e3, gold: 500 },
    troops_100:{ cat: 'war', name: 'Asker Kartı (100)', desc: 'Ekibine anında 100 asker katar.', crew: 100, gold: 40 },
    troops_500:{ cat: 'war', name: 'Asker Kartı (500)', desc: 'Ekibine anında 500 asker katar.', crew: 500, gold: 180 },
    heal_500:  { cat: 'war', name: 'Sargı Paketi', desc: 'Hastanedeki 500 yaralıyı ücretsiz iyileştirir.', heal: 500, gold: 60 },
    speed_5m:  { cat: 'speed', name: 'Hızlandırma (5 dk)', desc: 'Devam eden inşaatı 5 dakika kısaltır.', speed: 5 * 60e3, gold: 5 },
    speed_1h:  { cat: 'speed', name: 'Hızlandırma (1 saat)', desc: 'Devam eden inşaatı 1 saat kısaltır.', speed: 3600e3, gold: 50 },
    speed_8h:  { cat: 'speed', name: 'Hızlandırma (8 saat)', desc: 'Devam eden inşaatı 8 saat kısaltır.', speed: 8 * 3600e3, gold: 360 },
    gift_rose: { cat: 'other', name: 'Kırmızı Gül Buketi', desc: 'Bir sırdaşa hediye: yakınlık +40.', fav: 40, gold: 20 },
    gift_perfume: { cat: 'other', name: 'Fransız Parfümü', desc: 'Bir sırdaşa hediye: yakınlık +120.', fav: 120, gold: 60 },
    gift_jewel: { cat: 'other', name: 'Elmas Kolye', desc: 'Bir sırdaşa hediye: yakınlık +400.', fav: 400, gold: 180 },
    mat_box:   { cat: 'res', name: 'Malzeme Sandığı', desc: '15 Deri, 15 Çelik ve 10 İpek verir (ekipman üretimi).', mats: { leather: 15, steel: 15, silk: 10 }, gold: 80 },
    gem_1:     { cat: 'res', name: 'Pırlanta', desc: '1 Pırlanta verir (üst kademe ekipman ve geliştirme).', mats: { gem: 1 }, gold: 60 },
    hero_medal:{ cat: 'other', name: 'Kahraman Madalyası', desc: 'Kahramanlar sayfasında yıldız yükseltmek için kullanılır.', medal: 1, gold: 12 },
    sf_gold:   { cat: 'other', name: 'Altın Malikâne Parçası', desc: 'Villa görünümü parçası. 40 parça → Altın Malikâne (Villa › Görünüm).', skinFrag: 'gold' },
    sf_neon:   { cat: 'other', name: 'Neon Kulüp Parçası', desc: 'Villa görünümü parçası. 40 parça → Neon Kulüp (Villa › Görünüm).', skinFrag: 'neon' },
    sf_castle: { cat: 'other', name: 'Kartal Kalesi Parçası', desc: 'Villa görünümü parçası. 50 parça → Kartal Kalesi (Villa › Görünüm).', skinFrag: 'castle' },
    sf_winter: { cat: 'other', name: 'Kış Sarayı Parçası', desc: 'Villa görünümü parçası. 50 parça → Kış Sarayı (Villa › Görünüm).', skinFrag: 'winter' },
    sf_dragon: { cat: 'other', name: 'Ejder Sarayı Parçası', desc: 'Villa görünümü parçası. 80 parça → Ejder Sarayı (Villa › Görünüm).', skinFrag: 'dragon' },
    skin_box:  { cat: 'other', name: 'Görünüm Parça Sandığı', desc: 'Rastgele bir villa görünümünden 5 parça verir (Ejder Sarayı en nadiri).', skinBox: 5, gold: 80 },
    dice:      { cat: 'other', name: 'Sihirli Zar', desc: 'Zar Turu\'nda bir atış hakkı (Etkinlik › Zar Turu).', diceItem: 1, gold: 40 },
    tele_rand: { cat: 'other', name: 'Rastgele Işınlanma', desc: 'Villanı haritada rastgele uygun bir yere taşır.', tele: 'rand', gold: 100 },
    tele_adv:  { cat: 'other', name: 'Gelişmiş Işınlanma', desc: 'Villanı haritada seçtiğin yere taşır.', tele: 'pick', gold: 400 },
};
// Şans çarkı (MC "Tabanca Topu"): günde 1 bedava çevirme, sonrakiler 50 altın; ağırlıklı ödül
const WHEEL = [
    { items: { cash_1k: 2 }, w: 18 }, { items: { cargo_1k: 2 }, w: 18 }, { items: { arms_1k: 1 }, w: 14 }, { items: { metal_1k: 1 }, w: 14 },
    { items: { vip_10: 3 }, w: 12 }, { items: { troops_100: 1 }, w: 10 }, { items: { shield_8h: 1 }, w: 5 }, { gold: 50, w: 6 },
    { items: { res_box: 1 }, w: 2 }, { items: { gift_rose: 2 }, w: 5 }, { items: { mat_box: 1 }, w: 6 }, { items: { hero_medal: 5 }, w: 6 },
];
const WHEEL_COST = 50;
// Gelişim görevleri (MC "Gelişim Görevleri"): villa seviyesi kilometre taşları — bir kez alınır
const MAIN_QUESTS = [];
for (let l = 2; l <= 30; l++) MAIN_QUESTS.push({ id: 'v' + l, lvl: l, gold: l * 15, items: l % 5 === 0 ? { res_box: 1, vip_100: 1, speed_1h: 1, mat_box: 1, gem_1: 1 } : l % 2 === 0 ? { vip_10: 3, cash_1k: 2, speed_5m: 2 } : { troops_100: 1, cargo_1k: 2, speed_5m: 1 } });
const CHAT_MAX = 60;
// Çevrimiçi ödülleri (MC "Çevrimiçi Ödülleri"): oyunda kalınan süreyle sırayla açılan sandıklar; süre yalnız çevrimiçiyken akar, her gün sıfırlanır
const ONLINE_REWARDS = [
    { min: 3, items: { cash_1k: 1 } },
    { min: 10, items: { cargo_1k: 1, vip_10: 1, speed_5m: 2 } },
    { min: 20, items: { arms_1k: 1, metal_1k: 1, gift_rose: 1 } },
    { min: 40, items: { vip_10: 3, mat_box: 1 }, gold: 10 },
    { min: 60, items: { res_box: 1 }, gold: 20 },
];

const DAILY_REWARDS = [   // 7 günlük art arda giriş (MC "Giriş Başarılı")
    { items: { vip_10: 2, cash_1k: 2 } },
    { items: { vip_10: 3, cargo_1k: 2, speed_5m: 3 } },
    { items: { vip_100: 1, shield_8h: 1 } },
    { items: { vip_10: 5, troops_100: 2, speed_1h: 1, mat_box: 1 } },
    { items: { vip_100: 1, res_box: 1 } },
    { items: { vip_100: 2, vip_act_1d: 1, hero_medal: 10 } },
    { items: { vip_300: 1, tele_rand: 1 }, gold: 200 },
];

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
        crew: 500, troops: { k1: 300, t1: 100, m1: 100 }, hospital: { infantry: 0, mix: {} }, train: null, marches: [],
        stats: { damage: 0, defense: 0 }, clan: null,
        base: null, buildings: [], investments: {}, heroes: [],
        shieldUntil: Date.now() + NEWBIE_SHIELD,
        quests: freshQuests(), lastQuestReset: Date.now(), lastTick: Date.now(),
        inbox: [], verified: false, createdAt: Date.now(),
        vipPoints: 0, vipActiveUntil: Date.now() + VIP_TRIAL, bag: { vip_10: 5, cash_1k: 3, shield_8h: 1, tele_rand: 1, speed_5m: 5, speed_1h: 1, mat_box: 1 }, gold: 300, buffs: {}, login: null, spinDay: null, mainDone: {}, gear: { inv: [], eq: {}, mat: {}, seq: 1, pity: 0, made: 0 }
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
    if (!h.mix) u.hospital = { infantry: 0, mix: (h.infantry || 0) + (h.archer || 0) + (h.cavalry || 0) > 0 ? { k1: (h.infantry || 0) + (h.archer || 0) + (h.cavalry || 0) } : {} };
    if (!u.troops || typeof u.troops !== 'object') u.troops = u.crew > 0 ? { k1: u.crew } : {};
    Object.keys(u.troops).forEach(k => { if (!isTroopKey(k) || !(u.troops[k] > 0)) delete u.troops[k]; });
    if (!Array.isArray(u.marches)) u.marches = [];
    syncTroops(u);
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
    if (u.vipPoints === undefined) { const old = Math.min(VIP_MAX, 1 + Math.floor(((u.base && u.base.level) || 1) / 3)); u.vipPoints = VIP_POINTS[old] || 0; u.vipActiveUntil = Date.now() + VIP_TRIAL; }
    if (!u.bag || typeof u.bag !== 'object' || Array.isArray(u.bag)) u.bag = { vip_10: 5, cash_1k: 3, shield_8h: 1, tele_rand: 1, speed_5m: 5, speed_1h: 1 }; // eski oyuncuya bir kez hoş geldin paketi
    Object.keys(u.bag).forEach(k => { if (!ITEMS[k] || !(u.bag[k] > 0)) delete u.bag[k]; });
    if (typeof u.gold !== 'number') u.gold = 300;
    if (!u.gear) { gear(u); u.bag.mat_box = (u.bag.mat_box || 0) + 1; } // ekipman sistemi: eski oyuncuya bir malzeme sandığı
    if (!u.buffs || typeof u.buffs !== 'object') u.buffs = {};
    if (!u.mainDone || typeof u.mainDone !== 'object') u.mainDone = {};
    applyCharacterStats(u);
    delete u.inventory; delete u.items; delete u.equip; delete u.hp; delete u.maxHp; delete u.x; delete u.y; delete u.z;
    return u;
}
function applyCharacterStats(u) {
    const c = CHARACTERS.find(x => x.id === u.character);
    u.stats = { damage: c ? c.damage / 500 : 0, defense: c ? c.defense / 500 : 0 };
}
// (eski kayıt göçü dosyanın sonunda, tüm tanımlar yüklendikten sonra çalışır)

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

// ═══ KAHRAMAN YETENEKLERİ (MC "Vigilante" becerileri): tür = k/t/m/a (o birliğin gücü), ya da genel etki anahtarı (lb ile) ═══
const HERO_SKILL = {
    kyuubi:     { name: 'Molotof Yağmuru', t: 'a', per: 0.03, desc: 'Zırhlı Araç gücü' },
    alchemist:  { name: 'Çelik Kasa',      key: 'vault', per: 0.04, key2: 'prod', per2: 0.015, desc: 'Korunan kaynak ve üretim' },
    mistsword:  { name: 'Sessiz Bıçak',    t: 'm', per: 0.03, desc: 'Motorcu gücü' },
    raikage:    { name: 'Tek Kurşun',      t: 't', per: 0.03, desc: 'Tetikçi gücü' },
    soulreaper: { name: 'Aile Onuru',      key: 'def', per: 0.012, key2: 'atk', per2: 0.008, desc: 'Bütün birliklerin savunması ve saldırısı' },
    titan:      { name: 'Çapraz Kesik',    t: 'k', per: 0.03, desc: 'Kabadayı gücü' },
    rubber:     { name: 'Demir Yumruk',    t: 'k', per: 0.02, key: 'hosp', perk: 300, desc: 'Kabadayı gücü ve hastane kapasitesi' },
    icequeen:   { name: 'Soğuk Hesap',     t: 't', per: 0.02, key: 'plunder', perk: 0.01, desc: 'Tetikçi gücü ve yağma oranı' },
};
const STAR_COST = [0, 0, 30, 80, 160, 280, 420]; // hedef yıldıza çıkmak için madalya
function heroTM(u) { const tm = {}; (u.heroes || []).forEach(h => { const S = HERO_SKILL[h.id]; if (S && S.t) tm[S.t] = (tm[S.t] || 0) + S.per * (h.stars || 1); }); return confTM(u, tm); } // kahraman + sırdaş tür becerileri
function heroB(u, k) { let v = 0; (u.heroes || []).forEach(h => { const S = HERO_SKILL[h.id], st = h.stars || 1; if (!S) return; if (S.key === k) v += (S.perk != null ? S.perk : S.per) * st; if (S.key2 === k) v += S.per2 * st; }); return v; }
function heroBonus(u) { return (u.heroes || []).reduce((a, h) => a + (h.stars || 1) * 0.02, 0); }
function cityBonus(u, key) { return Object.values(world.cities).filter(c => c.owner === u.username).reduce((a, c) => a + (c.bonus?.[key] || 0), 0); }
function attackMult(u) { return 1 + (u.stats?.damage || 0) + invBonus(u, 'attack') + heroBonus(u) + cityBonus(u, 'damage') + vipPerk(u, 'atk') + (buffOn(u, 'atk') ? 0.10 : 0) + lb(u, 'atk') + confBuff(u, 'atk'); }
function defenseMult(u) { return 1 + (u.stats?.defense || 0) + invBonus(u, 'defense') + invBonus(u, 'wall') + invBonus(u, 'trap') + heroBonus(u) + cityBonus(u, 'defense') + vipPerk(u, 'def') + lb(u, 'def') + confBuff(u, 'def'); }
function crimeOps(u) { return 300 + bLevels(u, 'diner') * 300 + invBonus(u, 'crimeOps') + vipPerk(u, 'ops') + lb(u, 'ops'); }       // tek seferde gönderilebilecek asker
function trainCap(u) { return u.base ? 500 + bLevels(u, 'camp') * 500 : 500; }                      // tek seferde eğitilebilecek asker
function hospitalCap(u) { return 500 + bLevels(u, 'hospital') * 2000 + vipPerk(u, 'hosp') + lb(u, 'hosp'); }
function protectedAmount(u) { return Math.floor((5000 + bLevels(u, 'vault') * 10000) * (1 + invBonus(u, 'storage') + lb(u, 'vault'))); } // kasa korur
function vipLevel(u) { const p = u.vipPoints || 0; let l = 1; for (let i = 2; i <= VIP_MAX; i++) if (p >= VIP_POINTS[i]) l = i; return l; }
function vipActive(u) { return (u.vipActiveUntil || 0) > Date.now(); }
function vipPerk(u, k) { return vipActive(u) ? (VIP_PERKS[k][vipLevel(u)] || 0) : 0; }
function buffOn(u, k) { return ((u.buffs || {})[k] || 0) > Date.now(); }
function vipInfo(u) { const l = vipLevel(u); return { vip: l, vipPoints: u.vipPoints || 0, vipNext: l < VIP_MAX ? VIP_POINTS[l + 1] : null, vipActiveUntil: u.vipActiveUntil || 0, vipEff: { prod: vipPerk(u, 'prod'), train: vipPerk(u, 'train'), up: vipPerk(u, 'up'), ops: vipPerk(u, 'ops'), hosp: vipPerk(u, 'hosp'), atk: vipPerk(u, 'atk'), def: vipPerk(u, 'def'), free: freeMs(u) } }; }
function freeMs(u) { return Math.max(FREE_BASE, vipPerk(u, 'free') * 60e3); }
// inşaatı bitir (seviyeyi uygula); notify: çevrimiçi istemcilere haber ver
function finishBuild(u, notify) {
    const b = u.build; if (!b) return null; u.build = null;
    if (b.id === 'mansion') { if (!u.base) return null; u.base.level = b.to; u.base.hp = (u.base.hp || 5000) + 2000; u.gold = (u.gold || 0) + b.to * 10; syncHeroes(u, notify); }
    else { const x = (u.buildings || []).find(q => q.id === b.id); if (!x) return null; x.level = b.to; }
    questProgress(u, 'upgrade'); addXP(u, 15 * b.to, notify); evPoints(u, 'build', b.to * 60); markDirty('users');
    if (notify) {
        emitTo(u.username, 'buildingUpgraded', b.id === 'mansion' ? { id: 'mansion', kind: 'mansion', level: u.base.level } : (u.buildings || []).find(q => q.id === b.id));
        emitTo(u.username, 'toast', { type: 'success', msg: `${BNAME[b.kind] || 'Bina'} Sv. ${b.to} inşaatı tamamlandı.` });
        pushResources(u.username);
    }
    return b;
}
setInterval(() => { const t = Date.now(); new Set(Object.values(sessions)).forEach(un => { const u = users[un]; if (u && u.build && t >= u.build.end) finishBuild(u, true); }); }, 1000);
function addVip(u, n) { const before = vipLevel(u); u.vipPoints = (u.vipPoints || 0) + n; const after = vipLevel(u); return after > before ? after : 0; }
function upCostFor(u, kind, level) { const c = upgradeCost(kind, level), d = vipPerk(u, 'up'); if (d) Object.keys(c).forEach(r => c[r] = Math.floor(c[r] * (1 - d))); return c; }
function giveItems(u, items) { u.bag = u.bag || {}; Object.entries(items || {}).forEach(([k, n]) => { if (ITEMS[k] && n > 0) u.bag[k] = (u.bag[k] || 0) + n; }); }

function productionPerMin(u) {
    const p = { cash: 0, cargo: 0, arms: 0, metal: 0 };
    if (!u.base) return p;
    (u.buildings || []).forEach(b => { const prod = PRODUCTION[b.kind]; if (prod) Object.entries(prod).forEach(([r, v]) => p[r] += v * (b.level || 1)); });
    p.cash *= 1 + invBonus(u, 'cashProd'); p.cargo *= 1 + invBonus(u, 'cargoProd');
    p.arms *= 1 + invBonus(u, 'armsProd'); p.metal *= 1 + invBonus(u, 'metalProd');
    const extra = 1 + vipPerk(u, 'prod') + (buffOn(u, 'prod') ? 0.25 : 0) + lb(u, 'prod') + confBuff(u, 'prod'); // VIP + eşya + lider yeteneği + sırdaş
    if (extra !== 1) Object.keys(p).forEach(r => p[r] *= extra);
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
    syncTroops(u); let power = troopPower(u.troops) + (u.hospital?.infantry || 0) + (u.marches || []).reduce((a, m) => a + troopPower(m.troops), 0);
    power += (u.buildings || []).reduce((a, b) => a + (b.level || 1) * 150, 0);
    if (u.base) power += (u.base.level || 1) * 1000;
    Object.values(world.cities).forEach(c => { if (c.owner === u.username) power += c.type === 'capital' ? 5000 : 2000; });
    Object.values(world.mines).forEach(m => { if (m.owner === u.username) power += 1000; });
    power += Object.values(u.investments || {}).reduce((a, b) => a + b * 200, 0);
    power += (u.heroes || []).reduce((a, h) => a + (h.stars || 1) * 500, 0);
    power += gearPower(u);
    if (u.garage && u.garage.active && carDone(u, u.garage.active)) power += 1500 + CARS[u.garage.active].villa * 400;
    return Math.floor(power);
}

function checkQuestReset(u) {
    if (!u.lastQuestReset || (Date.now() - u.lastQuestReset) > 24 * 60 * 60 * 1000) { u.quests = freshQuests(); u.lastQuestReset = Date.now(); }
}
function questProgress(u, key, n = 1) { checkQuestReset(u); if (u.quests[key]) u.quests[key].current += n; }

function publicPlayer(u) {
    if (!u) return u;
    const { password, _frac, ...safe } = u;
    return { ...safe, army: { total: u.crew }, power: calculatePlayerPower(u), crimeOps: crimeOps(u), ...vipInfo(u), trainCap: trainCap(u), hospitalCap: hospitalCap(u), production: productionPerMin(u), bag: u.bag || {}, gold: u.gold || 0, buffs: u.buffs || {}, login: u.login, onl: onlInfo(u), heroJoin: heroJoinLevels(u), build: u.build || null, troops: u.troops || {}, train: u.train || null, marches: (u.marches || []).map(m => marchPublic(u, m, true)), marchSlots: marchSlots(u), story: storyInfo(u), lead: leadInfo(u), conf: confInfo(u), leadEff: { build: lb(u, 'build'), trainSp: lb(u, 'trainSp'), speed: lb(u, 'speed') + confBuff(u, 'speed'), load: lb(u, 'load'), heal: lb(u, 'heal') }, ev: evInfo(u), helps: clanHelps(u).length, gear: gearInfo(u), rallies: clanRallies(u).length, thugMax: (u.st || {}).thugMax || 0, atkMult: attackMult(u), defMult: defenseMult(u), garage: garageInfo(u), heroTM: heroTM(u) };
}
function resourceSnapshot(u) {
    return { cash: u.cash, cargo: u.cargo, arms: u.arms, metal: u.metal, crew: u.crew, army: { total: u.crew }, hospital: u.hospital, power: calculatePlayerPower(u), crimeOps: crimeOps(u), ...vipInfo(u), trainCap: trainCap(u), hospitalCap: hospitalCap(u), investments: u.investments, heroes: u.heroes, shieldUntil: u.shieldUntil, production: productionPerMin(u), bag: u.bag || {}, gold: u.gold || 0, buffs: u.buffs || {}, login: u.login, onl: onlInfo(u), heroJoin: heroJoinLevels(u), build: u.build || null, troops: u.troops || {}, train: u.train || null, marches: (u.marches || []).map(m => marchPublic(u, m, true)), marchSlots: marchSlots(u), story: storyInfo(u), lead: leadInfo(u), conf: confInfo(u), leadEff: { build: lb(u, 'build'), trainSp: lb(u, 'trainSp'), speed: lb(u, 'speed') + confBuff(u, 'speed'), load: lb(u, 'load'), heal: lb(u, 'heal') }, ev: evInfo(u), helps: clanHelps(u).length, gear: gearInfo(u), rallies: clanRallies(u).length, thugMax: (u.st || {}).thugMax || 0, atkMult: attackMult(u), defMult: defenseMult(u), garage: garageInfo(u), heroTM: heroTM(u), spinDay: u.spinDay || null, vipChestDay: u.vipChestDay || null, base: u.base };
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

// ═══════════════════════════════════════════
// BİRLİKLER (MC: 4 tür × 5 kademe, karşı-üstünlük döngüsü)
//   Kabadayı > Tetikçi > Motorcu > Kabadayı ; Zırhlı Araç garnizon/duvar nöbetçisine karşı güçlü, yavaş ama çok taşır
//   anahtar = tür harfi + kademe ('k1'..'a5'); 'n' = NPC muhafız (garnizon, duvar, maden bekçisi)
// ═══════════════════════════════════════════
const TROOPS = {
    k: { name: 'Kabadayı', role: 'Yakın dövüş · sağlam', atk: 8, def: 12, hp: 14, spd: 1, load: 1, beats: 't', cost: { cash: 50, cargo: 30, arms: 5, metal: 10 }, tiers: ['Sokak Serserisi', 'Kabadayı', 'Fedai', 'Tahsildar', 'Demir Yumruk', 'Celallı Muhafız', 'Kasap', 'Efsane Fedai'] },
    t: { name: 'Tetikçi', role: 'Ateşli silah · yüksek hasar', atk: 14, def: 6, hp: 8, spd: 1, load: 0.8, beats: 'm', cost: { cash: 40, cargo: 10, arms: 35, metal: 10 }, tiers: ['Acemi Tetikçi', 'Tabancacı', 'Keskin Nişancı', 'Profesyonel', 'Hayalet', 'Gölge Avcı', 'Ölüm Meleği', 'Efsane Tetikçi'] },
    m: { name: 'Motorcu', role: 'Hızlı baskın · en hızlı sefer', atk: 12, def: 8, hp: 9, spd: 1.35, load: 0.9, beats: 'k', cost: { cash: 45, cargo: 15, arms: 20, metal: 25 }, tiers: ['Çaylak Motorcu', 'Motorcu', 'Yol Savaşçısı', 'Hız Şeytanı', 'Kara Şövalye', 'Cehennem Sürücüsü', 'Fırtına Atlısı', 'Efsane Motorcu'] },
    a: { name: 'Zırhlı Araç', role: 'Kuşatma · garnizon ve duvar kırıcı', atk: 10, def: 10, hp: 12, spd: 0.75, load: 2.2, beats: 'n', cost: { cash: 60, cargo: 25, arms: 20, metal: 40 }, tiers: ['Kamyonet', 'Zırhlı Sedan', 'Zırhlı Kamyon', 'Saldırı Aracı', 'Tank Limuzin', 'Kale Kırıcı', 'Demir Dev', 'Efsane Zırhlı'] },
};
const NPC_UNIT = { atk: 10, def: 12, hp: 12 };
const TIER = { mult: [1, 1.6, 2.5, 3.8, 5.6, 8.2, 11.8, 16.5], cost: [1, 1.8, 3, 4.6, 6.8, 9.6, 13.4, 18.5], pow: [3, 6, 11, 18, 28, 42, 62, 90], sec: [0.6, 1.2, 2.2, 3.6, 5.5, 8, 11.5, 16], camp: [1, 4, 9, 15, 21, 24, 27, 30], heal: [25, 40, 65, 100, 150, 220, 320, 460] };
const TIER_UNLOCK = { 6: { gem: 30, cash: 2e6 }, 7: { gem: 60, cash: 5e6 }, 8: { gem: 100, cash: 1e7 } }; // elit kilit: bir kerelik, sırayla
const TROOP_KEYS = []; Object.keys(TROOPS).forEach(t => { for (let l = 1; l <= TIER.mult.length; l++) TROOP_KEYS.push(t + l); });
const isTroopKey = k => typeof k === 'string' && TROOP_KEYS.includes(k);
function tStat(k) {
    if (k === 'n') return { atk: NPC_UNIT.atk, def: NPC_UNIT.def, hp: NPC_UNIT.hp, spd: 1, load: 0, beats: null, type: 'n', tier: 1 };
    const T = TROOPS[k[0]], l = +k.slice(1), m = TIER.mult[l - 1];
    return { atk: T.atk * m, def: T.def * m, hp: T.hp * m, spd: T.spd, load: T.load, beats: T.beats, type: k[0], tier: l };
}
function mixTotal(m) { let s = 0; for (const k in m || {}) if (m[k] > 0) s += m[k]; return s; }
function mixAdd(dst, src, sign = 1) { for (const k in src || {}) { const v = (dst[k] || 0) + sign * (src[k] || 0); if (v > 0) dst[k] = v; else delete dst[k]; } return dst; }
function mixScale(m, f) { const o = {}; for (const k in m || {}) { const v = Math.floor(m[k] * f); if (v > 0) o[k] = v; } return o; }
function mixTake(m, n) { // m'den n adamı oransal çek (m değişir); çekilen karışım döner
    const tot = mixTotal(m); n = Math.min(Math.floor(n), tot); if (n <= 0) return {};
    const out = {}; let left = n; const ks = Object.keys(m).filter(k => m[k] > 0).sort((a, b) => m[b] - m[a]);
    for (const k of ks) { const q = Math.min(m[k], Math.floor(m[k] * n / tot)); if (q > 0) { out[k] = q; left -= q; } }
    for (const k of ks) { if (left <= 0) break; const q = Math.min(m[k] - (out[k] || 0), left); if (q > 0) { out[k] = (out[k] || 0) + q; left -= q; } }
    mixAdd(m, out, -1); return out;
}
function cleanMix(raw, have) { const o = {}; for (const k in raw || {}) { if (!isTroopKey(k)) continue; const n = Math.min(int(raw[k]), (have || {})[k] || 0); if (n > 0) o[k] = n; } return o; }
function syncTroops(u) { u.troops = u.troops || {}; u.crew = mixTotal(u.troops); u.hospital = u.hospital || {}; u.hospital.mix = u.hospital.mix || {}; u.hospital.infantry = mixTotal(u.hospital.mix); }
function giveTroops(u, mix) { mixAdd(u.troops = u.troops || {}, mix); syncTroops(u); }
function tierUnlocked(u, l) { return bLevel(u, 'camp_main') >= TIER.camp[l - 1] && (!TIER_UNLOCK[l] || !!(u.tierUnl || {})[l]); }
function bestTier(u) { let b = 1; for (let l = 2; l <= TIER.mult.length; l++) if (tierUnlocked(u, l)) b = l; return b; }
function troopPower(mix) { let p = 0; for (const k in mix || {}) p += (mix[k] || 0) * (k === 'n' ? 3 : TIER.pow[+k.slice(1) - 1]); return p; }
// karşı-üstünlüklü etkin güç (vs: karşı tarafın karışımı)
function sidePower(mix, vs, mult, defending, tm) {
    const vt = mixTotal(vs) || 1; let p = 0;
    for (const k in mix) {
        const n = mix[k]; if (!(n > 0)) continue; const s = tStat(k); let cm = 1;
        for (const e in vs) { const w = (vs[e] || 0) / vt, et = e === 'n' ? 'n' : e[0]; if (s.beats === et) cm += 0.3 * w; else if (et !== 'n' && TROOPS[et] && TROOPS[et].beats === s.type) cm -= 0.2 * w; }
        const a = s.atk * cm, d = (s.def + s.hp) / 2;
        p += n * (defending ? a * 0.8 + d * 1.2 : a + d * 0.5) * (tm && tm[s.type] ? 1 + tm[s.type] : 1);
    }
    return p * mult;
}
// kayıpları türlere dağıt: canı düşük birlik daha çok düşer
function mixLoss(mix, n) {
    const tot = mixTotal(mix); n = Math.min(Math.floor(n), tot); if (n <= 0) return {};
    const w = {}; let ws = 0; for (const k in mix) { if (!(mix[k] > 0)) continue; w[k] = mix[k] / Math.sqrt(tStat(k).hp); ws += w[k]; }
    const out = {}; let left = n;
    for (const k in w) { const q = Math.min(mix[k], Math.floor(n * w[k] / ws)); if (q > 0) { out[k] = q; left -= q; } }
    for (const k in w) { if (left <= 0) break; const q = Math.min(mix[k] - (out[k] || 0), left); if (q > 0) { out[k] = (out[k] || 0) + q; left -= q; } }
    return out;
}
function battle(atkMix, atkMult, defMix, defMult, atm, dtm) {
    const ap = sidePower(atkMix, defMix, atkMult, false, atm) * (0.9 + Math.random() * 0.2);
    const dp = sidePower(defMix, atkMix, defMult, true, dtm) * (0.9 + Math.random() * 0.2);
    const win = ap > dp, at = mixTotal(atkMix), dt = mixTotal(defMix); let ar, dr;
    if (win) { const r = dp / Math.max(1, ap); ar = 0.1 + 0.4 * r; dr = 0.6 + 0.3 * (1 - r); }
    else { const r = ap / Math.max(1, dp); ar = 0.8 - 0.3 * r; dr = 0.5 * r; }
    const aLost = mixLoss(atkMix, at * ar), dLost = mixLoss(defMix, dt * dr);
    return { attackerWins: win, atkPower: Math.round(ap), defPower: Math.round(dp), aLost, dLost, attackerLosses: mixTotal(aLost), defenderLosses: mixTotal(dLost) };
}
// yaralıların %70'i hastaneye (kapasite kadar), kalanı ölür
function sendToHospital(u, mix) {
    syncTroops(u); const wounded = mixScale(mix, 0.7), room = Math.max(0, hospitalCap(u) - u.hospital.infantry);
    const adm = mixTotal(wounded) <= room ? wounded : mixTake({ ...wounded }, room);
    mixAdd(u.hospital.mix, adm); syncTroops(u);
    return { admitted: mixTotal(adm), dead: mixTotal(mix) - mixTotal(adm) };
}
// ── Eğitim kuyruğu (kamp): süreli; ücretsiz sınırın altındaysa bedava biter ──
function trainSeconds(u, l, n) { const f = Math.max(0.3, 1 - (bLevel(u, 'camp_main') - 1) * 0.02 - invBonus(u, 'trainSpeed') - vipPerk(u, 'train') - lb(u, 'trainSp')); return Math.max(2, Math.round(TIER.sec[l - 1] * n * f)); }
function trainCostOf(u, key, n) { const T = TROOPS[key[0]], l = +key.slice(1), disc = Math.max(0.5, 1 - invBonus(u, 'trainCost') - vipPerk(u, 'train')); const c = {}; for (const r in T.cost) c[r] = Math.ceil(T.cost[r] * TIER.cost[l - 1] * n * disc); return c; }
function finishTrain(u, notify) {
    const t = u.train; if (!t) return null; u.train = null; giveTroops(u, { [t.key]: t.n }); questProgress(u, 'train', t.n); stat(u, 'trained', t.n); casTrain(u, t.key, t.n); addXP(u, t.n * TIER.pow[+t.key.slice(1) - 1] / 12, notify); evPoints(u, 'war', t.n * TIER.pow[+t.key.slice(1) - 1]); markDirty('users');
    if (notify) { emitTo(u.username, 'trainDone', t); emitTo(u.username, 'toast', { type: 'success', msg: `${t.n} ${TROOPS[t.key[0]].tiers[+t.key.slice(1) - 1]} eğitimi tamamlandı.` }); pushResources(u.username); }
    return t;
}
// ═══ SEFERLER (MC: haritada yol süresi; varınca savaş, sonra dönüş) ═══
const MARCH_SPEED = 45, MARCH_MIN = 10e3, MARCH_MAX = 240e3;
let WPOS = {};
function computeWorldPos() { // istemcideki dünya yerleşimiyle birebir (enlem/boylam → izometrik + itme)
    const SQ = Math.SQRT1_2, LIM = 5000, R0 = { capital: 150, city: 130, mine: 90, boss: 80 }, items = [];
    const add = (id, kind, lat, lng) => { const u = lng / 180 * 3900, v = -(lat - 22) / 90 * 4300; items.push({ id, kind, x: (u + v) * SQ, z: (v - u) * SQ, r: R0[kind] }); };
    Object.values(world.cities || {}).forEach(c => add(c.id, c.type === 'capital' ? 'capital' : 'city', c.lat, c.lng));
    Object.values(world.mines || {}).forEach(m => add(m.id, 'mine', m.lat, m.lng));
    Object.values(world.bosses || {}).forEach(b => add(b.id, 'boss', b.lat, b.lng));
    items.sort((a, b) => a.id < b.id ? -1 : 1);
    for (let it = 0; it < 220; it++) { let moved = false; for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const a = items[i], b = items[j]; let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz); const need = a.r + b.r + 60; if (d < need) { if (d < 1e-3) { dx = 1; dz = 0.3; d = 1.04; } const p = (need - d) / 2 + 0.5; a.x -= dx / d * p; a.z -= dz / d * p; b.x += dx / d * p; b.z += dz / d * p; moved = true; } } for (const a of items) { const lim = LIM - 500; a.x = Math.max(-lim, Math.min(lim, a.x)); a.z = Math.max(-lim, Math.min(lim, a.z)); } if (!moved) break; }
    const out = {}; items.forEach(a => out[a.id] = { x: Math.round(a.x), z: Math.round(a.z) }); WPOS = out;
}
computeWorldPos();
// ═══ SOKAK ÇETELERİ (MC "Haydutlar"): haritada Sv.1–15 NPC mekânları; her seviyeden en az 2, toplam 48.
//   kural: en yüksek yendiğin seviye + 1'e kadar saldırabilirsin. Yenilen mekân dağılır, başka yerde yenisi çıkar. Muhafız dakikada %10 toparlanır. ═══
const THUG_MAX = 15, THUG_COUNT = 48;
const thugGuard = l => Math.round(120 * Math.pow(l, 1.6));
function thugSpot() {
    for (let k = 0; k < 500; k++) {
        const x = Math.round((Math.random() * 2 - 1) * 4300), z = Math.round((Math.random() * 2 - 1) * 4300);
        if (Object.values(WPOS).some(q => Math.hypot(q.x - x, q.z - z) < 240)) continue;
        if (Object.values(users).some(u => u.base && Math.hypot(u.base.x - x, u.base.z - z) < 220)) continue;
        if (Object.values(world.thugs || {}).some(t => Math.hypot(t.x - x, t.z - z) < 170)) continue;
        if (nearHall(x, z, 90)) continue;
        return { x, z };
    }
    return null;
}
function spawnThug(lvl) { const q = thugSpot(); if (!q) return null; world.thugSeq = (world.thugSeq || 0) + 1; const l = lvl || 1 + Math.floor(Math.pow(Math.random(), 1.6) * THUG_MAX), id = 'th' + world.thugSeq; world.thugs[id] = { id, lvl: l, x: q.x, z: q.z, guard: thugGuard(l), max: thugGuard(l) }; return world.thugs[id]; }
function ensureThugs() {
    world.thugs = world.thugs && typeof world.thugs === 'object' ? world.thugs : {}; let n = Object.keys(world.thugs).length;
    for (let l = 1; l <= THUG_MAX; l++) { let c = Object.values(world.thugs).filter(t => t.lvl === l).length; while (c < 2) { if (!spawnThug(l)) break; c++; n++; } }
    while (n < THUG_COUNT) { if (!spawnThug()) break; n++; }
}
ensureThugs(); markDirty('world');

// ═══ KAYNAK NOKTALARI (MC "toplama"): Sv.1–6 Cash/Cargo/Arms/Metal; toplama hızı seviyeyle artar; tek patron toplar ═══
const RES_TYPES = ['cash', 'cargo', 'arms', 'metal'], RES_COUNT = 64;
const RES_AMT = [0, 20000, 45000, 80000, 140000, 220000, 320000];      // nokta stoğu (seviyeye göre)
const RES_RATE = [0, 400, 600, 850, 1150, 1500, 1900];                  // dakikada toplanan (arms/metal yarısı)
function resSpot() {
    for (let k = 0; k < 500; k++) {
        const x = Math.round((Math.random() * 2 - 1) * 4400), z = Math.round((Math.random() * 2 - 1) * 4400);
        if (Object.values(WPOS).some(q => Math.hypot(q.x - x, q.z - z) < 230)) continue;
        if (Object.values(users).some(u => u.base && Math.hypot(u.base.x - x, u.base.z - z) < 200)) continue;
        if (Object.values(world.thugs || {}).some(t => Math.hypot(t.x - x, t.z - z) < 140)) continue;
        if (Object.values(world.res || {}).some(t => Math.hypot(t.x - x, t.z - z) < 150)) continue;
        if (nearHall(x, z, 90)) continue;
        return { x, z };
    }
    return null;
}
function spawnRes() { const q = resSpot(); if (!q) return null; world.resSeq = (world.resSeq || 0) + 1; const l = 1 + Math.floor(Math.pow(Math.random(), 1.4) * 6), type = RES_TYPES[Math.floor(Math.random() * 4)], id = 'rs' + world.resSeq;
    world.res[id] = { id, type, lvl: l, x: q.x, z: q.z, left: RES_AMT[l], max: RES_AMT[l], by: null }; return world.res[id]; }
function ensureRes() { world.res = world.res && typeof world.res === 'object' ? world.res : {}; let n = Object.keys(world.res).length; while (n < RES_COUNT) { if (!spawnRes()) break; n++; } }
ensureRes(); markDirty('world');
function gatherRate(u, type, lvl) { return RES_RATE[lvl] * (type === 'arms' || type === 'metal' ? 0.5 : 1) * (1 + lb(u, 'load') * 0.5 + (buffOn(u, 'prod') ? 0.25 : 0)); } // dakikada
function targetPos(kind, id) { if (kind === 'res') { const t = (world.res || {})[id]; return t ? { x: t.x, z: t.z } : null; } if (kind === 'thug') { const t = (world.thugs || {})[id]; return t ? { x: t.x, z: t.z } : null; } if (kind === 'player') { const t = users[id]; return t && t.base ? { x: t.base.x, z: t.base.z } : null; } const p = WPOS[id]; return p ? { x: p.x, z: p.z } : null; }
function marchSlots(u) { const l = (u.base && u.base.level) || 1; return 1 + (l >= 6 ? 1 : 0) + (l >= 12 ? 1 : 0) + (l >= 20 ? 1 : 0); }
function marchSpeed(mix, u) { let s = 9; for (const k in mix) if (mix[k] > 0) s = Math.min(s, tStat(k).spd); return MARCH_SPEED * (s === 9 ? 1 : s) * (u ? 1 + lb(u, 'speed') + confBuff(u, 'speed') : 1); }
function loadOf(mix) { let l = 0; for (const k in mix) l += (mix[k] || 0) * tStat(k).load * 50; return Math.floor(l); }
let marchSeq = 1;
function marchPublic(u, m, own) { const o = { id: m.id, owner: u.username, color: u.empireColor || '#c0392b', kind: m.kind, target: m.target, name: m.name, from: m.from, to: m.to, t0: m.t0, t1: m.t1, state: m.state, n: mixTotal(m.troops), lead: m.lead || 'm', rid: m.rid || null, rl: m.rl || null, hide: !!m.hide, tot: m.tot || 0, gt: m.gt || null, gwant: m.gwant || 0 }; if (own) { o.troops = m.troops; o.loot = m.loot || null; o.mats = m.mats || null; } return o; }
function allMarches() { const L = []; Object.values(users).forEach(u => (u.marches || []).forEach(m => { if (!m.hide) L.push(marchPublic(u, m, false)); })); return L; }
function broadcastMarches() { io.emit('marches', allMarches()); }
function leadType(mix) { let best = 'k', bn = -1; const c = {}; for (const k in mix) c[k[0]] = (c[k[0]] || 0) + mix[k]; for (const t in c) if (c[t] > bn) { bn = c[t]; best = t; } return best; } // haritadaki görünüm (motor/araba/yaya)

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
    Object.values(world.thugs || {}).forEach(t => { if (t.guard < t.max) { t.guard = Math.min(t.max, t.guard + Math.ceil(t.max * 0.1)); worldChanged = true; } });
    Object.values(world.res || {}).forEach(t => { if (t.by) { const o = users[t.by]; if (!o || !(o.marches || []).some(m => m.kind === 'res' && m.target === t.id)) { t.by = null; worldChanged = true; } } });
    { const r0 = Object.keys(world.res || {}).length; ensureRes(); if (Object.keys(world.res).length !== r0) worldChanged = true; }
    { const n0 = Object.keys(world.thugs || {}).length; ensureThugs(); if (Object.keys(world.thugs).length !== n0) worldChanged = true; } // her seviyeden en az 2 çete kalsın
    Object.values(world.bosses).forEach(b => {
        if (b.defeated && now >= b.respawnAt) { b.defeated = false; b.currentHp = b.hp; b.attackers = {}; io.emit('toast', { type: 'info', msg: `⚠️ ${b.beast} yeniden ortaya çıktı!` }); worldChanged = true; }
    });
    try { if (hallMinute()) worldChanged = true; } catch (e) { console.error('belediye dk', e); }
    try { slamWeekly(); } catch (e) { console.error('hapishane hafta', e); }
    try { if (lightMinute()) worldChanged = true; } catch (e) { console.error('fener', e); }
    try { if (terMinute()) worldChanged = true; } catch (e) { console.error('bölge', e); }
    try { achMinute(); } catch (e) { console.error('başarım', e); }
    try { if (casMinute()) worldChanged = true; } catch (e) { console.error('kumarhane', e); }
    new Set(Object.values(sessions)).forEach(pushResources);
    if (worldChanged) { markDirty('world'); broadcastWorld(); }
}, 60 * 1000);

// ═══════════════════════════════════════════
// LİDER (MC: lider seviyesi + yetenek puanı → üç yetenek ağacı)
//   deneyim: inşaat, eğitim, zafer, bounty, bölüm, günlük giriş, gelişim görevi
// ═══════════════════════════════════════════
const LEAD_MAX = 60;
const xpNeed = l => Math.round(120 * Math.pow(l, 1.55));
const TALENTS = {
    war: { name: 'Savaş', list: [
        { id: 'atk', name: 'Sokak Dövüşü', desc: 'Saldırı +%2', per: 0.02, max: 5, ic: 'big_pistols' },
        { id: 'def', name: 'Siper', desc: 'Savunma +%2', per: 0.02, max: 5, ic: 'shield' },
        { id: 'ops', name: 'Komuta', desc: 'Sefer kapasitesi +100', per: 100, max: 5, ic: 'swords' },
        { id: 'plunder', name: 'Ganimet', desc: 'Yağma oranı +%3', per: 0.03, max: 5, ic: 'cash' }] },
    grow: { name: 'Gelişim', list: [
        { id: 'prod', name: 'İş Zekâsı', desc: 'Kaynak üretimi +%3', per: 0.03, max: 5, ic: 'r_gold' },
        { id: 'build', name: 'Usta Ekip', desc: 'İnşaat süresi -%4', per: 0.04, max: 5, ic: 'hammer_g' },
        { id: 'trainSp', name: 'Disiplin', desc: 'Eğitim süresi -%4', per: 0.04, max: 5, ic: 'glove' },
        { id: 'vault', name: 'Kasa', desc: 'Korunan kaynak +%5', per: 0.05, max: 5, ic: 'briefcase' }] },
    supp: { name: 'Destek', list: [
        { id: 'hosp', name: 'Saha Doktoru', desc: 'Hastane kapasitesi +300', per: 300, max: 5, ic: 'medkit' },
        { id: 'heal', name: 'Ucuz İlaç', desc: 'Tedavi ücreti -%6', per: 0.06, max: 5, ic: 'sc_hosp' },
        { id: 'speed', name: 'Hızlı Rota', desc: 'Sefer hızı +%5', per: 0.05, max: 5, ic: 'map_search' },
        { id: 'load', name: 'Büyük Bagaj', desc: 'Taşıma kapasitesi +%8', per: 0.08, max: 5, ic: 'cargo' }] },
};
const TALDEF = {}; Object.values(TALENTS).forEach(tr => tr.list.forEach(x => TALDEF[x.id] = x));
function lead(u) { if (!u.lead || typeof u.lead !== 'object') u.lead = { lvl: 1, xp: 0, pts: 0, tal: {} }; u.lead.tal = u.lead.tal || {}; return u.lead; }
function tal(u, id) { const d = TALDEF[id]; return d ? ((lead(u).tal[id] || 0) * d.per) : 0; }
function lb(u, k) { return tal(u, k) + gearB(u, k) + carB(u, k) + heroB(u, k) + hallB(u, k) + confSkB(u, k) + clanB(u, k) + skinB(u, k) + lightB(u, k) + terB(u, k) + achB(u, k); } // lider yeteneği + ekipman + aktif araba // lider yeteneği + ekipman (aynı anahtarlar)
function addXP(u, n, notify) {
    const L = lead(u); if (L.lvl >= LEAD_MAX || !(n > 0)) return; L.xp += Math.floor(n); let up = 0;
    while (L.lvl < LEAD_MAX && L.xp >= xpNeed(L.lvl)) { L.xp -= xpNeed(L.lvl); L.lvl++; L.pts++; up++; }
    if (up && notify) { emitTo(u.username, 'leaderUp', { lvl: L.lvl, pts: L.pts }); emitTo(u.username, 'toast', { type: 'victory', msg: `Lider seviyesi ${L.lvl}! +${up} yetenek puanı` }); }
}
function leadInfo(u) { const L = lead(u); return { lvl: L.lvl, xp: L.xp, need: xpNeed(L.lvl), pts: L.pts, tal: L.tal, max: LEAD_MAX }; }
// ═══ SIRDAŞLAR (MC "Babe": yakınlık seviyesi → kalıcı destek; sohbet, elmas oyunu, hediye) ═══
const CONFIDANTS = {
    valentina: { name: 'Valentina', role: 'Asistan', buff: 'prod', per: 0.01, desc: 'Kaynak üretimi +%1', unlock: 1 },
    carmine: { name: 'Carmine Amca', role: 'Danışman', buff: 'def', per: 0.008, desc: 'Savunma +%0,8', unlock: 3 },
    elena: { name: "Elena 'Kara Dul'", role: 'Bilgi Simsarı', buff: 'atk', per: 0.008, desc: 'Saldırı +%0,8', unlock: 6 },
    lucia: { name: 'Gölge Lucia', role: 'Gölge', buff: 'speed', per: 0.012, desc: 'Sefer hızı +%1,2', unlock: 10 },
};

const CONF_SKILLS = { // yakınlık seviyesiyle açılan beceriler: key = genel etki (lb), t = birlik türü gücü
    valentina: [{ lvl: 2, key: 'prod', v: 0.03, name: 'Defter Tutma' }, { lvl: 4, key: 'build', v: 0.04, name: 'Müteahhit Dostu' }, { lvl: 6, key: 'vault', v: 0.08, name: 'Gizli Kasa' }, { lvl: 8, key: 'load', v: 0.10, name: 'Lojistik Ağı' }],
    carmine:   [{ lvl: 2, t: 'k', v: 0.03, name: 'Eski Usul' }, { lvl: 4, key: 'def', v: 0.02, name: 'Sağduyu' }, { lvl: 6, key: 'hosp', v: 500, name: 'Doktor Tanıdık' }, { lvl: 8, key: 'heal', v: 0.08, name: 'Ucuz Reçete' }],
    elena:     [{ lvl: 2, t: 't', v: 0.03, name: 'Zehirli Kurşun' }, { lvl: 4, key: 'plunder', v: 0.04, name: 'Sır Simsarı' }, { lvl: 6, key: 'atk', v: 0.02, name: 'Kara Dul Yemini' }, { lvl: 8, key: 'trainSp', v: 0.05, name: 'Hızlı Bağlantı' }],
    lucia:     [{ lvl: 2, t: 'm', v: 0.03, name: 'Gece Sürüşü' }, { lvl: 4, t: 'a', v: 0.03, name: 'Zırh Delici' }, { lvl: 6, key: 'speed', v: 0.05, name: 'Gölge Rota' }, { lvl: 8, key: 'ops', v: 300, name: 'Sessiz Ekip' }],
};
const CONF_OUTFITS = { // o0 varsayılan; giyilen kıyafetin etkisi
    valentina: [{ id: 'o0', name: 'Bordo Saten' }, { id: 'o1', name: 'Gece Işıltısı', lvl: 5, fx: { prod: 0.02 } }, { id: 'o2', name: 'Şehir Şıklığı', lvl: 9, fx: { build: 0.03 } }],
    carmine:   [{ id: 'o0', name: 'Çizgili Takım' }, { id: 'o1', name: 'Sicilya Yazı', lvl: 5, fx: { def: 0.01 } }, { id: 'o2', name: 'Gala Smokini', lvl: 9, fx: { def: 0.02 } }],
    elena:     [{ id: 'o0', name: 'Yas Elbisesi' }, { id: 'o1', name: 'Kızıl Gala', lvl: 5, fx: { atk: 0.01 } }, { id: 'o2', name: 'Beyaz Kürk', lvl: 9, fx: { atk: 0.02 } }],
    lucia:     [{ id: 'o0', name: 'Deri Palto' }, { id: 'o1', name: 'Gece Operasyonu', lvl: 5, fx: { speed: 0.02 } }, { id: 'o2', name: 'Maskeli Balo', lvl: 9, fx: { speed: 0.03 } }],
};
const CONF_ROSES = 3, CONF_STREAK_MAX = 4, cupFav = st => 30 * Math.pow(2, Math.min(CONF_STREAK_MAX, st));
function confSkB(u, k) { // sırdaş becerileri + giyilen kıyafet (lb anahtarları)
    const c = u.conf || {}; let v = 0;
    for (const id in CONFIDANTS) { const x = c[id]; if (!x || !confOpen(u, id)) continue; const L = x.lvl || 1;
        (CONF_SKILLS[id] || []).forEach(q => { if (q.key === k && L >= q.lvl) v += q.v; });
        const o = (CONF_OUTFITS[id] || []).find(q => q.id === x.o); if (o && o.fx && o.fx[k]) v += o.fx[k]; }
    return v;
}
function confTM(u, tm) { const c = u.conf || {}; for (const id in CONFIDANTS) { const x = c[id]; if (!x || !confOpen(u, id)) continue; (CONF_SKILLS[id] || []).forEach(q => { if (q.t && (x.lvl || 1) >= q.lvl) tm[q.t] = (tm[q.t] || 0) + q.v; }); } return tm; }
const CONF_MAX = 10, favNeed = l => 80 + l * 60, CONF_DAILY = { talk: 3, game: 3 };
function conf(u) { const c = u.conf = u.conf && typeof u.conf === 'object' ? u.conf : {}; const d = dayKey(Date.now()); if (c.day !== d) { c.day = d; c.talk = CONF_DAILY.talk; c.game = CONF_DAILY.game; } Object.keys(CONFIDANTS).forEach(k => { c[k] = c[k] || { lvl: 1, fav: 0 }; }); return c; }
function confBuff(u, key) { const c = u.conf || {}; let s = 0; for (const k in CONFIDANTS) { const C = CONFIDANTS[k]; if (C.buff === key && c[k] && confOpen(u, k)) s += (c[k].lvl || 1) * C.per; } return s; }
function confOpen(u, k) { return ((u.base && u.base.level) || 1) >= CONFIDANTS[k].unlock; }
function addFavor(u, k, n) { const c = conf(u)[k]; if (c.lvl >= CONF_MAX) return 0; c.fav += n; let up = 0; while (c.lvl < CONF_MAX && c.fav >= favNeed(c.lvl)) { c.fav -= favNeed(c.lvl); c.lvl++; up++; } return up; }
function confInfo(u) { const c = conf(u), o = { talk: c.talk, game: c.game, rose: c.roseDay !== dayKey(Date.now()), streak: c.streak || 0, roses: (u.bag || {}).gift_rose || 0, list: {} }; for (const k in CONFIDANTS) o.list[k] = { lvl: c[k].lvl, fav: c[k].fav, need: favNeed(c[k].lvl), open: confOpen(u, k), o: c[k].o || 'o0' }; return o; }

// ═══════════════════════════════════════════
// EKİPMAN (MC "Ekipman Atölyesi"): 6 yuva × 4 kademe; Dökümhane'de malzeme + Cash ile süreli üretilir.
//   kalite (Sıradan → Efsane) üretim bitince belirlenir; olasılıklar oyuncuya açıkça gösterilir ve
//   "şans sayacı" Epik altı her üretimde artar → en geç 10. üretimde Epik+ garanti (adil sistem)
//   geliştirme +1..+5 (her + %8), parçalama (tarifin %50'si geri), 3 / 6 parça set bonusu
// ═══════════════════════════════════════════
const GEAR_SLOTS = {
    hat:   { name: 'Şapka',    st: ['ops', 'heal'],      mix: { silk: 0.45, leather: 0.4, steel: 0.15 }, names: ['Yün Kasket', 'Fötr Şapka', 'Panama Şapka', 'Baron Silindiri'] },
    suit:  { name: 'Takım',    st: ['def', 'hosp'],      mix: { silk: 0.55, leather: 0.25, steel: 0.2 }, names: ['Deri Ceket', 'Çizgili Takım', 'İpek Smokin', 'Baron Paltosu'] },
    gun:   { name: 'Silah',    st: ['atk', 'plunder'],   mix: { steel: 0.5, leather: 0.3, silk: 0.2 },   names: ['Eski Revolver', 'Tommy Makinelisi', 'Altın Colt', 'Ejder Tüfeği'] },
    shoes: { name: 'Ayakkabı', st: ['speed', 'load'],    mix: { leather: 0.6, silk: 0.2, steel: 0.2 },   names: ['Spor Ayakkabı', 'Rugan Ayakkabı', 'Timsah Derisi', 'Baron Çizmesi'] },
    ring:  { name: 'Yüzük',    st: ['prod', 'vault'],    mix: { steel: 0.6, silk: 0.3, leather: 0.1 },   names: ['Gümüş Yüzük', 'Mühür Yüzüğü', 'Yakut Yüzük', 'Baron Mührü'] },
    watch: { name: 'Saat',     st: ['build', 'trainSp'], mix: { steel: 0.5, silk: 0.3, leather: 0.2 },   names: ['Cep Saati', 'Altın Kol Saati', 'Pırlanta Saat', 'Baron Kronografı'] },
};
const GEAR_SLOT_KEYS = Object.keys(GEAR_SLOTS);
const GEAR_TIERS = [ // lead: kuşanmak için lider sv. · smelter: üretmek için Dökümhane sv. · mats: toplam ortak malzeme · sec: üretim süresi
    { name: 'Sokak',    lead: 1,  smelter: 1,  mats: 16,  gem: 0, cash: 3000,   sec: 60,       pow: 300 },
    { name: 'Kabadayı', lead: 8,  smelter: 4,  mats: 54,  gem: 0, cash: 20000,  sec: 15 * 60,  pow: 900 },
    { name: 'Patron',   lead: 18, smelter: 8,  mats: 136, gem: 2, cash: 80000,  sec: 3600,     pow: 2500 },
    { name: 'Baron',    lead: 30, smelter: 12, mats: 300, gem: 6, cash: 250000, sec: 4 * 3600, pow: 6000 },
];
const GEAR_Q = { names: ['Sıradan', 'İyi', 'Nadir', 'Epik', 'Efsane'], mult: [1, 1.3, 1.65, 2.1, 2.7] };
const GEAR_VAL = { // Sıradan kalitede birincil etki (ikincil etki bunun %60'ı)
    atk: [0.015, 0.03, 0.05, 0.08], def: [0.015, 0.03, 0.05, 0.08], plunder: [0.01, 0.02, 0.03, 0.045], hosp: [150, 300, 600, 1000], ops: [40, 80, 150, 250], heal: [0.02, 0.04, 0.06, 0.08],
    speed: [0.02, 0.035, 0.055, 0.08], load: [0.04, 0.07, 0.11, 0.16], prod: [0.02, 0.035, 0.055, 0.08], vault: [0.03, 0.06, 0.1, 0.15], build: [0.015, 0.03, 0.045, 0.065], trainSp: [0.015, 0.03, 0.045, 0.065] };
const GEAR_SET = { three: { key: 'prod', val: [0.02, 0.03, 0.05, 0.08] }, six: { keys: ['atk', 'def'], val: [0.02, 0.04, 0.07, 0.10] } }; // set kademesi = en az n parçanın ulaştığı kademe
const GEAR_ENH_MAX = 5, GEAR_INV_MAX = 40, GEAR_PITY = 9;
const MATS = { leather: 'Deri', steel: 'Çelik', silk: 'İpek', gem: 'Pırlanta' };
function gear(u) { const g = u.gear = u.gear && typeof u.gear === 'object' ? u.gear : {}; if (!Array.isArray(g.inv)) g.inv = []; g.eq = g.eq || {}; g.mat = g.mat || {}; g.seq = g.seq || 1; g.pity = g.pity || 0; g.made = g.made || 0; return g; }
function gearCost(slot, t) { const T = GEAR_TIERS[t], S = GEAR_SLOTS[slot], c = {}; for (const k in S.mix) c[k] = Math.ceil(T.mats * S.mix[k]); if (T.gem) c.gem = slot === 'ring' ? Math.ceil(T.gem * 1.5) : T.gem; return c; }
function enhCost(it) { const base = gearCost(it.s, it.t), e = it.e || 0, c = {}; for (const k in base) if (k !== 'gem') c[k] = Math.ceil(base[k] * 0.25 * (e + 1)); const gm = e >= 2 ? Math.ceil((it.t + 1) * (e - 1) / 2) : 0; if (gm) c.gem = gm; return c; }
function gearStats(it) { const S = GEAR_SLOTS[it.s], qm = GEAR_Q.mult[it.q] * (1 + 0.08 * (it.e || 0)), o = {}; S.st.forEach((k, i) => o[k] = GEAR_VAL[k][it.t] * qm * (i ? 0.6 : 1)); return o; }
function gearWorn(u) { const g = u.gear; if (!g || !g.inv) return []; return GEAR_SLOT_KEYS.map(s => g.eq && g.eq[s] && g.inv.find(x => x.id === g.eq[s])).filter(Boolean); }
function gearSet(u) { const eq = gearWorn(u), best = n => { for (let t = GEAR_TIERS.length - 1; t >= 0; t--) if (eq.filter(x => x.t >= t).length >= n) return t; return -1; }; return { n: eq.length, three: best(3), six: best(6) }; }
function gearB(u, key) {
    if (!u.gear) return 0; let v = 0;
    for (const it of gearWorn(u)) { const st = gearStats(it); if (st[key]) v += st[key]; }
    const set = gearSet(u); if (set.three >= 0 && GEAR_SET.three.key === key) v += GEAR_SET.three.val[set.three]; if (set.six >= 0 && GEAR_SET.six.keys.includes(key)) v += GEAR_SET.six.val[set.six];
    return v;
}
function gearPower(u) { return Math.floor(gearWorn(u).reduce((p, it) => p + GEAR_TIERS[it.t].pow * GEAR_Q.mult[it.q] * (1 + 0.1 * (it.e || 0)), 0)); }
function gearOdds(u) { const p = Math.min(GEAR_PITY, gear(u).pity); if (p >= GEAR_PITY) return [0, 0, 0, 78, 22]; const w = [Math.max(5, 45 - 6 * p), 30, 16, 7 + 5 * p, 2 + p], s = w.reduce((a, b) => a + b, 0); return w.map(x => Math.round(x / s * 1000) / 10); }
function rollQuality(u) { const o = gearOdds(u), tot = o.reduce((a, b) => a + b, 0); let x = Math.random() * tot, q = 0; for (; q < 4; q++) { x -= o[q]; if (x < 0) break; } const g = gear(u); g.pity = q >= 3 ? 0 : g.pity + 1; return q; }
function giveMats(u, m) { const g = gear(u); for (const k in m || {}) if (MATS[k] && m[k] > 0) g.mat[k] = (g.mat[k] || 0) + Math.floor(m[k]); }
function randMats(n, gemChance) { const o = {}, ks = ['leather', 'steel', 'silk']; for (let i = 0; i < n; i++) { const k = ks[Math.floor(Math.random() * 3)]; o[k] = (o[k] || 0) + 1; } if (gemChance && Math.random() < gemChance) o.gem = 1; return o; }
function matText(m) { return Object.entries(m || {}).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${MATS[k] || k}`).join(', '); }
function gearName(it) { return `${GEAR_SLOTS[it.s].names[it.t]}${it.e ? ' +' + it.e : ''}`; }
function craftMs(u, t) { return Math.round(GEAR_TIERS[t].sec * 1000 * Math.max(0.5, 1 - lb(u, 'build') * 0.5)); } // usta ekip / saat inşaatın yarısı kadar hızlandırır
function finishCraft(u, notify) {
    const g = gear(u), c = g.craft; if (!c) return null; g.craft = null;
    const it = { id: 'g' + (g.seq++), s: c.s, t: c.t, q: rollQuality(u), e: 0 }; g.inv.push(it); g.made++; stat(u, 'gear');
    addXP(u, 40 * (c.t + 1) * (c.t + 1), notify); evPoints(u, 'build', 200 * (c.t + 1)); markDirty('users');
    if (notify) { emitTo(u.username, 'gearDone', it); emitTo(u.username, 'toast', { type: it.q >= 3 ? 'victory' : 'success', msg: `${GEAR_Q.names[it.q]} kalite ${gearName(it)} üretildi!` }); pushResources(u.username); }
    return it;
}
function gearInfo(u) { const g = gear(u); return { inv: g.inv, eq: g.eq, mat: g.mat, craft: g.craft || null, pity: g.pity, odds: gearOdds(u), set: gearSet(u), made: g.made }; }

// ═══════════════════════════════════════════
// GARAJ (MC "Roadster Club"): araba = 2–4 parça. Bütün parçaları takılınca araba açılır; tek araba AKTİF olur.
//   etkiler lider/ekipman etkileriyle aynı anahtarları kullanır (lb). Parça satışı tam iade.
// ═══════════════════════════════════════════
const PARTS = {
    seat_b:     { name: 'B Sınıfı Koltuk', ic: 'seat',   cost: { leather: 12, silk: 6 },            cash: 5000 },
    seat_a:     { name: 'A Sınıfı Koltuk', ic: 'seat',   cost: { leather: 30, silk: 20 },           cash: 20000 },
    seat_s:     { name: 'S Sınıfı Koltuk', ic: 'seat',   cost: { leather: 70, silk: 50, gem: 1 },   cash: 60000 },
    plug_cu:    { name: 'Bakır Buji',      ic: 'plug',   cost: { steel: 12 },                       cash: 5000 },
    plug_ir:    { name: 'İridyum Buji',    ic: 'plug',   cost: { steel: 45, gem: 1 },               cash: 40000 },
    turbo:      { name: 'Elektrikli Turbo', ic: 'turbo', cost: { steel: 40, silk: 10 },            cash: 30000 },
    turbo2:     { name: 'Çift Nozul Turbo', ic: 'turbo', cost: { steel: 90, silk: 30, gem: 2 },     cash: 90000 },
    rim_cr:     { name: 'Krom Jant',       ic: 'rim',    cost: { steel: 25, leather: 10 },          cash: 15000 },
    rim_sp:     { name: 'Dönen Jant',      ic: 'rim',    cost: { steel: 60, leather: 30, gem: 1 },  cash: 50000 },
    engine_v8:  { name: 'V8 Motor',        ic: 'engine', cost: { steel: 50, leather: 10 },          cash: 40000 },
    engine_v12: { name: 'V12 Motor',       ic: 'engine', cost: { steel: 120, leather: 40, gem: 3 }, cash: 120000 },
    armor:      { name: 'Zırh Kaplama',    ic: 'armor',  cost: { steel: 80, leather: 20, gem: 1 },  cash: 70000 },
    wheel:      { name: 'Deri Direksiyon', ic: 'wheel',  cost: { leather: 25, silk: 10 },           cash: 15000 },
    nav:        { name: 'Gece Görüşü',     ic: 'nav',    cost: { silk: 40, steel: 20, gem: 2 },     cash: 80000 },
};
const CARS = {
    bullet:      { name: 'Gümüş Mermi',   cat: 'Üretim',  villa: 1,  parts: ['seat_b', 'plug_cu'],                         fx: { prod: 0.05, trainSp: 0.02 } },
    tsunami:     { name: 'Tsunami',       cat: 'Üretim',  villa: 6,  parts: ['seat_a', 'turbo', 'rim_cr'],                 fx: { prod: 0.20, trainSp: 0.05 } },
    maddog:      { name: 'Kuduz Köpek',   cat: 'Eğitim',  villa: 8,  parts: ['engine_v8', 'turbo', 'wheel'],               fx: { trainSp: 0.20, prod: 0.05 } },
    canary:      { name: 'Kanarya',       cat: 'Hız',     villa: 10, parts: ['plug_ir', 'rim_cr', 'seat_a'],               fx: { speed: 0.20, ops: 150 } },
    nighthunter: { name: 'Gece Avcısı',   cat: 'Savunma', villa: 12, parts: ['armor', 'nav', 'seat_a'],                    fx: { def: 0.10, hosp: 800 } },
    icy:         { name: 'Buz Kraliçesi', cat: 'Ganimet', villa: 15, parts: ['rim_sp', 'turbo', 'seat_s'],                 fx: { load: 0.25, plunder: 0.05, speed: 0.08 } },
    queen:       { name: 'Kraliçe',       cat: 'Eğitim',  villa: 18, parts: ['engine_v12', 'seat_s', 'wheel', 'rim_sp'],   fx: { trainSp: 0.30, def: 0.05 } },
    hornet:      { name: 'Eşek Arısı',    cat: 'Saldırı', villa: 22, parts: ['engine_v12', 'turbo2', 'armor', 'plug_ir'],  fx: { atk: 0.12, def: 0.08, speed: 0.10 } },
};
function garage(u) { const g = u.garage = u.garage && typeof u.garage === 'object' ? u.garage : {}; g.cars = g.cars || {}; g.active = g.active || null; return g; }
function carDone(u, id) { const C = CARS[id], c = u.garage && u.garage.cars[id]; return !!(C && c && C.parts.every(p => (c.parts || []).includes(p))); }
function carB(u, k) { const g = u.garage; if (!g || !g.active || !carDone(u, g.active)) return 0; return CARS[g.active].fx[k] || 0; }
function garageInfo(u) { const g = garage(u); return { cars: g.cars, active: g.active }; }

// ═══ KAÇAKÇI (MC "Smuggler"): 4 saatte bir yenilenen 6 teklif (oyuncuya özel, karışık); bir kez 20 altınla elle yenilenebilir ═══
const SMUG_WIN = 4 * 3600e3, SMUG_REROLL = 20;
const SMUG_POOL = [
    { id: 'sp1', give: { items: { speed_1h: 2 } }, price: { gold: 85 }, stock: 2 },
    { id: 'sp5', give: { items: { speed_1h: 5 } }, price: { gold: 200 }, stock: 1 },
    { id: 'sp8', give: { items: { speed_8h: 1 } }, price: { gold: 260 }, stock: 1 },
    { id: 'sp5m', give: { items: { speed_5m: 10 } }, price: { cash: 30000 }, stock: 2 },
    { id: 'mb2', give: { items: { mat_box: 2 } }, price: { gold: 110 }, stock: 2 },
    { id: 'mbr', give: { items: { mat_box: 1 } }, price: { metal: 25000 }, stock: 2 },
    { id: 'gm3', give: { items: { gem_1: 3 } }, price: { gold: 140 }, stock: 1 },
    { id: 'rb', give: { items: { res_box: 1 } }, price: { cargo: 30000 }, stock: 2 },
    { id: 'tr5', give: { items: { troops_500: 1 } }, price: { cash: 60000 }, stock: 1 },
    { id: 'gp', give: { items: { gift_perfume: 1 } }, price: { gold: 40 }, stock: 2 },
    { id: 'gr3', give: { items: { gift_rose: 3 } }, price: { cash: 25000 }, stock: 2 },
    { id: 'skb', give: { items: { skin_box: 2 } }, price: { gold: 130 }, stock: 2 },
    { id: 'vp', give: { items: { vip_300: 1 } }, price: { gold: 240 }, stock: 1 },
    { id: 'sh8', give: { items: { shield_8h: 1 } }, price: { gold: 150 }, stock: 1 },
    { id: 'pr8', give: { items: { prod_8h: 1 } }, price: { arms: 30000 }, stock: 1 },
    { id: 'xc', give: { res: { cash: 60000 } }, price: { metal: 40000 }, stock: 2 },
    { id: 'xm', give: { res: { metal: 25000 } }, price: { cash: 50000 }, stock: 2 },
    { id: 'hl', give: { items: { heal_500: 2 } }, price: { gold: 80 }, stock: 2 },
    { id: 'md', give: { items: { hero_medal: 10 } }, price: { gold: 100 }, stock: 2 },
    { id: 'mdc', give: { items: { hero_medal: 5 } }, price: { arms: 35000 }, stock: 1 },
    { id: 'at', give: { items: { atk_2h: 1 } }, price: { gold: 110 }, stock: 1 },
];
function hashStr(t) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function smug(u) { const w = Math.floor(Date.now() / SMUG_WIN); if (!u.smug || u.smug.w !== w) u.smug = { w, roll: 0, bought: {} }; return u.smug; }
function smugOffers(u) {
    const S = smug(u), pool = SMUG_POOL.slice(), out = []; let h = hashStr(u.username + ':' + S.w + ':' + S.roll);
    while (out.length < 6 && pool.length) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; out.push(pool.splice(h % pool.length, 1)[0]); }
    return out.map(o => ({ ...o, left: Math.max(0, o.stock - (S.bought[o.id] || 0)) }));
}
function smugInfo(u) { const S = smug(u); return { offers: smugOffers(u), ends: (S.w + 1) * SMUG_WIN, roll: S.roll, reroll: SMUG_REROLL }; }

// ═══════════════════════════════════════════
// HİKÂYE BÖLÜMLERİ (MC "Plot / Gelişim Planı"): her bölümde görevler; hepsi bitince ödül + sonraki bölüm
//   görev türleri: gear (üretilen ekipman), equip (kuşanılan parça), villa, blvl (bina türü en yüksek sv.), trained (toplam eğitilen), troops (toplam asker), ttype (türden asker),
//   tier (açık kademe), boss (bounty saldırısı, id'ye özel olabilir), mine/city (ele geçirilen), invest (araştırma sv. toplamı), clan, heroes, power
// ═══════════════════════════════════════════
const STORY = [
    { id: 1, title: 'Eve Dönüş', tasks: [{ t: 'villa', n: 2 }, { t: 'trained', n: 100 }, { t: 'blvl', k: 'counterfeiter', n: 2 }], reward: { gold: 50, items: { cash_1k: 3, speed_5m: 3, mat_box: 1 } } },
    { id: 2, title: "Leo'nun Defteri", tasks: [{ t: 'villa', n: 3 }, { t: 'mine', n: 1 }, { t: 'invest', n: 1 }, { t: 'gear', n: 1 }], reward: { gold: 80, items: { res_box: 1, vip_10: 3, mat_box: 1 } } },
    { id: 3, title: 'Tefecinin Borcu', tasks: [{ t: 'boss', k: 'bijuu1', n: 1 }, { t: 'blvl', k: 'hospital', n: 3 }, { t: 'villa', n: 4 }, { t: 'thug', n: 3 }], reward: { gold: 120, items: { troops_100: 2, speed_1h: 1, mat_box: 1 } } },
    { id: 4, title: 'Liman', tasks: [{ t: 'villa', n: 5 }, { t: 'ttype', k: 'm', n: 200 }, { t: 'boss', k: 'bijuu2', n: 1 }, { t: 'equip', n: 3 }], reward: { gold: 150, items: { res_box: 1, shield_8h: 1, mat_box: 2 } } },
    { id: 5, title: 'Kara Dul', tasks: [{ t: 'villa', n: 6 }, { t: 'tier', n: 2 }, { t: 'city', n: 1 }], reward: { gold: 200, items: { vip_100: 1, speed_1h: 2, gem_1: 2 } } },
    { id: 6, title: "Baron'un Gölgesi", tasks: [{ t: 'villa', n: 8 }, { t: 'troops', n: 2000 }, { t: 'boss', k: 'bijuu8', n: 1 }], reward: { gold: 300, items: { res_box: 2, troops_500: 1, mat_box: 3, gem_1: 2 } } },
    { id: 7, title: 'Aile Meclisi', tasks: [{ t: 'clan', n: 1 }, { t: 'villa', n: 10 }, { t: 'heroes', n: 2 }], reward: { gold: 400, items: { vip_300: 1, speed_8h: 1 } } },
    { id: 8, title: 'Şehrin Hâkimi', tasks: [{ t: 'villa', n: 15 }, { t: 'city', n: 3 }, { t: 'power', n: 150000 }], reward: { gold: 800, items: { vip_1000: 1, res_box: 3 } } },
    { id: 9, title: 'Kartelin Dönüşü', tasks: [{ t: 'rally', n: 1 }, { t: 'gtier', n: 2 }, { t: 'equip', n: 6 }], reward: { gold: 1000, items: { vip_1000: 1, mat_box: 4, gem_1: 3 } } },
    { id: 10, title: 'Efsane Aile', tasks: [{ t: 'villa', n: 20 }, { t: 'gq', n: 3 }, { t: 'power', n: 400000 }], reward: { gold: 1500, items: { vip_1000: 2, res_box: 5, gem_1: 5 } } },
];
function stat(u, k, n = 1) { u.st = u.st || {}; u.st[k] = (u.st[k] || 0) + n; if (k === 'kills' || k === 'thugs') casStat(u, k, n); }
function maxBLevel(u, kind) { return (u.buildings || []).filter(b => b.kind === kind).reduce((a, b) => Math.max(a, b.level || 1), 0); }
function taskVal(u, q) {
    const st = u.st || {};
    switch (q.t) {
        case 'villa': return (u.base && u.base.level) || 0;
        case 'blvl': return maxBLevel(u, q.k);
        case 'trained': return st.trained || 0;
        case 'troops': syncTroops(u); return u.crew + (u.marches || []).reduce((a, m) => a + mixTotal(m.troops), 0);
        case 'ttype': { let s = 0; const all = mixAdd({}, u.troops); (u.marches || []).forEach(m => mixAdd(all, m.troops)); for (const k in all) if (k[0] === q.k) s += all[k]; return s; }
        case 'tier': return bestTier(u);
        case 'boss': return q.k ? (st['boss_' + q.k] || 0) : (st.boss || 0);
        case 'mine': return st.mines || 0;
        case 'city': return st.cities || 0;
        case 'invest': return Object.values(u.investments || {}).reduce((a, b) => a + b, 0);
        case 'clan': return u.clan ? 1 : 0;
        case 'heroes': return (u.heroes || []).length;
        case 'power': return calculatePlayerPower(u);
        case 'gear': return st.gear || 0;
        case 'equip': return gearWorn(u).length;
        case 'rally': return st.rally || 0;
        case 'thug': return st.thugMax || 0;
        case 'gather': return st.gathered || 0;
        case 'car': return Object.keys(CARS).filter(id => carDone(u, id)).length;
        case 'gtier': return (u.gear && u.gear.inv || []).reduce((a, x) => Math.max(a, x.t + 1), 0);
        case 'gq': return (u.gear && u.gear.inv || []).some(x => x.q >= q.n) ? q.n : 0;
    }
    return 0;
}
function storyInfo(u) {
    const ch = (u.story && u.story.ch) || 1, S = STORY.find(x => x.id === ch);
    if (!S) return { ch, done: true };
    const tasks = S.tasks.map(q => ({ ...q, v: Math.min(q.n, taskVal(u, q)) }));
    return { ch, tasks, ready: tasks.every(q => q.v >= q.n) };
}

// ═══════════════════════════════════════════
// ETKİNLİK MERKEZİ (MC kişisel etkinlikler): 24 saatlik dönüşümlü etkinlik; eylemler puan verir,
//   puan eşiklerinde ödül; bitişte sıralama ödülü (posta). Tür sırası: inşaat → savaş → bounty
// ═══════════════════════════════════════════
const EV_DUR = 24 * 3600e3, EV_EPOCH = Date.UTC(2026, 0, 1) - 3 * 3600e3; // Türkiye gece yarısında döner
const EVENTS = [
    { type: 'build', name: 'Altın Çağı', desc: 'Binalarını yükselt; her inşaat puan verir.', how: ['Bina yükseltmesi bitir: hedef seviye × 60', 'İnşaatı hızlandırma eşyası kullan: 5 dk başı 10'], tiers: [600, 2500, 8000, 20000], art: 'cin5' },
    { type: 'war', name: 'Sokak Savaşı', desc: 'Asker eğit, sefere çık; ordun büyüdükçe puan toplanır.', how: ['Asker eğitimi bitir: asker başı kademe gücü', 'Seferde düşman indir: kayıp başı 3', 'Zafer: 150'], tiers: [1500, 6000, 18000, 45000], art: 'ch4' },
    { type: 'boss', name: 'Bounty Avı', desc: 'Şehirdeki bounty hedeflerine saldır.', how: ['Bounty hasarı: 100 hasar başı 1', 'Bounty indirmek: 2.000'], tiers: [500, 2000, 6000, 15000], art: 'ch3' },
];
const EV_REWARD = [{ gold: 30, items: { speed_5m: 3, cash_1k: 3 } }, { gold: 60, items: { speed_1h: 1, res_box: 1, mat_box: 1, dice: 1 } }, { gold: 120, items: { vip_100: 1, troops_100: 2, gem_1: 1, hero_medal: 10, skin_box: 1 } }, { gold: 250, items: { speed_8h: 1, vip_300: 1, gift_perfume: 1, mat_box: 2, hero_medal: 20 } }];
const EV_RANK = [{ gold: 500, items: { vip_1000: 1, res_box: 3 } }, { gold: 300, items: { vip_300: 1, res_box: 2 } }, { gold: 200, items: { vip_100: 2, res_box: 1 } }]; // 1., 2., 3.; 4–10: 100 altın
function evNow() { const i = Math.floor((Date.now() - EV_EPOCH) / EV_DUR), E = EVENTS[((i % EVENTS.length) + EVENTS.length) % EVENTS.length]; return { idx: i, id: E.type + '_' + i, E, ends: EV_EPOCH + (i + 1) * EV_DUR }; }
function evOf(u) { const c = evNow(); if (!u.ev || u.ev.id !== c.id) u.ev = { id: c.id, pts: 0, claimed: {} }; return u.ev; }
function evPoints(u, type, n) { const c = evNow(); if (c.E.type !== type || !(n > 0)) return; const e = evOf(u); e.pts += Math.floor(n); markDirty('users'); }
function evTop(id, k = 10) { return Object.values(users).filter(u => u.ev && u.ev.id === id && u.ev.pts > 0).sort((a, b) => b.ev.pts - a.ev.pts).slice(0, k).map(u => ({ u: u.username, pts: u.ev.pts, ch: u.character || 'soulreaper' })); }
function evInfo(u) { const c = evNow(), e = evOf(u); return { id: c.id, type: c.E.type, ends: c.ends, pts: e.pts, claimed: e.claimed, rank: evTop(c.id, 999).findIndex(x => x.u === u.username) + 1 }; }
let evLast = null;   // bitmiş etkinliğin sıralama ödülleri (bir kez)
setInterval(() => {
    const c = evNow(); if (evLast === null) { evLast = c.id; return; } if (evLast === c.id) return;
    const prev = evLast; evLast = c.id; const top = evTop(prev, 10);
    top.forEach((x, i) => { const u = users[x.u]; if (!u) return; const R = EV_RANK[i] || { gold: 100, items: {} }; u.gold = (u.gold || 0) + R.gold; giveItems(u, R.items);
        u.inbox = u.inbox || []; u.inbox.unshift({ from: 'Etkinlik', msg: `Etkinlik sıralamasında ${i + 1}. oldun! Ödül: ${R.gold} altın ve eşyalar çantada.`, date: Date.now(), read: false }); markDirty('users'); pushResources(u.username); });
}, 30e3);
// ═══ KLAN YARDIMI (MC el sıkışma): inşaat başlayınca klan üyeleri yardım edebilir; her yardım süreyi kısaltır ═══
const HELP_MAX = 8;
function tfmtS(ms) { const s = Math.round(ms / 1000); return s >= 60 ? Math.round(s / 60) + ' dk' : s + ' sn'; }
function helpCut(rem) { return Math.max(30e3, Math.floor(rem * 0.02)); }
function clanHelps(u) { // u'nun yardım edebileceği istekler
    if (!u.clan || !clans[u.clan]) return [];
    return (clans[u.clan].members || []).filter(n => n !== u.username).map(n => users[n]).filter(t => t && t.build && t.build.end > Date.now() && (t.build.helps || []).length < HELP_MAX && !(t.build.helps || []).includes(u.username))
        .map(t => ({ u: t.username, kind: t.build.kind, to: t.build.to, helps: (t.build.helps || []).length }));
}


// ═══════════════════════════════════════════
// KLAN BASKINI (MC "Rally"): lider hedef + toplanma süresi seçer; üyeler asker gönderir (önce liderin villasına yürür);
//   süre dolunca birleşik ordu hedefe yürür. Savaş liderin saldırı çarpanıyla; kayıp, hasar, malzeme ve deneyim katkıya göre paylaşılır.
//   bounty baskınına %15 birlik bonusu; şehir fethedilirse şehir liderin olur.
// ═══════════════════════════════════════════
const RALLY_WAITS = [60, 180, 300, 600];          // saniye
const RALLY_MIN = Number(process.env.RALLY_MIN_MS) || 60e3; // test için kısaltılabilir
const RALLY_BONUS = 1.15;
function rallyCap(L) { return crimeOps(L) * 3; }
function rallyMarches(R) { const out = []; Object.values(users).forEach(u => (u.marches || []).forEach(m => { if (m.kind === 'rally' && m.rid === R.id) out.push([u, m]); })); return out; }
function rallyTotal(R) { return rallyMarches(R).reduce((a, [, m]) => a + mixTotal(m.troops), 0); }
function rallyPublic(L, viewer) {
    const R = L.rally, ms = rallyMarches(R);
    return { id: R.id, leader: L.username, kind: R.kind, target: R.target, name: R.name, launchAt: R.launchAt, arriveAt: R.arriveAt || 0, state: R.state, cap: rallyCap(L), n: ms.reduce((a, [, m]) => a + mixTotal(m.troops), 0),
        members: ms.map(([u, m]) => ({ u: u.username, n: mixTotal(m.troops), st: m.state, at: m.state === 'join' ? m.t1 : 0, ch: u.character || 'soulreaper' })), mine: !!viewer && ms.some(([u]) => u.username === viewer.username), pos: targetPos(R.kind, R.target), from: L.base ? { x: L.base.x, z: L.base.z } : null };
}
function clanRallies(u) { if (!u || !u.clan || !clans[u.clan]) return []; return (clans[u.clan].members || []).map(n => users[n]).filter(L => L && L.rally).map(L => rallyPublic(L, u)); }
function pushRallies(clanId) { if (!clanId || !clans[clanId]) return; (clans[clanId].members || []).forEach(n => { const u = users[n]; if (u && isOnline(n)) emitTo(n, 'ralliesData', clanRallies(u)); }); }
function marchHome(u, m, at) { // seferi bulunduğu yerden (ya da 'at' noktasından) evine döndür
    const now = Date.now(), home = u.base ? { x: u.base.x, z: u.base.z } : m.from, here = at || m.to || m.from;
    const d = Math.hypot(home.x - here.x, home.z - here.z), dur = Math.round(Math.min(MARCH_MAX, Math.max(4000, d / marchSpeed(m.troops, u) * 1000)));
    m.from = home; m.to = here; m.state = 'back'; m.t0 = now; m.t1 = now + dur; m.dur = dur; // çizim: to → from yönünde döner
}
function marchHere(m) { const now = Date.now(), k = Math.min(1, Math.max(0, (now - m.t0) / Math.max(1, m.t1 - m.t0))); return { x: Math.round(m.from.x + (m.to.x - m.from.x) * k), z: Math.round(m.from.z + (m.to.z - m.from.z) * k) }; }
function rallyDisband(L, why) { // toplanma iptal: herkes evine
    const R = L.rally; if (!R) return; rallyMarches(R).forEach(([u, m]) => { marchHome(u, m, m.state === 'join' ? marchHere(m) : R.at || m.to); emitTo(u.username, 'toast', { type: 'info', msg: `Baskın dağıldı: ${why}` }); pushResources(u.username); });
    L.rally = null; markDirty('users'); pushRallies(L.clan); broadcastMarches();
}
function rallyLaunch(L) {
    const R = L.rally, ms = rallyMarches(R), now = Date.now(), to = targetPos(R.kind, R.target);
    if (R.kind === 'boss') { const b = world.bosses[R.target]; if (!b || b.defeated) return rallyDisband(L, `${R.name} çoktan indirildi`); }
    else if (R.kind === 'ter') { const T = siteGet('ter', R.target); if (!T || terFriendly(T, L)) return rallyDisband(L, `${R.name} artık hedef olamaz`); }
    else if (isSite(R.kind)) { const T = siteGet(R.kind, R.target); if (!T || siteWhyNot(T, L)) return rallyDisband(L, `${R.name} artık hedef olamaz`); }
    else { const c = world.cities[R.target], o = c && c.owner && users[c.owner]; if (!c || c.owner === L.username || (o && sameClan(L, o)) || c.shieldUntil > now) return rallyDisband(L, `${R.name} artık hedef olamaz`); }
    const late = ms.filter(([, m]) => m.state === 'join'); late.forEach(([u, m]) => { marchHome(u, m, marchHere(m)); emitTo(u.username, 'toast', { type: 'info', msg: 'Askerlerin baskına yetişemedi, geri dönüyor.' }); });
    const go = ms.filter(([, m]) => m.state === 'wait'); if (!go.length || !to || !L.base) return rallyDisband(L, 'hedef ya da asker yok');
    const all = {}; go.forEach(([, m]) => mixAdd(all, m.troops)); const from = { x: L.base.x, z: L.base.z };
    const dur = Math.round(Math.min(MARCH_MAX, Math.max(MARCH_MIN, Math.hypot(to.x - from.x, to.z - from.z) / marchSpeed(all, L) * 1000)));
    go.forEach(([u, m]) => { m.state = 'go'; m.from = from; m.to = { x: to.x, z: to.z }; m.t0 = now; m.t1 = now + dur; m.dur = dur; m.hide = u !== L; if (u === L) m.tot = mixTotal(all); });
    R.state = 'march'; R.arriveAt = now + dur; R.at = { x: to.x, z: to.z };
    if (R.kind === 'ter') { const T = (world.ters || {})[R.target]; if (T && clans[T.clan]) { chatSys(T.clan, `⚠ ${L.username} klan baskını ${T.name} yapımıza yürüyor! Varış ${tfmtS(dur)}. Garnizona asker gönderin!`, 'soulreaper'); clans[T.clan].members.forEach(n => emitTo(n, 'toast', { type: 'defeat', msg: `Kuşatma geliyor: ${T.name} (${tfmtS(dur)})` })); } }
    if (R.kind === 'city') { const c = world.cities[R.target]; if (c && c.owner && users[c.owner]) emitTo(c.owner, 'incoming', { from: L.username + ' (baskın)', at: R.arriveAt, n: mixTotal(all) }); }
    go.forEach(([u]) => { emitTo(u.username, 'toast', { type: 'info', msg: `Baskın yola çıktı: ${R.name} (${tfmtS(dur)})` }); pushResources(u.username); });
    markDirty('users'); pushRallies(L.clan); broadcastMarches();
}
// katkıya göre kayıp dağıt: her katılımcı kendi birliklerinden, birleşik kayıpla orantılı kaybeder
function shareLoss(parts, all, lost) {
    parts.forEach(([u, m]) => { const l = {}; for (const k in lost) { if (!m.troops[k] || !all[k]) continue; const q = Math.min(m.troops[k], Math.round(lost[k] * m.troops[k] / all[k])); if (q > 0) l[k] = q; } mixAdd(m.troops, l, -1); sendToHospital(u, l); m.lost = mixTotal(l); });
}
function rallyResolve(L) {
    const R = L.rally, parts = rallyMarches(R).filter(([, m]) => m.state === 'go'); L.rally = null;
    if (!parts.length) { pushRallies(L.clan); return; }
    const all = {}; parts.forEach(([, m]) => mixAdd(all, m.troops)); const pw = troopPower(all) || 1, share = {}; parts.forEach(([u, m]) => share[u.username] = troopPower(m.troops) / pw);
    let msg = '', win = false;
    if (R.kind === 'boss') {
        const boss = world.bosses[R.target];
        if (!boss || boss.defeated) msg = `${R.name} çoktan indirilmiş.`;
        else {
            const dmg = Math.floor(sidePower(all, { n: 1 }, attackMult(L), false, heroTM(L)) * 1.4 * RALLY_BONUS * (0.9 + Math.random() * 0.2));
            shareLoss(parts, all, mixLoss(all, mixTotal(all) * 0.25));
            boss.currentHp = Math.max(0, boss.currentHp - dmg); boss.attackers = boss.attackers || {};
            parts.forEach(([u, m]) => { const d = Math.floor(dmg * share[u.username]); boss.attackers[u.username] = (boss.attackers[u.username] || 0) + d; stat(u, 'boss'); stat(u, 'boss_' + boss.id); questProgress(u, 'boss');
                m.mats = randMats(2 + Math.round(boss.reward / 25000), 0.08); addXP(u, 40 + d / 300, true); evPoints(u, 'boss', d / 100); stat(u, 'rally'); });
            win = boss.currentHp <= 0; if (win) bossDown(boss); else io.emit('toast', { type: 'info', msg: `${L.username} baskını ${boss.beast}'a ${dmg.toLocaleString('tr-TR')} hasar verdi!` });
            msg = `${R.name}: ${dmg.toLocaleString('tr-TR')} hasar${win ? ' — HEDEF İNDİ!' : ''}`;
            markDirty('world'); io.emit('battleAnimation', { cityId: boss.id, characterId: L.character, attackerColor: L.empireColor, result: { attackerWins: win, atkPower: dmg } }); broadcastWorld();
        }
    } else if (R.kind === 'ter') { const o = terRallyResolve(L, R, parts, all, share); msg = o.msg; win = o.win;
    } else if (isSite(R.kind)) { const o = hallRallyResolve(L, R, parts, all, share); msg = o.msg; win = o.win;
    } else if (R.kind === 'city') {
        const city = world.cities[R.target], owner = city && city.owner && users[city.owner];
        if (!city || city.owner === L.username || (owner && sameClan(L, owner)) || city.shieldUntil > Date.now()) msg = `${R.name}: hedef değişti.`;
        else {
            city.defMix = city.defMix || {}; const def = mixAdd({ n: city.garrison || 0 }, city.defMix); if (!def.n) delete def.n;
            const r = battle(all, attackMult(L) * 1.05, def, (1 + (city.bonus?.defense || 0)) * (owner ? defenseMult(owner) : 1), heroTM(L), owner ? heroTM(owner) : null);
            shareLoss(parts, all, r.aLost);
            city.garrison = Math.max(0, (city.garrison || 0) - (r.dLost.n || 0)); const pl = { ...r.dLost }; delete pl.n; mixAdd(city.defMix, pl, -1); if (owner && mixTotal(pl)) sendToHospital(owner, pl);
            win = r.attackerWins;
            if (win) {
                if (owner) { giveTroops(owner, city.defMix); emitTo(owner.username, 'toast', { type: 'defeat', msg: `${city.name} şehrini ${L.username} klan baskınıyla aldı!` }); marchReport(owner, 'Savaş Raporu', `${city.name} şehrini ${L.username} klan baskınıyla ele geçirdi.`); pushResources(owner.username); }
                city.owner = L.username; city.ownerClan = L.clan; city.empireColor = L.empireColor; city.defMix = {}; city.defenders = 0; city.garrison = 0; city.shieldUntil = Date.now() + SHIELD_DURATION; stat(L, 'cities');
            } else city.defenders = mixTotal(city.defMix);
            parts.forEach(([u, m]) => { m.mats = randMats(Math.round((win ? 8 : 3) + 10 * share[u.username]), win && city.type === 'capital' ? 0.4 : 0.1); addXP(u, (win ? 80 : 25) + (r.defenderLosses || 0) * share[u.username] / 8, true); evPoints(u, 'war', (r.defenderLosses || 0) * 3 * share[u.username] + (win ? 150 : 0)); stat(u, 'rally'); stat(u, 'kills', Math.round((r.defenderLosses || 0) * share[u.username])); questProgress(u, 'attack'); });
            msg = `${R.name}: ${win ? 'ZAFER — şehir ' + L.username + ' ailesinin!' : 'savunma kırılamadı'} (düşman kaybı ${r.defenderLosses})`;
            markDirty('world'); io.emit('battleAnimation', { cityId: city.id, characterId: L.character, attackerColor: L.empireColor, result: r }); broadcastWorld();
        }
    }
    parts.forEach(([u, m]) => { marchReport(u, 'Baskın Raporu', `${msg}. Payın %${Math.round(share[u.username] * 100)}, kayıp ${m.lost || 0}, dönen ${mixTotal(m.troops)} asker.${m.mats ? ' Malzeme: ' + matText(m.mats) + '.' : ''}`);
        emitTo(u.username, 'toast', { type: win ? 'victory' : 'info', msg: 'Baskın: ' + msg }); m.hide = false; m.tot = 0;
        if (!mixTotal(m.troops)) { if (m.mats) giveMats(u, m.mats); u.marches = u.marches.filter(x => x !== m); } else if (m.state !== 'station') marchHome(u, m, R.at); pushResources(u.username); });
    markDirty('users'); pushRallies(L.clan); broadcastMarches();
}
function bossDown(boss) { // bounty indi: en çok hasar veren %60, kalanı diğerlerine; en iyiye altın + sandık + pırlanta
    boss.defeated = true; boss.respawnAt = Date.now() + BOSS_RESPAWN;
    const sorted = Object.entries(boss.attackers || {}).sort((a, b) => b[1] - a[1]); if (!sorted.length) return;
    sorted.forEach(([un], i) => {
        const share = sorted.length === 1 ? 1 : (i === 0 ? 0.6 : 0.4 / (sorted.length - 1));
        const cash = Math.floor(boss.reward * share), metal = Math.floor(boss.reward * share / 4), t = users[un]; if (!t) return;
        t.cash += cash; t.metal += metal; if (i === 0) { t.gold = (t.gold || 0) + 50; giveItems(t, { res_box: 1 }); giveMats(t, { gem: 1 + Math.floor(boss.reward / 100000) }); giveItems(t, { hero_medal: 5 }); } else if (Math.random() < 0.5) giveMats(t, { gem: 1 });
        emitTo(un, 'toast', { type: 'victory', msg: `${boss.beast} yenildi! Ödül: ${cash.toLocaleString('tr-TR')} Cash + ${metal.toLocaleString('tr-TR')} Metal` }); pushResources(un);
    });
    io.emit('toast', { type: 'info', msg: `${boss.beast}, ${sorted[0][0]} tarafından indirildi!` });
}

// toplama bitti ya da geri çağrıldı: toplanan kadarı ganimet olur, nokta azalır; biterse yerine yenisi çıkar
function gatherEnd(u, m, early) {
    const t = (world.res || {})[m.target], now = Date.now(), k = Math.min(1, Math.max(0, (now - m.t0) / Math.max(1, m.t1 - m.t0))), got = Math.floor((m.gwant || 0) * (early ? k : 1));
    if (t) { t.left = Math.max(0, t.left - got); t.by = null; if (t.left <= 0) { delete world.res[t.id]; spawnRes(); } }
    m.loot = { cash: 0, cargo: 0, arms: 0, metal: 0 }; m.loot[m.gt || 'cash'] = got; stat(u, 'gathered', got); questProgress(u, 'attack'); evPoints(u, 'build', got / 400);
    addXP(u, 10 + got / 2000, true); m.dur = m.dur0 || m.dur || 30e3; m.state = 'back'; m.t0 = now; m.t1 = now + m.dur;
    markDirty('world'); markDirty('users'); broadcastWorld();
    emitTo(u.username, 'toast', { type: 'success', msg: `${m.name}: ${got.toLocaleString('tr-TR')} toplandı, eve dönülüyor.` });
}

// ═══════════════════════════════════════════
// BELEDİYE SARAYI & BAŞKANLIK (MC "Mayor"): saray + 4 kale; savaşta tutulur, barışta başkan unvan dağıtır, kara parayla beceri kullanır
// ═══════════════════════════════════════════
const HALL_POS = { x: 300, z: 450 };
const HALL_HOLD_MS = Number(process.env.HALL_HOLD_MS) || 2 * 3600e3;     // kesintisiz tutma → zafer
const HALL_TERM_MS = Number(process.env.HALL_TERM_MS) || 3 * 86400e3;    // barış (başkanlık) dönemi
const HALL_WAR_MAX = 24 * 3600e3;                                        // savaş bu kadar sürdüyse o an tutan kazanır
const TITLE_CD = 3 * 60e3, DIRTY_MIN = 120, DIRTY_MAX = 1e6, DIRTY_START = Number(process.env.HALL_DIRTY0) || 30000; // kara para: dakikada / tavan / seçimde başlangıç
const hallNpcMax = t => Math.min(20000, 8000 + 2000 * (t || 0)), fortNpcMax = t => Math.min(6000, 2500 + 500 * (t || 0));
const FORTS = [ // ekranda üst / alt / sağ / sol (izometrik köşegenler)
    { id: 'fort_n', name: 'Kuzey Kalesi', dx: -450, dz: -450 }, { id: 'fort_s', name: 'Güney Kalesi', dx: 450, dz: 450 },
    { id: 'fort_e', name: 'Doğu Kalesi', dx: 450, dz: -450 }, { id: 'fort_w', name: 'Batı Kalesi', dx: -450, dz: 450 }];
const TITLES = {
    mayor:     { name: 'Belediye Başkanı', off: 1, fx: { atk: 0.15, def: 0.15, ops: 500 } },
    secretary: { name: 'Sekreter',         off: 1, fx: { prod: 0.15, vault: 0.20 } },
    chief:     { name: 'Başkan Yardımcısı', off: 1, fx: { build: 0.05, trainSp: 0.05, speed: 0.05 } },
    justice:   { name: 'Adalet Bakanı',    off: 1, fx: { prod: 0.10, trainSp: 0.05 } },
    premier:   { name: 'Hazine Bakanı',    off: 1, fx: { prod: 0.10, heal: 0.10 } },
    inspector: { name: 'Başmüfettiş',      off: 1, fx: { atk: 0.05, speed: 0.10 } },
    commander: { name: 'Komutan',          off: 1, fx: { atk: 0.05, def: 0.05 } },
    investor:  { name: 'Yatırım Müdürü',   off: 1, fx: { load: 0.15, plunder: 0.05 } },
    engineer:  { name: 'Baş Mühendis',     off: 1, fx: { build: 0.10 } },
    henchman:  { name: 'Uşak',             off: 0, fx: { atk: -0.10, prod: -0.05 } },
    jester:    { name: 'Soytarı',          off: 0, fx: { prod: -0.05, heal: -0.10 } },
    civilian:  { name: 'Ayak İşçisi',      off: 0, fx: { speed: -0.05, trainSp: -0.10 } },
    rogue:     { name: 'Serseri',          off: 0, fx: { def: -0.05, prod: -0.10 } },
    crook:     { name: 'Dolandırıcı',      off: 0, fx: { atk: -0.08, def: -0.08 } },
    burglar:   { name: 'Hırsız',           off: 0, fx: { vault: -0.20 } },
    felon:     { name: 'Kaçak',            off: 0, fx: { speed: -0.15 } },
    fool:      { name: 'Budala',           off: 0, fx: { build: -0.15 } },
};
const HALL_SKILLS = { // who: kullanabilecek unvanlar · cost: kara para · cd/dur: ms · uses: dönem başına
    recup:    { name: 'Bereket',          desc: 'Herkesin kaynak üretimi +%10 (24 saat)',      fx: { prod: 0.10 },   dur: 24 * 3600e3, cost: 25000, cd: 0,          who: ['mayor', 'chief'] },
    mobil:    { name: 'Seferberlik',      desc: 'Herkesin eğitim hızı +%10 (24 saat)',         fx: { trainSp: 0.10 }, dur: 24 * 3600e3, cost: 25000, cd: 0,         who: ['mayor', 'chief'] },
    build:    { name: 'İnşaat Hamlesi',   desc: 'Herkesin inşaat hızı +%5 (24 saat)',          fx: { build: 0.05 },  dur: 24 * 3600e3, cost: 25000, cd: 0,          who: ['mayor', 'chief', 'engineer'] },
    treat:    { name: 'Acil Tedavi',      desc: 'Herkesin tedavi ücreti -%50 (1 saat)',        fx: { heal: 0.5 },    dur: 3600e3,      cost: 50000, cd: 24 * 3600e3, who: ['mayor'] },
    embezzle: { name: 'Örtülü Ödenek',    desc: 'Kara parayı 300 altına çevir (maliyet her kullanımda artar)', gold: 300, cost: 10000, step: 10000, cd: 12 * 3600e3, uses: 3, who: ['mayor', 'premier'] },
    gift:     { name: 'Başkanın Hediyesi', desc: 'Şehir sohbetine 20 kişilik hediye sandığı bırak (25 altın + eşya)', cost: 20000, cd: 3600e3, uses: 3, who: ['mayor', 'premier'] },
    truce:    { name: 'Genel Ateşkes',    desc: 'Bütün patronlara 4 saat kalkan',              cost: 200000, cd: 24 * 3600e3, who: ['mayor', 'secretary'] },
    asylum:   { name: 'Sığınak',          desc: 'Seçilen patrona 8 saat kalkan',  target: 1, cost: 50000, cd: 8 * 3600e3, who: ['mayor', 'secretary'] },
    order:    { name: 'Ateşkes Emri',     desc: 'Seçilen patron 1 saat saldırı seferi çıkaramaz', target: 1, cost: 50000, cd: 12 * 3600e3, who: ['mayor', 'commander', 'inspector'] },
    demolish: { name: 'Yıkım Emri',       desc: 'Seçilen patronun villası haritada rastgele bir yere taşınır', target: 1, cost: 200000, cd: 24 * 3600e3, who: ['mayor', 'justice'] },
};
const HALL_PACKS = {
    immortal: { name: 'Ölümsüzlük Paketi',     n: 5,  items: { shield_8h: 1, heal_500: 2 } },
    defender: { name: 'Klan Savunucusu Paketi', n: 10, items: { troops_100: 2, speed_1h: 1 } },
    brother:  { name: 'Kardeşlik Paketi',       n: 20, items: { res_box: 1, cash_1k: 3 } },
};
const GIFT_POOL = [{ speed_5m: 3 }, { cash_1k: 2 }, { hero_medal: 2 }, { mat_box: 1 }, { speed_1h: 1 }, { skin_box: 1 }];
function hallB(u, k) { const H = world.hall; if (!H) return 0; let v = 0; const t = H.titles && H.titles[u.username], T = t && TITLES[t]; if (T && T.fx[k]) v += T.fx[k]; const b = H.buffs && H.buffs[k]; if (b && b.until > Date.now()) v += b.v; return v; }
function siteGet(kind, id) { return kind === 'hall' ? world.hall : kind === 'fort' ? (world.forts || {})[id] : kind === 'light' ? (world.lights || {})[id] : kind === 'ter' ? (world.ters || {})[id] : kind === 'casino' ? world.casino || null : null; }
const isSite = k => k === 'hall' || k === 'fort' || k === 'light' || k === 'casino';
function siteAll() { return [world.hall].concat(Object.values(world.forts || {})).filter(Boolean); }
function stationed(id) { const out = []; Object.values(users).forEach(u => (u.marches || []).forEach(m => { if (m.state === 'station' && m.target === id) out.push([u, m]); })); return out; }
function siteFriendly(T, u) { return !!T.holder && (T.holder === u.username || (!!u.clan && T.clan === u.clan)); }
function siteCap(T) { const H = T.holder && users[T.holder]; return Math.max(T.kind === 'hall' ? 6000 : T.kind === 'casino' ? 8000 : T.kind === 'light' ? 5000 : 3000, H ? crimeOps(H) * (T.kind === 'hall' || T.kind === 'casino' ? 4 : T.kind === 'light' ? 3 : 2) : 0); }
function siteWhyNot(T, u) {
    if (T && T.kind === 'casino') return !casNow().active ? 'Grand Kumarhane kapalı: Kumarhane Savaşı hafta sonu başlar.' : siteFriendly(T, u) ? 'Kumarhane zaten senin ya da klanının elinde.' : null;
    if (T && T.kind === 'light') return siteFriendly(T, u) ? 'Bu fener zaten senin ya da klanının elinde.' : null;
    const H = world.hall; if (!H || H.phase !== 'war') return `Belediye barış döneminde. Başkanlık savaşı ${Math.max(1, Math.ceil((((H && H.phaseEnd) || 0) - Date.now()) / 3600e3))} saat sonra başlar.`;
    if (siteFriendly(T, u)) return 'Burası zaten senin ya da klanının elinde.'; return null;
}
function siteSync(T) { // garnizon özeti + boşalırsa sahipsiz kalır; sahip ayrıldıysa klandan biri devralır
    const st = stationed(T.id); T.gn = st.reduce((a, [, m]) => a + mixTotal(m.troops), 0); T.gl = st.map(([u, m]) => ({ u: u.username, n: mixTotal(m.troops) }));
    if (!st.length) { if (T.holder) { T.holder = null; T.clan = null; T.color = null; T.since = 0; } }
    else if (!st.some(([u]) => u.username === T.holder)) { const [nu] = st[0]; T.holder = nu.username; T.color = nu.empireColor || null; }
}
function chatWorld(text, extra) { const m = Object.assign({ from: 'Belediye', ch: 'soulreaper', vip: 0, clan: null, msg: text, t: Date.now(), sys: true }, extra || {}); chat.world.push(m); if (chat.world.length > CHAT_MAX) chat.world.shift(); io.emit('chatMsg', Object.assign({ chan: 'world' }, m)); }
function siteFight(T, all, mult, tm) { // savaş: NPC + garnizon; savunan kayıplar garnizon seferlerine paylaşılır (hastaneye)
    const st = stationed(T.id), def = {}; st.forEach(([, m]) => mixAdd(def, m.troops)); const pall = { ...def }; if ((T.npc || 0) > 0) def.n = T.npc;
    const O = T.holder && users[T.holder];
    const r = battle(all, mult, def, (T.kind === 'hall' ? 1.2 : 1.1) * (O ? defenseMult(O) : 1), tm, O ? heroTM(O) : null);
    T.npc = Math.max(0, (T.npc || 0) - (r.dLost.n || 0)); const pl = { ...r.dLost }; delete pl.n; if (mixTotal(pl) && st.length) shareLoss(st, pall, pl);
    return r;
}
function siteTake(T, L, parts) { // saldıran kazandı: eski garnizon eve, yeni garnizon yerleşir (T.since: kesintisiz tutma başlangıcı)
    const now = Date.now();
    stationed(T.id).forEach(([o, m]) => { marchHome(o, m, { x: T.x, z: T.z }); emitTo(o.username, 'toast', { type: 'defeat', msg: `${T.name} düştü! Kalan askerlerin geri dönüyor.` }); marchReport(o, 'Savaş Raporu', `${T.name}, ${L.username} tarafından ele geçirildi. Kalan askerlerin eve dönüyor.`); pushResources(o.username); });
    const prevClan = T.clan; T.npc = 0; T.holder = L.username; T.clan = L.clan || null; T.color = L.empireColor || null; T.since = now;
    if (T.kind === 'light') parts.forEach(([u]) => stat(u, 'lights'));
    parts.forEach(([u, m]) => { if (!mixTotal(m.troops)) return; m.state = 'station'; m.kind = T.kind; m.target = T.id; m.name = T.name; m.t0 = now; m.t1 = now; m.to = { x: T.x, z: T.z }; m.hide = false; m.tot = 0; delete m.rid; delete m.rl; });
    siteSync(T); const who = L.clan && clans[L.clan] ? `[${clans[L.clan].name}] ${L.username}` : L.username;
    if (T.kind === 'hall') { io.emit('toast', { type: 'info', msg: `${who} Belediye Sarayı'nı ele geçirdi!` }); chatWorld(`${who} Belediye Sarayı'nı ele geçirdi! ${Math.round(HALL_HOLD_MS / 60000)} dakika tutarsa ailesi başkanlığı kazanır.`); }
    else if (T.kind === 'casino') { chatWorld(`${who} Grand Kumarhane'yi ele geçirdi! Klanı artık ×2 öldürme puanı alıyor.`); if (T.clan) chatSys(T.clan, 'Grand Kumarhane bizim! Garnizondaki askerler dakikada fiş ve puan kazandırır.', L.character); }
    else if (T.kind === 'light') { chatWorld(`${who} ${T.name}'ni (Sv. ${T.lvl || 1}) ele geçirdi!`); if (T.clan) chatSys(T.clan, `${T.name} artık klanımızın! Nöbetteki askerler feneri onarır.`, L.character); }
    else if (prevClan !== T.clan || !prevClan) chatWorld(`${who} ${T.name}'ni ele geçirdi.`);
}
function hallArrive(u, m) { // tek sefer saraya / kaleye vardı
    const T = siteGet(m.kind, m.target), H = world.hall;
    if (!T || (T.kind === 'casino' ? !casNow().active : T.kind !== 'light' && (!H || H.phase !== 'war'))) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name}: ${T && T.kind === 'casino' ? 'kumarhane kapandı' : 'belediye barış döneminde'}, sefer geri dönüyor.` }); return marchBack(m); }
    if (siteFriendly(T, u)) { // takviye
        if ((T.gn || 0) + mixTotal(m.troops) > siteCap(T)) { emitTo(u.username, 'toast', { type: 'info', msg: `${T.name} garnizonu dolu (${siteCap(T)}), sefer geri dönüyor.` }); return marchBack(m); }
        const now = Date.now(); m.state = 'station'; m.t0 = now; m.t1 = now; siteSync(T); markDirty('world'); broadcastWorld();
        emitTo(u.username, 'toast', { type: 'success', msg: `${mixTotal(m.troops)} asker ${T.name} garnizonuna katıldı.` }); return;
    }
    if (!T.holder && !(T.npc > 0)) { siteTake(T, u, [[u, m]]); markDirty('world'); broadcastWorld(); emitTo(u.username, 'toast', { type: 'victory', msg: `${T.name} boştu, yerleştin!` }); return; }
    const r = siteFight(T, m.troops, attackMult(u), heroTM(u));
    mixAdd(m.troops, r.aLost, -1); const hosp = sendToHospital(u, r.aLost); m.result = r; stat(u, 'kills', r.defenderLosses || 0);
    addXP(u, (r.attackerWins ? 70 : 20) + (r.defenderLosses || 0) / 8, true); evPoints(u, 'war', (r.defenderLosses || 0) * 3 + (r.attackerWins ? 150 : 0)); questProgress(u, 'attack');
    if (r.attackerWins) { m.mats = randMats(4 + Math.round((r.defenderLosses || 0) / 500), T.kind === 'hall' ? 0.3 : 0.12); siteTake(T, u, [[u, m]]); emitTo(u.username, 'toast', { type: 'victory', msg: `${T.name} ele geçirildi! Askerlerin garnizonda. (Kayıp: ${r.attackerLosses})` }); }
    else { emitTo(u.username, 'toast', { type: 'defeat', msg: `${T.name} savunması kırılamadı! (Kayıp: ${r.attackerLosses}, hastane: ${hosp.admitted})` }); marchBack(m); }
    marchReport(u, 'Savaş Raporu', `${T.name}: ${r.attackerWins ? 'Zafer — askerlerin garnizonda' : 'Yenilgi'} — kayıp ${r.attackerLosses || 0}, düşman kaybı ${r.defenderLosses || 0}, ${r.attackerWins ? 'garnizonda' : 'dönen'} ${mixTotal(m.troops)} asker.`);
    siteSync(T); markDirty('world'); io.emit('battleAnimation', { cityId: T.id, characterId: u.character, attackerColor: u.empireColor, result: r }); broadcastWorld();
}
function hallRallyResolve(L, R, parts, all, share) {
    const T = siteGet(R.kind, R.target), why = T ? siteWhyNot(T, L) : 'hedef yok';
    if (why) return { msg: `${R.name}: ${why}`, win: false };
    const r = siteFight(T, all, attackMult(L) * 1.05, heroTM(L)); shareLoss(parts, all, r.aLost); const win = r.attackerWins;
    parts.forEach(([u, m]) => { m.mats = randMats(Math.round((win ? 6 : 2) + 8 * share[u.username]), 0.2); addXP(u, (win ? 90 : 30) + (r.defenderLosses || 0) * share[u.username] / 8, true); evPoints(u, 'war', (r.defenderLosses || 0) * 3 * share[u.username] + (win ? 200 : 0)); stat(u, 'rally'); stat(u, 'kills', Math.round((r.defenderLosses || 0) * share[u.username])); questProgress(u, 'attack'); });
    if (win) siteTake(T, L, parts); siteSync(T);
    markDirty('world'); io.emit('battleAnimation', { cityId: T.id, characterId: L.character, attackerColor: L.empireColor, result: r }); broadcastWorld();
    return { msg: `${R.name}: ${win ? 'ZAFER — askerler garnizonda!' : 'savunma kırılamadı'} (düşman kaybı ${r.defenderLosses})`, win };
}
function siteLeave(u, m) { const T = siteGet(m.kind, m.target); marchHome(u, m, m.to); if (T) (T.kind === 'ter' ? terSync(T) : siteSync(T)); markDirty('world'); markDirty('users'); broadcastWorld(); }
function hallElect() { // savaş bitti: tutan klanın lideri başkan; garnizonlar eve; barış başlar
    const H = world.hall, now = Date.now(), L = users[H.holder]; if (!L) return;
    const C = L.clan && clans[L.clan], mayor = C && users[C.leader] ? C.leader : L.username, M = users[mayor];
    siteAll().forEach(T => { stationed(T.id).forEach(([o, m]) => { marchHome(o, m, { x: T.x, z: T.z }); pushResources(o.username); }); T.holder = null; T.clan = null; T.color = null; T.since = 0; T.gn = 0; T.gl = []; });
    H.term = (H.term || 0) + 1; H.phase = 'peace'; H.phaseEnd = now + HALL_TERM_MS; H.mayor = mayor; H.mayorClan = L.clan || null; H.mayorSince = now; H.handed = false;
    H.titles = { [mayor]: 'mayor' }; H.tcd = {}; H.cds = {}; H.uses = {}; H.packGot = {}; H.dirty = Math.max(H.dirty || 0, DIRTY_START);
    H.packs = {}; Object.keys(HALL_PACKS).forEach(k => H.packs[k] = HALL_PACKS[k].n);
    H.npc = hallNpcMax(H.term); H.max = H.npc; Object.values(world.forts || {}).forEach(F => { F.npc = fortNpcMax(H.term); F.max = F.npc; });
    const team = C ? (C.members || []).map(n => users[n]).filter(Boolean) : [L];
    team.forEach(t => { t.gold = (t.gold || 0) + 50; giveItems(t, { res_box: 1 }); marchReport(t, 'Belediye', `Ailen Belediye Sarayı'nı ${Math.round(HALL_HOLD_MS / 60000)} dakika tuttu ve seçimi kazandı! Başkan: ${mayor}. Ödül: 50 altın + kaynak sandığı.`); pushResources(t.username); });
    if (M) { M.gold = (M.gold || 0) + 150; giveItems(M, { hero_medal: 20 }); pushResources(mayor); }
    io.emit('toast', { type: 'victory', msg: `${mayor} Belediye Başkanı seçildi!` });
    chatWorld(`Seçim bitti: ${C ? '[' + C.name + '] ailesi' : L.username} kazandı. Yeni Belediye Başkanı ${mayor}! Unvanlar ve şehir becerileri başkanın elinde.`);
    Object.values(users).forEach(t => { if (t.base && !team.includes(t)) marchReport(t, 'Belediye', `${mayor} Belediye Başkanı seçildi. Unvan dağıtımı ve şehir becerileri için Belediye Sarayı'na bak.`); });
    markDirty('world'); markDirty('users'); broadcastWorld(); broadcastMarches();
}
function hallWar() { // barış bitti: yeni başkanlık savaşı (eski başkan ve unvanlar seçime kadar kalır)
    const H = world.hall; H.phase = 'war'; H.warSince = Date.now(); H.since = 0; H.phaseEnd = 0; H.max = hallNpcMax(H.term); H.npc = H.max;
    Object.values(world.forts || {}).forEach(F => { F.max = fortNpcMax(H.term); F.npc = F.max; F.holder = null; F.clan = null; F.color = null; F.since = 0; });
    io.emit('toast', { type: 'info', msg: 'Başkanlık savaşı başladı! Belediye Sarayı ele geçirilebilir.' });
    chatWorld(`Başkanlık savaşı başladı! Sarayı ${Math.round(HALL_HOLD_MS / 60000)} dakika kesintisiz tutan aile başkanlığı kazanır. Kaleler saray garnizonunu eritir.`);
    markDirty('world'); broadcastWorld();
}
function hallCheck() { // her saniye
    const H = world.hall; if (!H) return false; const now = Date.now();
    if (H.phase === 'war' && H.holder && (now - (H.since || now) >= HALL_HOLD_MS || now - (H.warSince || now) >= HALL_WAR_MAX)) { hallElect(); return true; }
    if (H.phase === 'peace' && now >= (H.phaseEnd || 0)) { hallWar(); return true; }
    return false;
}
function hallMinute() { // her dakika: kara para, NPC toparlanması, kale bombardımanı, süresi dolan güçlendirme / hediye
    const H = world.hall; if (!H) return false; const now = Date.now(); let ch = false;
    if (H.mayor) { H.dirty = Math.min(DIRTY_MAX, (H.dirty || 0) + DIRTY_MIN); ch = true; }
    siteAll().forEach(T => { if (H.phase === 'war' && !T.holder && (T.npc || 0) < (T.max || 0)) { T.npc = Math.min(T.max, (T.npc || 0) + Math.ceil(T.max * 0.02)); ch = true; } });
    if (H.phase === 'war' && H.holder) {
        let hit = 0;
        Object.values(world.forts || {}).forEach(F => { if (!F.holder || (F.clan && F.clan === H.clan) || F.holder === H.holder) return;
            const st = stationed('hall'), all = {}; st.forEach(([, m]) => mixAdd(all, m.troops)); const tot = mixTotal(all); if (!tot) return;
            const lost = mixLoss(all, Math.max(15, Math.round(tot * 0.01))); shareLoss(st, all, lost); hit += mixTotal(lost);
            st.forEach(([u, m]) => { if (!mixTotal(m.troops)) u.marches = u.marches.filter(x => x !== m); }); });
        if (hit) { siteSync(H); ch = true; markDirty('users'); if (now - (H.lastHit || 0) > 10 * 60e3) { H.lastHit = now; emitTo(H.holder, 'toast', { type: 'defeat', msg: `Düşman kaleleri saray garnizonunu bombalıyor! (-${hit} asker)` }); } }
    }
    Object.keys(H.buffs || {}).forEach(k => { if (H.buffs[k].until <= now) { delete H.buffs[k]; ch = true; } });
    if ((H.gifts || []).length) { const n0 = H.gifts.length; H.gifts = H.gifts.filter(g => g.left > 0 && g.until > now); if (H.gifts.length !== n0) ch = true; }
    return ch;
}
function nearHall(x, z, pad) { pad = pad || 0; if (world.casino && Math.hypot(x - world.casino.x, z - world.casino.z) < 260 + pad) return true; if (Object.values(world.lights || {}).some(f => Math.hypot(x - f.x, z - f.z) < 200 + pad)) return true; const H = world.hall; if (!H) return false; if (Math.hypot(x - H.x, z - H.z) < 330 + pad) return true; return Object.values(world.forts || {}).some(f => Math.hypot(x - f.x, z - f.z) < 200 + pad); }
function freeBaseSpot(u) { for (let k = 0; k < 3000; k++) { const a = Math.random() * 6.283, r = 500 + Math.random() * 3800; const x = Math.round(Math.cos(a) * r / 20) * 20, z = Math.round(Math.sin(a) * r / 20) * 20; if (spotFree(u, x, z)) return { x, z }; } return null; }
function initHall() {
    const H = world.hall = world.hall && typeof world.hall === 'object' ? world.hall : {};
    Object.assign(H, { id: 'hall', kind: 'hall', name: 'Belediye Sarayı', x: HALL_POS.x, z: HALL_POS.z });
    if (!H.phase) { H.phase = 'war'; H.term = 0; H.since = 0; H.warSince = Date.now(); H.max = hallNpcMax(0); H.npc = H.max; }
    if (H.phase === 'war' && !H.warSince) H.warSince = Date.now();
    ['titles', 'buffs', 'cds', 'uses', 'packs', 'packGot', 'tcd'].forEach(k => { if (!H[k] || typeof H[k] !== 'object') H[k] = {}; }); H.gifts = Array.isArray(H.gifts) ? H.gifts : []; H.log = Array.isArray(H.log) ? H.log : []; H.dirty = H.dirty || 0;
    world.forts = world.forts && typeof world.forts === 'object' ? world.forts : {};
    FORTS.forEach(f => { const F = world.forts[f.id] = world.forts[f.id] || { npc: fortNpcMax(H.term), holder: null }; Object.assign(F, { id: f.id, kind: 'fort', name: f.name, x: HALL_POS.x + f.dx, z: HALL_POS.z + f.dz, max: fortNpcMax(H.term) }); });
    WPOS.hall = { x: H.x, z: H.z }; FORTS.forEach(f => WPOS[f.id] = { x: world.forts[f.id].x, z: world.forts[f.id].z });
    Object.values(world.thugs || {}).forEach(t => { if (nearHall(t.x, t.z, 90)) delete world.thugs[t.id]; });
    Object.values(world.res || {}).forEach(t => { if (!t.by && nearHall(t.x, t.z, 90)) delete world.res[t.id]; });
    ensureThugs(); ensureRes();
    Object.values(users).forEach(u => { if (!u.base || !nearHall(u.base.x, u.base.z, 40) || (u.marches || []).length) return; const q = freeBaseSpot(u); if (!q) return; moveBase(u, q.x, q.z);
        marchReport(u, 'Belediye', 'Villan Belediye Sarayı bölgesinde kaldığı için ücretsiz olarak yeni bir yere taşındı.'); });
    siteAll().forEach(siteSync); markDirty('world'); markDirty('users');
}
function hallCat() { return { titles: TITLES, skills: HALL_SKILLS, packs: HALL_PACKS, hold: HALL_HOLD_MS, term: HALL_TERM_MS, titleCd: TITLE_CD }; }
function skillCost(H, id) { const K = HALL_SKILLS[id]; return K.cost + (K.step || 0) * ((H.uses || {})[id] || 0); }

// ═══ KLAN TEKNOLOJİSİ (MC "Clan Tech"): üyeler kaynak bağışlar → teknoloji seviyesi bütün üyelere etki eder; bağış klan puanı kazandırır (Klan Dükkânı) ═══
const CTECH = {
    prod:    { name: 'Ortak Kasa',        key: 'prod',    per: 0.01,  res: 'cash',  ic: 'r_cash' },
    build:   { name: 'Müteahhit Ağı',     key: 'build',   per: 0.01,  res: 'cargo', ic: 'hammer_g' },
    trainSp: { name: 'Talimgâh',          key: 'trainSp', per: 0.01,  res: 'arms',  ic: 'glove' },
    atk:     { name: 'Silah Kaçakçılığı', key: 'atk',     per: 0.006, res: 'arms',  ic: 'big_pistols' },
    def:     { name: 'Mahalle Bekçileri', key: 'def',     per: 0.006, res: 'metal', ic: 'shield' },
    speed:   { name: 'Kaçak Yollar',      key: 'speed',   per: 0.01,  res: 'cargo', ic: 'map_search' },
    hosp:    { name: 'Gizli Klinik',      key: 'hosp',    per: 300,   res: 'cash',  ic: 'medkit' },
    vault:   { name: 'Ortak Depo',        key: 'vault',   per: 0.03,  res: 'metal', ic: 'briefcase' },
};
const CT_MAX = 10, ctNeed = l => Math.round(400 * Math.pow(1.5, l)), DON_MAX = 20, DON_MS = 15 * 60e3, DON_PTS = 20;
const donAmt = (res, l) => Math.round((res === 'arms' || res === 'metal' ? 1000 : 2500) * (1 + l * 0.6));
const CSHOP = [{ id: 'rose', items: { gift_rose: 1 }, cost: 120 }, { id: 'medal', items: { hero_medal: 2 }, cost: 200 }, { id: 'spd', items: { speed_1h: 1 }, cost: 250 }, { id: 'mat', items: { mat_box: 1 }, cost: 300 }, { id: 'res', items: { res_box: 1 }, cost: 350 }, { id: 'skin', items: { skin_box: 1 }, cost: 450 }, { id: 'dice', items: { dice: 1 }, cost: 160 }, { id: 'shield', items: { shield_8h: 1 }, cost: 900 }];
function weekKey(t) { const d = new Date(t + 3 * 3600e3), wd = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd)).toISOString().slice(0, 10); } // pazartesi (TR)
function ctOf(c) { c.tech = c.tech && typeof c.tech === 'object' ? c.tech : {}; Object.keys(CTECH).forEach(k => { c.tech[k] = c.tech[k] || { l: 0, p: 0 }; }); return c.tech; }
function clanB(u, k) { const c = u.clan && clans[u.clan]; if (!c || !c.tech) return 0; let v = 0; for (const id in CTECH) { const T = CTECH[id], t = c.tech[id]; if (T.key === k && t && t.l) v += T.per * t.l; } return v; }
function donOf(u) { const now = Date.now(), d = u.don = u.don && typeof u.don === 'object' ? u.don : { n: DON_MAX, t: now }; if (d.n < DON_MAX) { const k = Math.floor((now - d.t) / DON_MS); if (k > 0) { d.n = Math.min(DON_MAX, d.n + k); d.t += k * DON_MS; } } if (d.n >= DON_MAX) d.t = now; return d; }
function ctInfo(u) { const c = u.clan && clans[u.clan], d = donOf(u), wk = weekKey(Date.now());
    return { tech: c ? ctOf(c) : null, don: d.n, donMax: DON_MAX, next: d.n < DON_MAX ? d.t + DON_MS : 0, cpts: u.cpts || 0,
        top: c ? (c.members || []).map(n => users[n]).filter(Boolean).map(x => ({ u: x.username, p: x.cptsWk && x.cptsWk.wk === wk ? x.cptsWk.p : 0, ch: x.character || 'soulreaper' })).sort((a, b) => b.p - a.p).slice(0, 10) : [] }; }
// ═══ HAPİSHANE KULESİ (MC "The Slammer"): haftalık kat kat PvE; asker ölmez, savaş başına enerji; kat ödülü + hapishane parası; pazartesi sıfırlanır ═══
const SLAM_MAX = 100, SLAM_EN = 60, SLAM_EN_MS = 5 * 60e3, SLAM_COST = 6;
const slamGuard = f => Math.round(25 * Math.pow(f, 1.35) * (f % 10 === 0 ? 1.4 : 1)), slamDef = f => 1 + f * 0.015;
const SLAM_SHOP = [{ id: 'rose', items: { gift_rose: 2 }, cost: 60 }, { id: 'medal', items: { hero_medal: 3 }, cost: 90 }, { id: 'spd', items: { speed_1h: 1 }, cost: 80 }, { id: 'mat', items: { mat_box: 1 }, cost: 120 }, { id: 'res', items: { res_box: 2 }, cost: 160 }, { id: 'gem', items: { gem_1: 1 }, cost: 200 }, { id: 'skin', items: { skin_box: 1 }, cost: 150 }, { id: 'dice', items: { dice: 2 }, cost: 70 }];
const SLAM_RANK = [400, 250, 150, 100, 100, 80, 80, 60, 60, 60];
function slamOf(u) { const now = Date.now(), wk = weekKey(now); let s = u.slam;
    if (!s || typeof s !== 'object') s = u.slam = { f: 1, best: 0, wbest: 0, wk, en: SLAM_EN, et: now, coins: 0, wiped: false };
    if (s.wk !== wk) { s.lastWk = s.wk; s.lastBest = s.wbest; s.wk = wk; s.f = 1; s.wbest = 0; s.wiped = false; }
    if (s.en < SLAM_EN) { const k = Math.floor((now - s.et) / SLAM_EN_MS); if (k > 0) { s.en = Math.min(SLAM_EN, s.en + k); s.et += k * SLAM_EN_MS; } } if (s.en >= SLAM_EN) s.et = now;
    return s; }
function slamReward(f) { const items = {}; if (f % 5 === 0) items.mat_box = 1; if (f % 10 === 0) { items.hero_medal = 1 + Math.floor(f / 20); items.gift_rose = 1; items.skin_box = 1; } return { res: { cash: 600 * f, cargo: 400 * f, arms: 150 * f, metal: 150 * f }, items, coins: 4 + Math.ceil(f * 0.8) }; }
function slamGive(u, f) { const R = slamReward(f); Object.keys(R.res).forEach(k => u[k] = (u[k] || 0) + R.res[k]); if (Object.keys(R.items).length) giveItems(u, R.items); const s = slamOf(u); s.coins = (s.coins || 0) + R.coins; return R; }
function slamTop(k) { const wk = weekKey(Date.now()); return Object.values(users).filter(u => u.slam && u.slam.wk === wk && u.slam.wbest > 0).sort((a, b) => b.slam.wbest - a.slam.wbest).slice(0, k || 10).map(u => ({ u: u.username, f: u.slam.wbest, ch: u.character || 'soulreaper' })); }
function slamWipeTo(s) { const b = Math.floor((s.lastBest || s.best || 0) * 0.8); return !s.wiped && b > 1 && s.f <= b ? b : 0; }
function slamInfo(u) { const s = slamOf(u), f = Math.min(SLAM_MAX, s.f), top = slamTop(10);
    return { f, best: s.best, wbest: s.wbest, en: s.en, max: SLAM_EN, next: s.en < SLAM_EN ? s.et + SLAM_EN_MS : 0, cost: SLAM_COST, coins: s.coins || 0, guard: slamGuard(f), dm: slamDef(f), rew: slamReward(f),
        wipe: slamWipeTo(s), top, rank: top.findIndex(x => x.u === u.username) + 1, shop: SLAM_SHOP, rankRew: SLAM_RANK, done: s.f > SLAM_MAX, weekEnd: Date.parse(weekKey(Date.now()) + 'T00:00:00Z') - 3 * 3600e3 + 7 * 86400e3 }; }
function slamWeekly() { // haftalık sıralama ödülü (pazartesi): geçen haftanın en yüksek katlarına altın
    const wk = weekKey(Date.now()); if (world.slamWk === wk) return false; const prev = world.slamWk; world.slamWk = wk; markDirty('world'); if (!prev) return false;
    const L = Object.values(users).map(u => ({ u, f: u.slam ? (u.slam.wk === prev ? u.slam.wbest : u.slam.lastWk === prev ? u.slam.lastBest : 0) : 0 })).filter(x => x.f > 0).sort((a, b) => b.f - a.f).slice(0, 10);
    L.forEach((x, i) => { const g = SLAM_RANK[i] || 50; x.u.gold = (x.u.gold || 0) + g; marchReport(x.u, 'Hapishane', `Geçen haftanın Hapishane sıralamasında ${i + 1}. oldun (Kat ${x.f}). Ödül: ${g} altın.`); pushResources(x.u.username); });
    markDirty('users'); return true; }

// ═══ VİLLA GÖRÜNÜMLERİ (MC "Turf Decoration"): parçayla açılır; sahip olunan her görünüm kalıcı bonus; set 3/5; seçilen görünüm haritada görünür ═══
const SKINS = {
    gold:   { name: 'Altın Malikâne', frags: 40, w: 30, fx: { prod: 0.03 } },
    neon:   { name: 'Neon Kulüp',     frags: 40, w: 30, fx: { atk: 0.015, speed: 0.02 } },
    castle: { name: 'Kartal Kalesi',  frags: 50, w: 22, fx: { def: 0.03 } },
    winter: { name: 'Kış Sarayı',     frags: 50, w: 22, fx: { hosp: 1500, heal: 0.05 } },
    dragon: { name: 'Ejder Sarayı',   frags: 80, w: 10, fx: { atk: 0.03, def: 0.02 } },
};
const SKIN_SET = [{ n: 3, fx: { atk: 0.01, def: 0.01 } }, { n: 5, fx: { atk: 0.02, def: 0.02, prod: 0.02 } }];
function skinsOf(u) { const k = u.skins = u.skins && typeof u.skins === 'object' ? u.skins : { own: [], on: null }; k.own = Array.isArray(k.own) ? k.own.filter(x => SKINS[x]) : []; if (k.on && !k.own.includes(k.on)) k.on = null; return k; }
function skinB(u, key) { const k = u.skins; if (!k || !k.own || !k.own.length) return 0; let v = 0; k.own.forEach(id => { const S = SKINS[id]; if (S && S.fx[key]) v += S.fx[key]; }); SKIN_SET.forEach(st => { if (k.own.length >= st.n && st.fx[key]) v += st.fx[key]; }); return v; }
function skinFragPick() { const L = Object.entries(SKINS), tot = L.reduce((a, [, S]) => a + S.w, 0); let r = Math.random() * tot; for (const [id, S] of L) { r -= S.w; if (r <= 0) return id; } return L[0][0]; }

// ═══ ZAR TURU (MC "Mafiapoly"): zar → ilerle → kare ödülü; başlangıçtan geçiş = tur ödülü (günlük tur sayısına göre artar) ═══
const DICE_BOARD = [
    { t: 'start' }, { t: 'res', r: 'cash', v: 6000 }, { t: 'item', items: { speed_5m: 3 } }, { t: 'res', r: 'cargo', v: 5000 }, { t: 'chance' }, { t: 'res', r: 'arms', v: 2500 },
    { t: 'item', items: { gift_rose: 1 } }, { t: 'boost' }, { t: 'res', r: 'metal', v: 2500 }, { t: 'item', items: { mat_box: 1 } }, { t: 'chance' }, { t: 'res', r: 'cash', v: 12000 },
    { t: 'jail' }, { t: 'item', items: { hero_medal: 2 } }, { t: 'res', r: 'cargo', v: 10000 }, { t: 'chance' }, { t: 'item', items: { speed_1h: 1 } }, { t: 'res', r: 'arms', v: 5000 },
    { t: 'boost' }, { t: 'item', items: { skin_box: 1 } }, { t: 'res', r: 'metal', v: 5000 }, { t: 'chance' }, { t: 'item', items: { res_box: 1 } }, { t: 'res', r: 'cash', v: 20000 },
];
const DICE_FREE = 3;
const DICE_LAP = [{ gold: 20, items: { skin_box: 1 } }, { gold: 30, items: { hero_medal: 5, dice: 1 } }, { gold: 50, items: { skin_box: 2, gift_perfume: 1 } }, { gold: 80, items: { sf_dragon: 10 } }]; // günün 1./2./3./4.+ turu
const DICE_CHANCE = [
    { msg: 'Kumarhanede şanslı gece: 15.000 Cash', res: { cash: 15000 } }, { msg: 'Gizli depo bulundu: 2 malzeme sandığı', items: { mat_box: 2 } },
    { msg: 'Kestirme yol: 2 kare ileri', move: 2 }, { msg: 'Polis çevirmesi: 3 kare geri', move: -3 }, { msg: 'Muhbirden bahşiş: 1 Sihirli Zar', items: { dice: 1 } },
    { msg: 'Sırdaşlardan hediye: 2 Gül Buketi', items: { gift_rose: 2 } }, { msg: 'Kaçakçı indirimi: 8.000 Cargo', res: { cargo: 8000 } }, { msg: 'Silah sevkiyatı: 4.000 Arms', res: { arms: 4000 } },
];
function diceOf(u) { const d = dayKey(Date.now()), x = u.dice = u.dice && typeof u.dice === 'object' ? u.dice : { pos: 0, lapsAll: 0 }; if (x.day !== d) { x.day = d; x.free = DICE_FREE; x.laps = 0; } return x; }
function diceInfo(u) { const x = diceOf(u); return { pos: x.pos || 0, free: x.free, have: (u.bag || {}).dice || 0, laps: x.laps, lapsAll: x.lapsAll || 0, boost: !!x.boost, board: DICE_BOARD, lap: DICE_LAP }; }
function diceGrant(u, r, mult) { const out = { res: {}, items: {} }; if (r.res) Object.entries(r.res).forEach(([k, v]) => { u[k] = (u[k] || 0) + v * mult; out.res[k] = v * mult; });
    if (r.items) { const it = {}; Object.entries(r.items).forEach(([k, v]) => it[k] = v * mult); giveItems(u, it); Object.assign(out.items, it); } if (r.gold) { u.gold = (u.gold || 0) + r.gold * mult; out.gold = r.gold * mult; } return out; }

// ═══ KLAN FENERLERİ (MC "Lighthouse") ═══
const LIGHTS = [
    { id: 'lh_harvest', type: 'harvest', name: 'Bereket Feneri', x: -5330, z: 3900, fx: { prod: 0.01, load: 0.02 } },
    { id: 'lh_rally',   type: 'rally',   name: 'Talim Feneri',   x: -5330, z: -1900, fx: { trainSp: 0.015, build: 0.005 } },
    { id: 'lh_combat',  type: 'combat',  name: 'Savaş Feneri',   x: -5330, z: -4150, fx: { atk: 0.008, def: 0.005 } },
];
const LIGHT_MAX = 10, LIGHT_NPC = 1500, LIGHT_REPAIR = 60; // onarım: dakikada 1000 asker başına
const lightNeed = l => Math.round(6000 * Math.pow(1.6, l - 1)), lightDecay = l => 40 + l * 25;
function lightOwned(T, u) { return !!T.holder && (T.holder === u.username || (!!u.clan && T.clan === u.clan)); }
function lightB(u, k) { let v = 0; Object.values(world.lights || {}).forEach(T => { const D = LIGHTS.find(q => q.id === T.id); if (D && D.fx[k] && lightOwned(T, u)) v += D.fx[k] * (T.lvl || 1); }); return v; }
function initLights() {
    world.lights = world.lights && typeof world.lights === 'object' ? world.lights : {};
    LIGHTS.forEach(D => { const T = world.lights[D.id] = world.lights[D.id] || { lvl: 1, dur: 0, npc: LIGHT_NPC, holder: null };
        Object.assign(T, { id: D.id, kind: 'light', type: D.type, name: D.name, x: D.x, z: D.z, max: LIGHT_NPC }); WPOS[D.id] = { x: D.x, z: D.z }; });
    Object.values(world.thugs || {}).forEach(t => { if (nearHall(t.x, t.z, 60)) delete world.thugs[t.id]; });
    Object.values(world.res || {}).forEach(t => { if (!t.by && nearHall(t.x, t.z, 60)) delete world.res[t.id]; });
    ensureThugs(); ensureRes(); Object.values(world.lights).forEach(siteSync); markDirty('world');
}
function lightMinute() { // onarım − aşınma → seviye atla / düş; sahipsizken muhafız toparlanır
    let ch = false;
    Object.values(world.lights || {}).forEach(T => {
        const rep = T.holder ? LIGHT_REPAIR * (T.gn || 0) / 1000 : 0, l0 = T.lvl || 1; T.dur = (T.dur || 0) + rep - lightDecay(l0); T.rate = Math.round(rep - lightDecay(l0));
        if (T.lvl < LIGHT_MAX && T.dur >= lightNeed(T.lvl)) { T.dur -= lightNeed(T.lvl); T.lvl++; }
        else if (T.lvl >= LIGHT_MAX) T.dur = Math.min(T.dur, lightNeed(LIGHT_MAX));
        if (T.dur < 0) { if (T.lvl > 1) { T.lvl--; T.dur = Math.round(lightNeed(T.lvl) * 0.5); } else T.dur = 0; }
        if (T.lvl !== l0) { const D = LIGHTS.find(q => q.id === T.id); if (T.clan && clans[T.clan]) chatSys(T.clan, `${T.name} ${T.lvl > l0 ? 'Sv. ' + T.lvl + ' oldu!' : 'aşındı, Sv. ' + T.lvl + "'e düştü."} (${D ? Object.keys(D.fx).length : 0} etki)`, 'soulreaper');
            const L = T.holder && users[T.holder]; if (L) (T.clan && clans[T.clan] ? clans[T.clan].members : [L.username]).forEach(n => { if (isOnline(n)) pushResources(n); }); }
        if (!T.holder && (T.npc || 0) < LIGHT_NPC) T.npc = Math.min(LIGHT_NPC, (T.npc || 0) + Math.ceil(LIGHT_NPC * 0.05));
        ch = true;
    });
    return ch;
}

// ═══ KLAN BÖLGESİ (MC "Clan Territory": Karargâh + Kuleler) ═══
const TER = {
    hq:    { name: 'Klan Karargâhı', r: 700, need: 6000, max: 30000, cap: 20000, npc: 1500, cost: { cash: 500000, metal: 200000 }, fx: { prod: 0.10, def: 0.05, gather: 0.25 } },
    tower: { name: 'Klan Kulesi',    r: 500, need: 4000, max: 15000, cap: 10000, npc: 800,  cost: { cash: 300000, metal: 100000 }, fx: { prod: 0.05, def: 0.03, gather: 0.15 } },
};
const TER_TOWERS = 3, TER_BUILD_K = Number(process.env.TER_BUILD_K) || 0.1, TER_REPAIR = 150, TER_CALM = Number(process.env.TER_CALM_MS) || 180e3, TER_TP_CD = 4 * 3600e3;
function terFriendly(T, u) { return !!T && !!u && !!u.clan && T.clan === u.clan; }
function terActive(T) { if (!T || T.state !== 'done' || !clans[T.clan]) return false; if (T.type === 'hq') return true; return Object.values(world.ters || {}).some(H => H.clan === T.clan && H.type === 'hq' && H.state === 'done'); }
function terCover(x, z, clan) { // (x,z)'yi kapsayan etkin yapı (karargâh öncelikli); clan verilirse yalnız o klanın
    let best = null; Object.values(world.ters || {}).forEach(T => { if (clan && T.clan !== clan) return; if (!terActive(T) || Math.hypot(T.x - x, T.z - z) > TER[T.type].r) return; if (!best || (T.type === 'hq' && best.type !== 'hq')) best = T; }); return best;
}
function terB(u, k) { if (k === 'gather' || !u.clan || !u.base) return 0; const T = terCover(u.base.x, u.base.z, u.clan); return T ? (TER[T.type].fx[k] || 0) : 0; }
function terGatherB(u, x, z) { if (!u.clan) return 0; const T = terCover(x, z, u.clan); return T ? TER[T.type].fx.gather || 0 : 0; }
function terBlock(u, x, z) { return Object.values(world.ters || {}).some(T => (!u || !u.clan || T.clan !== u.clan) && terActive(T) && Math.hypot(T.x - x, T.z - z) <= TER[T.type].r); } // başkasının bölgesi
function terSync(T) { const st = stationed(T.id); T.gn = st.reduce((a, [, m]) => a + mixTotal(m.troops), 0); T.gl = st.map(([u, m]) => ({ u: u.username, n: mixTotal(m.troops) })); }
function terWhyPlace(u, type, x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 4600 || Math.abs(z) > 4600) return 'Harita sınırına çok yakın.';
    if (nearHall(x, z, 220)) return 'Belediye Sarayı, kaleler ve fenerlerin yakınına klan yapısı kurulamaz.';
    const D = TER[type];
    for (const T of Object.values(world.ters || {})) { const d = Math.hypot(T.x - x, T.z - z);
        if (T.clan !== u.clan && d < TER[T.type].r + D.r) return `${(clans[T.clan] || {}).name || 'Başka bir'} klanının bölgesiyle çakışıyor.`;
        if (T.clan === u.clan && d < 380) return 'Klanının başka bir yapısına çok yakın.'; }
    if (type === 'tower' && !Object.values(world.ters || {}).some(T => T.clan === u.clan && Math.hypot(T.x - x, T.z - z) <= TER[T.type].r + D.r * 0.9)) return 'Kule, klan bölgesine bitişik kurulmalı.';
    for (const [id, q] of Object.entries(WPOS)) if (!String(id).startsWith('ter') && Math.hypot(q.x - x, q.z - z) < 170) return 'Bir şehir, maden ya da hedefe çok yakın.';
    if (Object.values(users).some(o => o.base && Math.hypot(o.base.x - x, o.base.z - z) < 200)) return 'Bir villaya çok yakın.';
    return null;
}
function terDamage(mix) { let d = 0; for (const k in mix) { const n = mix[k] || 0; if (!n || k === 'n') continue; d += n * (TIER.mult[(+k.slice(1) || 1) - 1] || 1) * (k[0] === 'a' ? 1.5 : 1); } return Math.round(d); }
function terFight(T, all, mult, tm) { // garnizon + (tamamlanmış yapıda) yapı muhafızı savunur; savunan kayıplar garnizon sahiplerinin hastanesine
    const st = stationed(T.id), def = {}; st.forEach(([, m]) => mixAdd(def, m.troops)); const pall = { ...def }; if (T.state === 'done' && (T.npc || 0) > 0) def.n = T.npc;
    if (!mixTotal(def)) return { attackerWins: true, atkPower: 0, defPower: 0, aLost: {}, dLost: {}, attackerLosses: 0, defenderLosses: 0, empty: true };
    const O = st.length ? st[0][0] : users[(clans[T.clan] || {}).leader];
    const r = battle(all, mult, def, 1.15 * (O ? defenseMult(O) : 1), tm, O ? heroTM(O) : null);
    T.npc = Math.max(0, (T.npc || 0) - (r.dLost.n || 0)); const pl = { ...r.dLost }; delete pl.n; if (mixTotal(pl) && st.length) shareLoss(st, pall, pl);
    st.forEach(([o]) => { stat(o, 'kills', Math.round((r.attackerLosses || 0) / st.length)); if (!r.attackerWins) stat(o, 'defends'); pushResources(o.username); });
    return r;
}
function terHit(T, dmg, L) { // hasar uygula → true: yapı yıkıldı
    const now = Date.now(); T.hitAt = now; const C = clans[T.clan];
    if (T.state === 'build') T.prog = Math.max(0, (T.prog || 0) - dmg); else T.dur = Math.max(0, (T.dur || 0) - dmg);
    const left = T.state === 'build' ? T.prog : T.dur;
    if (left <= 0) { terRaze(T, L); return true; }
    if (C && now - (T.warnAt || 0) > 60e3) { T.warnAt = now; chatSys(T.clan, `⚠ ${T.name} saldırı altında! ${L ? L.username : 'Düşman'} ${dmg.toLocaleString('tr-TR')} hasar verdi (kalan ${left.toLocaleString('tr-TR')}). Garnizonu güçlendirin!`, 'soulreaper'); }
    return false;
}
function terRaze(T, L, quiet) { // yapı yıkıldı / sahipsiz kaldı: garnizon eve, yapı haritadan kalkar
    const C = clans[T.clan], who = L ? (L.clan && clans[L.clan] ? `[${clans[L.clan].name}] ${L.username}` : L.username) : null;
    stationed(T.id).forEach(([o, m]) => { marchHome(o, m, { x: T.x, z: T.z }); if (!quiet) { emitTo(o.username, 'toast', { type: 'defeat', msg: `${T.name} yıkıldı! Askerlerin geri dönüyor.` }); marchReport(o, 'Savaş Raporu', `${T.name}${who ? ' ' + who + ' tarafından' : ''} yıkıldı. Kalan askerlerin eve dönüyor.`); } pushResources(o.username); });
    delete world.ters[T.id]; delete WPOS[T.id]; markDirty('world'); markDirty('users');
    if (quiet) return;
    if (C) { chatSys(T.clan, `${T.name} yıkıldı!${T.type === 'hq' ? ' Karargâh olmadan kuleler etkisiz — yeni karargâh kurun.' : ''}`, 'soulreaper'); C.members.forEach(n => isOnline(n) && pushResources(n)); }
    if (who) { chatWorld(`${who}, ${C ? '[' + C.name + '] klanının ' : ''}${T.name} yapısını yıktı!`); if (L.clan) { L.cpts = (L.cpts || 0) + (T.type === 'hq' ? 300 : 120); stat(L, 'terRaze'); } }
}
function terRallyResolve(L, R, parts, all, share) {
    const T = (world.ters || {})[R.target]; if (!T) return { msg: `${R.name}: yapı artık yok`, win: false }; if (terFriendly(T, L)) return { msg: `${R.name}: yapı klanınızın`, win: false };
    const r = terFight(T, all, attackMult(L) * 1.05, heroTM(L)); shareLoss(parts, all, r.aLost); const win = r.attackerWins;
    let dmg = 0, razed = false; if (win) { const surv = {}; parts.forEach(([, m]) => mixAdd(surv, m.troops)); dmg = terDamage(surv); razed = terHit(T, dmg, L); }
    parts.forEach(([u, m]) => { const sh = share[u.username] || 0; stat(u, 'kills', Math.round((r.defenderLosses || 0) * sh)); stat(u, 'rally'); if (dmg) stat(u, 'terDmg', Math.round(dmg * sh));
        m.mats = randMats(Math.round((win ? 4 : 2) + 8 * sh + (razed ? 6 : 0)), 0.15); addXP(u, (win ? 70 : 25) + (r.defenderLosses || 0) * sh / 8, true); evPoints(u, 'war', (r.defenderLosses || 0) * 3 * sh + dmg / 20); questProgress(u, 'attack'); });
    if (!razed) terSync(T); markDirty('world'); io.emit('battleAnimation', { cityId: T.id, characterId: L.character, attackerColor: L.empireColor, result: r }); broadcastWorld();
    return { msg: `${R.name}: ${!win ? 'savunma kırılamadı' : razed ? 'YAPI YIKILDI!' : dmg.toLocaleString('tr-TR') + ' hasar'} (düşman kaybı ${r.defenderLosses || 0})`, win };
}
function terArrive(u, m) { // tek sefer klan yapısına vardı: dostsa garnizon / inşaat, düşmansa kuşatma (saldıranlar hep döner)
    const T = (world.ters || {})[m.target], now = Date.now();
    if (!T) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name} artık yok, sefer geri dönüyor.` }); return marchBack(m); }
    if (terFriendly(T, u)) {
        if ((T.gn || 0) + mixTotal(m.troops) > TER[T.type].cap) { emitTo(u.username, 'toast', { type: 'info', msg: `${T.name} garnizonu dolu (${TER[T.type].cap}), sefer geri dönüyor.` }); return marchBack(m); }
        m.state = 'station'; m.t0 = now; m.t1 = now; terSync(T); markDirty('world'); broadcastWorld();
        emitTo(u.username, 'toast', { type: 'success', msg: `${mixTotal(m.troops)} asker ${T.name} ${T.state === 'build' ? 'inşaatına' : 'garnizonuna'} katıldı.` }); return;
    }
    if (T.type === 'hq' && T.state === 'done') { emitTo(u.username, 'toast', { type: 'info', msg: `${T.name} yalnız klan baskınıyla kuşatılabilir; sefer geri dönüyor.` }); return marchBack(m); }
    const r = terFight(T, m.troops, attackMult(u), heroTM(u));
    mixAdd(m.troops, r.aLost, -1); const hosp = sendToHospital(u, r.aLost); m.result = r; stat(u, 'kills', r.defenderLosses || 0);
    addXP(u, (r.attackerWins ? 60 : 20) + (r.defenderLosses || 0) / 8, true); evPoints(u, 'war', (r.defenderLosses || 0) * 3); questProgress(u, 'attack');
    let dmg = 0, razed = false;
    if (r.attackerWins) { dmg = terDamage(m.troops); stat(u, 'terDmg', dmg); m.mats = randMats(3 + Math.round(dmg / 2500), 0.15); razed = terHit(T, dmg, u);
        emitTo(u.username, 'toast', { type: 'victory', msg: razed ? `${T.name} yıkıldı!` : `${T.name}: ${dmg.toLocaleString('tr-TR')} hasar! (Kayıp: ${r.attackerLosses})` }); }
    else emitTo(u.username, 'toast', { type: 'defeat', msg: `${T.name} garnizonu saldırıyı püskürttü! (Kayıp: ${r.attackerLosses}, hastane: ${hosp.admitted})` });
    marchReport(u, 'Savaş Raporu', `${T.name} kuşatması: ${!r.attackerWins ? 'Yenilgi' : razed ? 'YAPI YIKILDI' : dmg.toLocaleString('tr-TR') + ' hasar'} — kayıp ${r.attackerLosses || 0}, düşman kaybı ${r.defenderLosses || 0}, dönen ${mixTotal(m.troops)} asker.`);
    marchBack(m); if (!razed) terSync(T); markDirty('world'); io.emit('battleAnimation', { cityId: T.id, characterId: u.character, attackerColor: u.empireColor, result: r }); broadcastWorld();
}
function initTer() { world.ters = world.ters && typeof world.ters === 'object' ? world.ters : {}; Object.values(world.ters).forEach(T => { WPOS[T.id] = { x: T.x, z: T.z }; terSync(T); }); }
function terMinute() { // inşaat ilerler (garnizon), tamamlanınca bölge açılır; sakin yapı onarılır; klansız kalan yapılar kalkar
    const now = Date.now(); let ch = false;
    Object.values(world.ters || {}).forEach(T => {
        const C = clans[T.clan]; if (!C) { terRaze(T, null, true); ch = true; return; }
        stationed(T.id).forEach(([o, m]) => { if (o.clan !== T.clan) { marchHome(o, m, { x: T.x, z: T.z }); pushResources(o.username); ch = true; } });
        terSync(T); const D = TER[T.type];
        if (T.state === 'build') {
            const st = stationed(T.id), add = Math.round((T.gn || 0) * TER_BUILD_K);
            if (add > 0) { T.prog = Math.min(T.need, (T.prog || 0) + add); st.forEach(([o, m]) => stat(o, 'terBuild', Math.round(mixTotal(m.troops) * TER_BUILD_K))); T.rate = add; ch = true; } else T.rate = 0;
            if (T.prog >= T.need) { T.state = 'done'; T.dur = D.max; T.npc = D.npc; T.doneAt = now; delete T.rate; ch = true;
                chatSys(T.clan, `${T.name} tamamlandı! Bölge etkileri aktif: üretim +%${Math.round(D.fx.prod * 100)}, savunma +%${Math.round(D.fx.def * 100)}, bölgede toplama +%${Math.round(D.fx.gather * 100)}.`, 'soulreaper');
                chatWorld(`[${C.name}] klanı ${D.name} kurdu.`); C.members.forEach(n => { if (isOnline(n)) { pushResources(n); emitTo(n, 'toast', { type: 'victory', msg: `${T.name} tamamlandı! Bölge etkileri aktif.` }); } }); }
        } else if (now - (T.hitAt || 0) > TER_CALM) {
            if (T.dur < D.max) { T.dur = Math.min(D.max, T.dur + Math.round(D.max * 0.01 + (T.gn || 0) * TER_REPAIR / 1000)); ch = true; }
            if ((T.npc || 0) < D.npc) { T.npc = Math.min(D.npc, (T.npc || 0) + Math.ceil(D.npc * 0.1)); ch = true; }
        }
    });
    return ch;
}

// ═══ BAŞARIMLAR (MC "Achievements") ═══
const ACH_CATS = { dev: 'Gelişim', war: 'Savaş', clan: 'Klan & Dünya', col: 'Koleksiyon' };
const ACH = [
    { id: 'villa',    cat: 'dev',  name: 'Villa Patronu',       d: 'Villa seviyesi',                       t: 'villa',   n: [5, 10, 15, 20, 25] },
    { id: 'power',    cat: 'dev',  name: 'Güç Gösterisi',       d: 'Toplam güç',                           t: 'power',   n: [1e4, 1e5, 5e5, 2e6, 1e7] },
    { id: 'trained',  cat: 'dev',  name: 'Ordu Kurucu',         d: 'Eğitilen asker',                       t: 'trained', n: [1e3, 1e4, 5e4, 2e5, 1e6] },
    { id: 'tier',     cat: 'dev',  name: 'Seçkin Birlik',       d: 'En yüksek birlik kademesi',            t: 'tier',    n: [3, 5, 6, 7, 8] },
    { id: 'gather',   cat: 'dev',  name: 'Toplayıcı',           d: 'Kaynak noktalarından toplanan',        t: 'gather',  n: [1e5, 1e6, 5e6, 2e7, 1e8] },
    { id: 'gear',     cat: 'dev',  name: 'Demirci',             d: 'Üretilen ekipman',                     t: 'gear',    n: [1, 10, 30, 100, 300] },
    { id: 'thugs',    cat: 'war',  name: 'Sokak Temizliği',     d: 'Dağıtılan sokak çetesi',               t: 'st', k: 'thugs',   n: [10, 50, 200, 1000, 5000] },
    { id: 'raids',    cat: 'war',  name: 'Yağmacı',             d: 'Başarılı villa yağması',               t: 'st', k: 'raids',   n: [1, 10, 50, 200, 1000] },
    { id: 'kills',    cat: 'war',  name: 'Cellat',              d: 'Öldürülen düşman askeri',              t: 'st', k: 'kills',   n: [1e3, 1e4, 1e5, 1e6, 1e7] },
    { id: 'defends',  cat: 'war',  name: 'Kale Duvarı',         d: 'Püskürtülen saldırı',                  t: 'st', k: 'defends', n: [1, 5, 20, 100, 500] },
    { id: 'boss',     cat: 'war',  name: 'Ödül Avcısı',         d: 'Bounty hedefine saldırı',              t: 'st', k: 'boss',    n: [5, 25, 100, 500, 2000] },
    { id: 'rally',    cat: 'war',  name: 'Baskın Ustası',       d: 'Klan baskınına katılım',               t: 'st', k: 'rally',   n: [1, 10, 50, 200, 1000] },
    { id: 'slam',     cat: 'war',  name: 'Hapishane Kralı',     d: 'Hapishane kulesinde en yüksek kat',    t: 'slam',    n: [10, 25, 50, 80, 120] },
    { id: 'cities',   cat: 'clan', name: 'Şehir Fatihi',        d: 'Ele geçirilen şehir',                  t: 'st', k: 'cities',  n: [1, 5, 20, 50, 200] },
    { id: 'lights',   cat: 'clan', name: 'Fener Bekçisi',       d: 'Ele geçirilen klan feneri',            t: 'st', k: 'lights',  n: [1, 3, 10, 30, 100] },
    { id: 'donate',   cat: 'clan', name: 'Hayırsever',          d: 'Klan teknolojisine bağış',             t: 'st', k: 'donate',  n: [10, 50, 200, 1000, 5000] },
    { id: 'terBuild', cat: 'clan', name: 'Bölge Kurucusu',      d: 'Klan yapılarına inşaat katkısı',       t: 'st', k: 'terBuild', n: [500, 3000, 15000, 60000, 250000] },
    { id: 'terDmg',   cat: 'clan', name: 'Kuşatmacı',           d: 'Düşman klan yapılarına verilen hasar', t: 'st', k: 'terDmg',  n: [1e3, 1e4, 5e4, 2e5, 1e6] },
    { id: 'hstar',    cat: 'col',  name: 'Yıldız Kadro',        d: 'Kahramanların toplam yıldızı',         t: 'hstar',   n: [5, 10, 20, 32, 48] },
    { id: 'conf',     cat: 'col',  name: 'Gönül Avcısı',        d: 'Sırdaşların toplam seviyesi',          t: 'conf',    n: [8, 15, 24, 32, 40] },
    { id: 'car',      cat: 'col',  name: 'Garaj Koleksiyoncusu', d: 'Tamamlanan araba',                    t: 'car',     n: [1, 2, 4, 6, 8] },
    { id: 'skins',    cat: 'col',  name: 'Villa Stilisti',      d: 'Sahip olunan villa görünümü',          t: 'skins',   n: [1, 2, 3, 4, 5] },
    { id: 'dice',     cat: 'col',  name: 'Şans Oyuncusu',       d: 'Zar turunda atış',                     t: 'st', k: 'dice',    n: [10, 50, 200, 1000, 3000] },
];
const ACH_GOLD = [10, 25, 50, 100, 200], ACH_PTS = [5, 10, 20, 40, 80];
const ACH_RANKS = [['Acemi', 0], ['Sokak Çocuğu', 50], ['Tetikçi', 150], ['Kaptan', 350], ['Konsigliere', 700], ['Kapo', 1200], ['Baba', 2000], ['Efsane', 3000]];
const ACH_FX = { atk: 0.005, def: 0.005, prod: 0.01 }; // rütbe başına
function achOf(u) { const a = u.ach = u.ach && typeof u.ach === 'object' ? u.ach : { c: {}, pts: 0 }; a.c = a.c && typeof a.c === 'object' ? a.c : {}; a.pts = a.pts || 0; return a; }
function achRank(u) { const p = (u.ach && u.ach.pts) || 0; let r = 0; ACH_RANKS.forEach(([, need], i) => { if (p >= need) r = i; }); return r; }
function achB(u, k) { return ACH_FX[k] ? ACH_FX[k] * achRank(u) : 0; }
function achVal(u, A) {
    if (A.t === 'st') return (u.st || {})[A.k] || 0;
    if (A.t === 'slam') return (u.slam && u.slam.best) || 0;
    if (A.t === 'hstar') return (u.heroes || []).reduce((a, h) => a + (h.stars || 1), 0);
    if (A.t === 'conf') { const c = conf(u); return Object.keys(CONFIDANTS).reduce((a, k) => a + ((c[k] && c[k].lvl) || 1), 0); }
    if (A.t === 'skins') return skinsOf(u).own.length;
    return taskVal(u, { t: A.t });
}
function achReady(u) { const a = achOf(u); let n = 0; ACH.forEach(A => { const c = a.c[A.id] || 0; if (c < A.n.length && achVal(u, A) >= A.n[c]) n++; }); return n; }
function achInfo(u) { const a = achOf(u); return { list: ACH.map(A => ({ id: A.id, v: achVal(u, A), c: a.c[A.id] || 0 })), pts: a.pts, rank: achRank(u), ready: achReady(u) }; }
function achClaim(u, A) { // bir kademe al → { gold, pts, rankUp } ya da null
    const a = achOf(u), c = a.c[A.id] || 0; if (c >= A.n.length || achVal(u, A) < A.n[c]) return null;
    const r0 = achRank(u); a.c[A.id] = c + 1; a.pts += ACH_PTS[c]; u.gold = (u.gold || 0) + ACH_GOLD[c]; return { gold: ACH_GOLD[c], pts: ACH_PTS[c], tier: c + 1, rankUp: achRank(u) > r0 };
}
const achDotSent = new Map();
function achMinute() { Object.values(users).forEach(u => { if (!isOnline(u.username) || !u.base) return; const n = achReady(u); if (achDotSent.get(u.username) !== n) { achDotSent.set(u.username, n); emitTo(u.username, 'achDot', { n }); } }); }

// ═══ KUMARHANE SAVAŞI (MC "Las Vegas Casino Takeover") ═══
const CAS_PERIOD = Number(process.env.CAS_PERIOD_MS) || 7 * 864e5, CAS_ACTIVE = Number(process.env.CAS_ACTIVE_MS) || 2 * 864e5;
const CAS_EPOCH = Number(process.env.CAS_EPOCH) || Date.UTC(2026, 0, 2, 17, 0); // Cuma 20:00 (TR)
const CAS_POS = { x: -2000, z: -2000 }, CAS_NPC = 3000, CAS_FIS_PTS = 50;
const CAS_TRAIN = [1, 2, 3, 4, 5, 8, 11, 15];   // eğitilen asker başına puan (T1..T8)
const CAS_TIERS = [500, 2000, 6000, 15000, 40000, 100000];
const CAS_REW = [{ fis: 10, items: { speed_5m: 5 } }, { fis: 20, gold: 30, items: { dice: 1 } }, { fis: 40, gold: 60, items: { skin_box: 1 } },
    { fis: 60, gold: 100, items: { sf_neon: 10 } }, { fis: 100, gold: 150, items: { sf_neon: 20, speed_8h: 1 } }, { fis: 150, gold: 300, items: { sf_neon: 30, vip_1000: 1 } }];
const CAS_RANK = [{ gold: 1000, items: { sf_neon: 40 } }, { gold: 600, items: { sf_neon: 30 } }, { gold: 400, items: { sf_neon: 20 } }]; // 4–10: 150 altın + 10 parça · 11–50: 50 altın
const CAS_CLAN = [{ gold: 200, cpts: 500 }, { gold: 120, cpts: 300 }, { gold: 80, cpts: 200 }];
const CAS_SHOP = [
    { id: 'spd', items: { speed_1h: 1 }, cost: 25 }, { id: 'med', items: { hero_medal: 5 }, cost: 40 }, { id: 'dice', items: { dice: 2 }, cost: 30 },
    { id: 'perf', items: { gift_perfume: 1 }, cost: 45 }, { id: 'skin', items: { skin_box: 1 }, cost: 60 }, { id: 'neon', items: { sf_neon: 10 }, cost: 120 },
    { id: 'trp', items: { troops_500: 1 }, cost: 120 }, { id: 'gold', gold: 50, cost: 200, lim: 5 },
];
const CAS_SYMS = [{ id: 'cash', w: 30, x: 5 }, { id: 'rose', w: 25, x: 8 }, { id: 'dice', w: 20, x: 12 }, { id: 'pistol', w: 12, x: 20 }, { id: 'gem', w: 8, x: 40 }, { id: 'gold', w: 5, x: 100 }]; // 3'lü ×x, çift ×1 (iade)
const CAS_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CAS_DAILY = 10;
function casNow() { const t = Date.now(), i = Math.floor((t - CAS_EPOCH) / CAS_PERIOD), start = CAS_EPOCH + i * CAS_PERIOD, active = t - start < CAS_ACTIVE; return { i, id: 'cas_' + i, active, start, ends: start + CAS_ACTIVE, next: active ? start + CAS_PERIOD : start + CAS_PERIOD }; }
function casOf(u) { const c = casNow(); if (!u.cas || u.cas.id !== c.id) u.cas = { id: c.id, pts: 0, acc: 0, claimed: {}, shop: {}, day: null }; u.casFis = u.casFis || 0; return u.cas; }
function casHold(u) { const T = world.casino; return !!T && !!T.holder && (T.holder === u.username || (!!u.clan && T.clan === u.clan)); }
function casAdd(u, p) { if (!(p > 0) || !casNow().active) return; const c = casOf(u); c.pts += Math.round(p); c.acc = (c.acc || 0) + Math.round(p); const f = Math.floor(c.acc / CAS_FIS_PTS); if (f) { c.acc -= f * CAS_FIS_PTS; u.casFis = (u.casFis || 0) + f; } }
function casStat(u, k, n) { if (!casNow().active) return; if (k === 'kills') casAdd(u, n * (casHold(u) ? 2 : 1)); else if (k === 'thugs') casAdd(u, 25 * n); }
function casTrain(u, key, n) { const l = +String(key).slice(1) || 1; casAdd(u, n * (CAS_TRAIN[l - 1] || 1)); }
function casTop(id, k = 50) { return Object.values(users).filter(u => u.cas && u.cas.id === id && u.cas.pts > 0).sort((a, b) => b.cas.pts - a.cas.pts).slice(0, k).map(u => ({ u: u.username, pts: u.cas.pts, ch: u.character || 'soulreaper', clan: u.clan || null })); }
function casClanTop(id) { const by = {}; Object.values(users).forEach(u => { if (!u.clan || !clans[u.clan] || !u.cas || u.cas.id !== id || !u.cas.pts) return; const c = by[u.clan] = by[u.clan] || { id: u.clan, name: clans[u.clan].name, flag: clans[u.clan].flag, pts: 0, n: 0 }; c.pts += u.cas.pts; c.n++; }); return Object.values(by).sort((a, b) => b.pts - a.pts).slice(0, 10); }
function casInfo(u) { const c = casNow(), x = casOf(u), T = world.casino || {}; return { active: c.active, id: c.id, ends: c.ends, next: c.next, pts: x.pts, acc: x.acc || 0, fis: u.casFis || 0, claimed: x.claimed, shop: x.shop || {}, daily: x.day === dayKey(Date.now()),
    rank: casTop(c.id, 9999).findIndex(q => q.u === u.username) + 1, top: casTop(c.id, 20), clanTop: casClanTop(c.id), hold: casHold(u), site: { holder: T.holder || null, clan: T.clan || null, gn: T.gn || 0, npc: T.npc || 0, x: T.x, z: T.z } }; }
function initCasino() {
    const T = world.casino = world.casino && typeof world.casino === 'object' ? world.casino : { npc: CAS_NPC, holder: null };
    Object.assign(T, { id: 'casino', kind: 'casino', name: 'Grand Kumarhane', x: CAS_POS.x, z: CAS_POS.z, max: CAS_NPC }); WPOS.casino = { x: CAS_POS.x, z: CAS_POS.z };
    Object.values(world.thugs || {}).forEach(t => { if (nearHall(t.x, t.z, 60)) delete world.thugs[t.id]; }); Object.values(world.res || {}).forEach(t => { if (!t.by && nearHall(t.x, t.z, 60)) delete world.res[t.id]; });
    { const c = casNow(); if (c.active && world.casEv !== c.id) { world.casEv = c.id; if (!T.holder) T.npc = CAS_NPC; } }
    siteSync(T); markDirty('world');
}
function casMinute() { // başlangıç / bitiş dünya kaydında tutulur (yeniden başlatmada sıfırlanmaz, ödül iki kez verilmez)
    const c = casNow(), T = world.casino; let ch = false;
    if (c.active) {
        if (world.casEv !== c.id) { world.casEv = c.id; if (T) { stationed(T.id).forEach(([o, m]) => { marchHome(o, m, { x: T.x, z: T.z }); pushResources(o.username); }); T.npc = CAS_NPC; T.holder = null; T.clan = null; T.color = null; T.since = 0; T.gn = 0; T.gl = []; }
            chatWorld('Kumarhane Savaşı başladı! Grand Kumarhane\'yi tut, düşman indir, Onur Puanı topla.'); io.emit('toast', { type: 'victory', msg: 'Kumarhane Savaşı başladı!' }); ch = true; }
        if (T && T.holder) stationed(T.id).forEach(([o, m]) => { const n = mixTotal(m.troops); casAdd(o, Math.max(1, Math.round(n / 100))); o.casFis = (o.casFis || 0) + 1; });
        if (T && !T.holder && (T.npc || 0) < CAS_NPC) { T.npc = Math.min(CAS_NPC, (T.npc || 0) + Math.ceil(CAS_NPC * 0.05)); ch = true; }
    } else if (world.casEv === c.id && world.casPaid !== c.id) {
        world.casPaid = c.id; const prev = c.id, top = casTop(prev, 50), ct = casClanTop(prev);
        top.forEach((x, k) => { const u = users[x.u]; if (!u) return; const R = k < 3 ? CAS_RANK[k] : k < 10 ? { gold: 150, items: { sf_neon: 10 } } : { gold: 50 }; u.gold = (u.gold || 0) + (R.gold || 0); if (R.items) giveItems(u, R.items);
            marchReport(u, 'Kumarhane Savaşı', `Etkinlik bitti: ${k + 1}. oldun! Ödül: ${R.gold} altın${R.items ? ' + ' + Object.entries(R.items).map(([i, n]) => n + ' ' + ((ITEMS[i] || {}).name || i)).join(', ') : ''}.`); });
        ct.slice(0, 3).forEach((cl, k) => { const R = CAS_CLAN[k]; (clans[cl.id] ? clans[cl.id].members : []).forEach(n => { const u = users[n]; if (!u || !u.cas || u.cas.id !== prev || !u.cas.pts) return; u.gold = (u.gold || 0) + R.gold; u.cpts = (u.cpts || 0) + R.cpts; marchReport(u, 'Kumarhane Savaşı', `Klanın ${k + 1}. oldu! Ödül: ${R.gold} altın + ${R.cpts} klan puanı.`); }); });
        if (T) { stationed(T.id).forEach(([o, m]) => { marchHome(o, m, { x: T.x, z: T.z }); pushResources(o.username); }); T.holder = null; T.clan = null; T.color = null; T.since = 0; T.gn = 0; T.gl = []; T.npc = CAS_NPC; }
        chatWorld(top.length ? `Kumarhane Savaşı bitti! Birinci: ${top[0].u} (${top[0].pts.toLocaleString('tr-TR')} puan)${ct[0] ? ' · en iyi klan: [' + ct[0].name + ']' : ''}.` : 'Kumarhane Savaşı bitti.');
        markDirty('users'); markDirty('world'); ch = true;
    }
    return ch;
}
function casSpin(n) { // Avrupa ruleti: 0–36
    return Math.floor(Math.random() * 37);
}
function casBetWin(b, n) { const v = int(b.v); switch (b.t) {
    case 'red': return n && CAS_RED.has(n) ? 2 : 0; case 'black': return n && !CAS_RED.has(n) ? 2 : 0; case 'odd': return n && n % 2 ? 2 : 0; case 'even': return n && !(n % 2) ? 2 : 0;
    case 'low': return n >= 1 && n <= 18 ? 2 : 0; case 'high': return n >= 19 ? 2 : 0; case 'dozen': return v >= 1 && v <= 3 && n >= (v - 1) * 12 + 1 && n <= v * 12 ? 3 : 0; case 'num': return v >= 0 && v <= 36 && n === v ? 36 : 0; }
    return 0; }
function casReel() { const W = CAS_SYMS.reduce((a, q) => a + q.w, 0); let r = Math.random() * W; for (const q of CAS_SYMS) { if ((r -= q.w) < 0) return q.id; } return CAS_SYMS[0].id; }
// ═══ SEFER VARIŞ / DÖNÜŞ (her saniye; çevrimdışı oyuncular dahil) ═══
function marchReport(u, title, msg) { u.inbox = u.inbox || []; u.inbox.unshift({ from: title, msg, date: Date.now(), read: false }); if (u.inbox.length > 50) u.inbox.pop(); }
function marchBack(m) { const now = Date.now(); m.state = 'back'; m.t0 = now; m.t1 = now + (m.dur || 30e3); }
function arrive(u, m) {
    const res0 = { attackerWins: false };
    if (m.kind === 'city') {
        const city = world.cities[m.target]; if (!city || city.owner === u.username || city.shieldUntil > Date.now()) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name}: hedef değişti, sefer geri dönüyor.` }); return marchBack(m); }
        const owner = city.owner && users[city.owner]; city.defMix = city.defMix || {};
        const def = mixAdd({ n: city.garrison || 0 }, city.defMix); if (!def.n) delete def.n;
        const defMult = (1 + (city.bonus?.defense || 0)) * (owner ? defenseMult(owner) : 1);
        const r = battle(m.troops, attackMult(u), def, defMult, heroTM(u), owner ? heroTM(owner) : null);
        mixAdd(m.troops, r.aLost, -1); const hosp = sendToHospital(u, r.aLost); stat(u, 'kills', r.defenderLosses || 0); if (owner) { stat(owner, 'kills', r.attackerLosses || 0); if (!r.attackerWins) stat(owner, 'defends'); }
        city.garrison = Math.max(0, (city.garrison || 0) - (r.dLost.n || 0)); const pl = { ...r.dLost }; delete pl.n; mixAdd(city.defMix, pl, -1);
        if (owner && mixTotal(pl)) sendToHospital(owner, pl);
        if (r.attackerWins) {
            if (owner) { giveTroops(owner, city.defMix); emitTo(owner.username, 'toast', { type: 'defeat', msg: `${city.name} şehrini ${u.username} ele geçirdi!` }); marchReport(owner, 'Savaş Raporu', `${city.name} şehrini ${u.username} ele geçirdi.`); pushResources(owner.username); }
            city.owner = u.username; city.ownerClan = u.clan; city.empireColor = u.empireColor; city.defMix = {}; city.defenders = 0; city.garrison = 0; city.shieldUntil = Date.now() + SHIELD_DURATION; stat(u, 'cities');
            m.mats = randMats(6 + Math.round((city.baseGarrison || 1000) / 400), city.type === 'capital' ? 0.5 : 0.15);
            emitTo(u.username, 'toast', { type: 'victory', msg: `${city.name} ele geçirildi! (Kayıp: ${r.attackerLosses})` });
        } else {
            city.defenders = mixTotal(city.defMix);
            if (owner) emitTo(owner.username, 'toast', { type: 'success', msg: `${city.name} şehrin ${u.username} saldırısını püskürttü!` });
            emitTo(u.username, 'toast', { type: 'defeat', msg: `${city.name} savunması kırılamadı! (Kayıp: ${r.attackerLosses}, hastane: ${hosp.admitted})` });
        }
        questProgress(u, 'attack'); m.result = r; markDirty('world'); io.emit('battleAnimation', { cityId: city.id, characterId: u.character, attackerColor: u.empireColor, result: r }); broadcastWorld();
    } else if (m.kind === 'ter') { return terArrive(u, m);
    } else if (isSite(m.kind)) { return hallArrive(u, m); // kendi raporu + garnizon (arrive sonundaki dönüşe girmez)
    } else if (m.kind === 'mine') {
        const mine = world.mines[m.target]; if (!mine || mine.owner === u.username) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name}: hedef değişti, sefer geri dönüyor.` }); return marchBack(m); }
        const owner = mine.owner && users[mine.owner];
        const r = battle(m.troops, attackMult(u), { n: mine.guard || MINE_GUARD }, owner ? defenseMult(owner) : 1, heroTM(u));
        mixAdd(m.troops, r.aLost, -1); sendToHospital(u, r.aLost);
        if (r.attackerWins) {
            if (owner) { emitTo(owner.username, 'toast', { type: 'defeat', msg: `${mine.name} madenini ${u.username} ele geçirdi!` }); marchReport(owner, 'Savaş Raporu', `${mine.name} madenini ${u.username} ele geçirdi.`); }
            mine.owner = u.username; mine.empireColor = u.empireColor; mine.lastCollection = Date.now(); stat(u, 'mines'); m.mats = { steel: 3 + Math.floor(Math.random() * 4) };
            emitTo(u.username, 'toast', { type: 'victory', msg: `${mine.name} ele geçirildi! Dakikada ${mine.yield} ${mine.type === 'gold' ? 'Cash' : 'Metal'}.` });
        } else emitTo(u.username, 'toast', { type: 'defeat', msg: `${mine.name} savunuldu! (Kayıp: ${r.attackerLosses})` });
        questProgress(u, 'attack'); m.result = r; markDirty('world'); io.emit('battleAnimation', { cityId: mine.id, characterId: u.character, attackerColor: u.empireColor, result: r }); broadcastWorld();
    } else if (m.kind === 'boss') {
        const boss = world.bosses[m.target]; if (!boss || boss.defeated) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name} çoktan indirilmiş, sefer geri dönüyor.` }); return marchBack(m); }
        const dmg = Math.floor(sidePower(m.troops, { n: 1 }, attackMult(u), false, heroTM(u)) * 1.4 * (0.9 + Math.random() * 0.2));
        const lost = mixLoss(m.troops, mixTotal(m.troops) * 0.3); mixAdd(m.troops, lost, -1); sendToHospital(u, lost);
        boss.currentHp = Math.max(0, boss.currentHp - dmg); boss.attackers = boss.attackers || {}; boss.attackers[u.username] = (boss.attackers[u.username] || 0) + dmg; stat(u, 'boss'); stat(u, 'boss_' + boss.id);
        questProgress(u, 'boss'); m.mats = randMats(2 + Math.round(boss.reward / 25000), 0.05); m.items = { hero_medal: 1 };
        if (boss.currentHp <= 0) bossDown(boss);
        else emitTo(u.username, 'toast', { type: 'info', msg: `${boss.beast}'a ${dmg.toLocaleString('tr-TR')} hasar! (Kalan: ${boss.currentHp.toLocaleString('tr-TR')})` });
        m.result = { attackerWins: boss.defeated, atkPower: dmg, defPower: 0, attackerLosses: mixTotal(lost) };
        markDirty('world'); io.emit('battleAnimation', { cityId: boss.id, characterId: u.character, attackerColor: u.empireColor, result: m.result }); broadcastWorld();
    } else if (m.kind === 'res') {
        const t = (world.res || {})[m.target];
        if (!t || t.left <= 0) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name}: kaynak tükenmiş, sefer geri dönüyor.` }); return marchBack(m); }
        if (t.by && t.by !== u.username) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name}: noktada ${t.by} topluyor, sefer geri dönüyor.` }); return marchBack(m); }
        const cap = Math.floor(loadOf(m.troops) * (1 + lb(u, 'load'))), want = Math.min(cap, t.left), rate = gatherRate(u, t.type, t.lvl) * (1 + terGatherB(u, t.x, t.z)), ms = Math.max(5000, Math.round(want / rate * 60e3));
        t.by = u.username; m.state = 'gather'; m.gt = t.type; m.gwant = want; m.t0 = Date.now(); m.t1 = m.t0 + ms; m.dur0 = m.dur;
        emitTo(u.username, 'toast', { type: 'success', msg: `${m.name}: toplama başladı (${want.toLocaleString('tr-TR')} ${t.type === 'cash' ? 'Cash' : t.type === 'cargo' ? 'Cargo' : t.type === 'arms' ? 'Arms' : 'Metal'}, ${tfmtS(ms)})` });
        markDirty('world'); broadcastWorld(); return;
    } else if (m.kind === 'thug') {
        const th = (world.thugs || {})[m.target]; if (!th) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name}: çete dağılmış, sefer geri dönüyor.` }); return marchBack(m); }
        const r = battle(m.troops, attackMult(u), { n: th.guard }, 1 + th.lvl * 0.04, heroTM(u));
        mixAdd(m.troops, r.aLost, -1); sendToHospital(u, r.aLost);
        if (r.attackerWins) {
            delete world.thugs[th.id]; spawnThug(); u.st = u.st || {}; u.st.thugMax = Math.max(u.st.thugMax || 0, th.lvl); stat(u, 'thugs');
            m.loot = { cash: 1500 * th.lvl, cargo: 0, arms: 300 * th.lvl, metal: 500 * th.lvl }; m.mats = randMats(2 + th.lvl, 0.015 * th.lvl); if (th.lvl >= 3) m.items = { hero_medal: 1 + Math.floor(th.lvl / 5) };
            emitTo(u.username, 'toast', { type: 'victory', msg: `Sv. ${th.lvl} çete dağıtıldı! Ganimet ve malzeme dönüşte. (Kayıp: ${r.attackerLosses})` });
        } else { th.guard = Math.max(1, th.guard - (r.dLost.n || 0)); emitTo(u.username, 'toast', { type: 'defeat', msg: `Sv. ${th.lvl} çete direndi! Kalan muhafız ${th.guard} (Kayıp: ${r.attackerLosses})` }); }
        questProgress(u, 'attack'); m.result = r; markDirty('world'); io.emit('battleAnimation', { cityId: th.id, characterId: u.character, attackerColor: u.empireColor, result: r }); broadcastWorld();
    } else if (m.kind === 'player') {
        const t = users[m.target]; if (!t || !t.base || t.shieldUntil > Date.now() || sameClan(u, t)) { emitTo(u.username, 'toast', { type: 'info', msg: `${m.name}: hedef korumada ya da taşındı, sefer geri dönüyor.` }); return marchBack(m); }
        accrue(t); syncTroops(t);
        const wallGuard = bLevel(t, 'wall_main') * 200, def = mixAdd({ n: wallGuard }, t.troops); if (!def.n) delete def.n;
        const r = battle(m.troops, attackMult(u), def, defenseMult(t), heroTM(u), heroTM(t));
        mixAdd(m.troops, r.aLost, -1); sendToHospital(u, r.aLost);
        const pl = { ...r.dLost }; delete pl.n; mixAdd(t.troops, pl, -1); syncTroops(t); sendToHospital(t, pl);
        stat(u, 'kills', r.defenderLosses || 0); stat(t, 'kills', r.attackerLosses || 0); if (!r.attackerWins) stat(t, 'defends');
        const loot = { cash: 0, cargo: 0, arms: 0, metal: 0 };
        if (r.attackerWins) {
            const rate = Math.min(0.7, 0.25 + invBonus(u, 'plunder') + lb(u, 'plunder')), carry = Math.floor(loadOf(m.troops) * (1 + lb(u, 'load'))), prot = protectedAmount(t), avail = {}; let tot = 0;
            Object.keys(loot).forEach(k => { avail[k] = Math.floor(Math.max(0, (t[k] || 0) - prot) * rate); tot += avail[k]; });
            const sc = tot > carry ? carry / tot : 1; Object.keys(loot).forEach(k => { loot[k] = Math.floor(avail[k] * sc); t[k] -= loot[k]; });
            m.loot = loot; t.shieldUntil = Date.now() + RAID_SHIELD; stat(u, 'raids'); m.mats = randMats(5);
            emitTo(u.username, 'toast', { type: 'victory', msg: `${t.username} yağmalandı! ${costText(loot)} (dönüşte)` });
            emitTo(t.username, 'toast', { type: 'defeat', msg: `${u.username} üssünü yağmaladı! Kayıp: ${costText(loot)}` });
        } else {
            emitTo(u.username, 'toast', { type: 'defeat', msg: `${t.username} savunmayı tuttu! (Kayıp: ${r.attackerLosses})` });
            emitTo(t.username, 'toast', { type: 'success', msg: `${u.username} saldırısını püskürttün!` });
        }
        marchReport(t, 'Savaş Raporu', r.attackerWins ? `${u.username} üssünü yağmaladı. Kayıp asker: ${mixTotal(pl)}. Kaynak: ${costText(loot)}` : `${u.username} saldırısını püskürttün. Kayıp asker: ${mixTotal(pl)}.`);
        questProgress(u, 'attack'); m.result = r; io.emit('battleAnimation', { cityId: 'base_' + t.username, characterId: u.character, attackerColor: u.empireColor, result: r }); pushResources(t.username);
    }
    if (m.result) { addXP(u, (m.result.attackerWins ? 60 : 20) + (m.result.defenderLosses || 0) / 8 + (m.kind === 'boss' ? (m.result.atkPower || 0) / 400 : 0), true);
        if (m.kind === 'boss') evPoints(u, 'boss', (m.result.atkPower || 0) / 100 + (m.result.attackerWins ? 2000 : 0)); else evPoints(u, 'war', (m.result.defenderLosses || 0) * 3 + (m.result.attackerWins ? 150 : 0)); }
    marchReport(u, 'Savaş Raporu', `${m.name}: ${m.result && m.result.attackerWins ? 'Zafer' : 'Yenilgi'} — kayıp ${m.result ? m.result.attackerLosses || 0 : 0}, dönen ${mixTotal(m.troops)} asker.${m.mats ? ' Malzeme: ' + matText(m.mats) + '.' : ''}`);
    if (m.mats && !mixTotal(m.troops)) giveMats(u, m.mats); // kimse dönmese de malzeme kaybolmaz
    if (!mixTotal(m.troops)) { u.marches = u.marches.filter(x => x !== m); return; } // kimse kalmadı
    marchBack(m);
}
function homecoming(u, m) {
    giveTroops(u, m.troops); if (m.loot) Object.keys(m.loot).forEach(k => u[k] = (u[k] || 0) + (m.loot[k] || 0)); if (m.mats) giveMats(u, m.mats); if (m.items) giveItems(u, m.items);
    u.marches = (u.marches || []).filter(x => x !== m);
    emitTo(u.username, 'toast', { type: 'success', msg: `Sefer döndü: ${mixTotal(m.troops)} asker${m.loot ? ' + ' + costText(m.loot) : ''}${m.mats ? ' + ' + matText(m.mats) : ''}` });
    pushResources(u.username);
}
setInterval(() => {
    const now = Date.now(); let changed = false;
    Object.values(users).forEach(u => {
        if (u.train && now >= u.train.end) finishTrain(u, true);
        if (u.gear && u.gear.craft && now >= u.gear.craft.end) finishCraft(u, true);
        if (!u.marches || !u.marches.length) return;
        u.marches.slice().forEach(m => {
            try { if (m.kind === 'rally' && m.state !== 'back') { // baskın: katılan askerler liderin villasına varınca bekler; yürüyüşü baskının kendisi çözer
                      const L = users[m.rl]; if (!L || !L.rally || L.rally.id !== m.rid) { marchHome(u, m, m.state === 'join' || m.state === 'go' ? marchHere(m) : m.to); changed = true; markDirty('users'); return; }
                      if (m.state === 'join' && now >= m.t1) { m.state = 'wait'; m.t0 = m.t1; m.t1 = L.rally.launchAt; m.from = m.to; changed = true; markDirty('users'); emitTo(L.username, 'toast', { type: 'info', msg: `${u.username} baskına katıldı (${mixTotal(m.troops)} asker)` }); pushRallies(L.clan); }
                      return; }
                  if (m.state === 'gather') { if (now >= m.t1) { gatherEnd(u, m, false); changed = true; pushResources(u.username); } return; }
                  if (m.state === 'go' && now >= m.t1) { arrive(u, m); changed = true; markDirty('users'); pushResources(u.username); }
                  else if (m.state === 'back' && now >= m.t1) { homecoming(u, m); changed = true; markDirty('users'); } }
            catch (e) { console.error('sefer', e); u.marches = u.marches.filter(x => x !== m); giveTroops(u, m.troops || {}); }
        });
    });
    Object.values(users).forEach(L => { const R = L.rally; if (!R) return; // baskın zamanlayıcıları
        try { if (R.state === 'wait' && now >= R.launchAt) { rallyLaunch(L); changed = true; } else if (R.state === 'march' && now >= R.arriveAt) { rallyResolve(L); changed = true; } }
        catch (e) { console.error('baskın', e); L.rally = null; } });
    try { if (hallCheck()) changed = true; } catch (e) { console.error('belediye', e); }
    if (changed) broadcastMarches();
}, 1000);

// ── Sohbet (MC Şehir / Klan): bellekte son mesajlar ──
const chat = { world: [], clans: {} };
const chatLast = {};
function chatSys(clanId, text, ch) { if (!clanId || !clans[clanId]) return; const m = { from: 'Baskın', ch: ch || 'soulreaper', vip: 0, clan: clans[clanId].name, msg: text, t: Date.now(), sys: true }; const L = chat.clans[clanId] = chat.clans[clanId] || []; L.push(m); if (L.length > CHAT_MAX) L.shift(); (clans[clanId].members || []).forEach(un => emitTo(un, 'chatMsg', Object.assign({ chan: 'clan' }, m))); }

// ── Günlük giriş (7 gün art arda; bir gün kaçarsa 1. güne döner) ──
function dayKey(t) { const d = new Date(t + 3 * 3600e3); return d.toISOString().slice(0, 10); } // Türkiye saatiyle gün
function dailyLogin(u) {
    const today = dayKey(Date.now()), yest = dayKey(Date.now() - 24 * 3600e3), L = u.login;
    if (L && L.last === today) return;
    const day = L && L.last === yest ? (L.day % 7) + 1 : 1;
    u.login = { day, last: today, claimed: false }; markDirty('users');
}
function onlineTick(u) { // gün değiştiyse sıfırla
    const today = dayKey(Date.now());
    if (!u.onl || u.onl.day !== today) u.onl = { day: today, i: 0, left: ONLINE_REWARDS[0].min * 60e3, since: Date.now() };
    return u.onl;
}
function onlRem(u) { const o = onlineTick(u); return o.left - (o.since ? Date.now() - o.since : 0); }
function onlInfo(u) { const o = onlineTick(u); return { i: o.i, readyAt: o.i < ONLINE_REWARDS.length ? Date.now() + Math.max(0, onlRem(u)) : null }; }
// ── Işınlanma için uygun konum ──
function spotFree(u, x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 4700 || Math.abs(z) > 4700) return false;
    if (nearHall(x, z, 40)) return false;
    if (terBlock(u, x, z)) return false; // başka klanın bölgesi
    return !Object.values(users).some(o => o !== u && o.base && Math.hypot(o.base.x - x, o.base.z - z) < 320);
}
function moveBase(u, x, z) {
    u.base.x = x; u.base.z = z;
    (u.buildings || []).forEach(b => { const l = BASE_LAYOUT.find(q => q.id === b.id); if (l) { b.x = x + l.ox; b.z = z + l.oz; } });
}

// ═══════════════════════════════════════════
// SOCKET.IO EVENTLERİ
// ═══════════════════════════════════════════
io.on('connection', (socket) => {
    const me = () => { const un = sessions[socket.id]; return un ? users[un] : null; };
    const on = (ev, fn) => socket.on(ev, (data) => { try { fn(data || {}); } catch (e) { console.error(`❌ [${ev}]`, e); socket.emit('error', 'Sunucu hatası.'); } });

    function startSession(username) {
        const u = users[username]; migrateUser(u); accrue(u); checkQuestReset(u); dailyLogin(u);
        { const o = onlineTick(u); if (!o.since) o.since = Date.now(); } if (u.build && Date.now() >= u.build.end) finishBuild(u, false); syncHeroes(u, false);
        sessions[socket.id] = username; markDirty('users');
        // önce dünya verileri, sonra oyuncu — istemci girişte haritayı hemen çizebilsin
        socket.emit('charactersData', CHARACTERS); socket.emit('clansData', clans); socket.emit('worldData', world);
        socket.emit('catalogData', { items: ITEMS, daily: DAILY_REWARDS, vipPoints: VIP_POINTS, vipPerks: VIP_PERKS, vipMax: VIP_MAX, wheel: WHEEL, wheelCost: WHEEL_COST, main: MAIN_QUESTS, online: ONLINE_REWARDS, troops: TROOPS, tier: TIER, wpos: WPOS, marchSpeed: MARCH_SPEED, story: STORY, talents: TALENTS, confidants: CONFIDANTS, confMax: CONF_MAX, confSkills: CONF_SKILLS, confOutfits: CONF_OUTFITS, confRoses: CONF_ROSES, events: EVENTS, evReward: EV_REWARD, evRank: EV_RANK, rallyWaits: RALLY_WAITS, rallyBonus: RALLY_BONUS, npcUnit: NPC_UNIT, tierUnlock: TIER_UNLOCK, cas: { tiers: CAS_TIERS, rew: CAS_REW, rank: CAS_RANK, clan: CAS_CLAN, shop: CAS_SHOP, syms: CAS_SYMS, train: CAS_TRAIN, fisPts: CAS_FIS_PTS, daily: CAS_DAILY, red: [...CAS_RED], period: CAS_PERIOD, active: CAS_ACTIVE, epoch: CAS_EPOCH }, ach: { defs: ACH, cats: ACH_CATS, gold: ACH_GOLD, pts: ACH_PTS, ranks: ACH_RANKS, fx: ACH_FX }, ter: { defs: TER, towers: TER_TOWERS, tpCd: TER_TP_CD, buildK: TER_BUILD_K, repair: TER_REPAIR, calm: TER_CALM }, lights: { defs: LIGHTS, max: LIGHT_MAX, repair: LIGHT_REPAIR, need: Array.from({ length: LIGHT_MAX }, (_, i) => lightNeed(i + 1)), decay: Array.from({ length: LIGHT_MAX }, (_, i) => lightDecay(i + 1)) }, hall: hallCat(), skins: SKINS, skinSet: SKIN_SET, ctech: CTECH, ctMax: CT_MAX, cshop: CSHOP, heroSkill: HERO_SKILL, starCost: STAR_COST, cars: CARS, parts: PARTS, gear: { slots: GEAR_SLOTS, tiers: GEAR_TIERS, q: GEAR_Q, val: GEAR_VAL, set: GEAR_SET, enhMax: GEAR_ENH_MAX, invMax: GEAR_INV_MAX, pity: GEAR_PITY, mats: MATS } });
        socket.emit('marches', allMarches());
        socket.emit('chatHistory', { world: chat.world.slice(-30), clan: u.clan ? (chat.clans[u.clan] || []).slice(-30) : [] });
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
    on('trainArmy', (data) => { // MC: tür + kademe; kampta süreli eğitim (tek kuyruk); instant = altınla hemen
        const u = me(); if (!u) return; accrue(u); if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        const key = isTroopKey(data.key) ? data.key : 'k1', l = +key.slice(1), n = int(data.amount ?? data.total);
        if (!n) return socket.emit('error', 'Eğitilecek asker sayısını gir!');
        if (!tierUnlocked(u, l)) return socket.emit('error', bLevel(u, 'camp_main') < TIER.camp[l - 1] ? `Bu kademe için Eğitim Kampı Sv. ${TIER.camp[l - 1]} gerekli.` : `T${l} için önce elit kilidi aç (Eğitim › T${l}).`);
        const cap = trainCap(u); if (n > cap) return socket.emit('error', `Tek seferde en fazla ${cap} asker eğitebilirsin. Eğitim Kampı'nı yükselt.`);
        if (u.train && Date.now() >= u.train.end) finishTrain(u, true);
        if (u.train) return socket.emit('error', 'Kamp meşgul: önce süren eğitim bitmeli.');
        const cost = trainCostOf(u, key, n); if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz kaynak! Gerekli: ${costText(cost)}`);
        const dur = trainSeconds(u, l, n) * 1000, g = data.instant ? instantGold(dur) : 0;
        if (g && (u.gold || 0) < g) return socket.emit('error', `Yetersiz altın! Gerekli: ${g}`);
        pay(u, cost); if (g) u.gold -= g;
        u.train = { key, n, start: Date.now(), end: Date.now() + dur, dur };
        if (data.instant || dur <= 2000) return finishTrain(u, true);
        markDirty('users'); socket.emit('trainStarted', u.train); pushResources(u.username);
    });
    on('healArmy', (data) => { // hastanedeki yaralılar: kademe başı tedavi ücreti; oransal
        const u = me(); if (!u) return; accrue(u); syncTroops(u);
        const want = Math.min(int(data.amount ?? data.infantry), u.hospital.infantry || 0); if (!want) return socket.emit('error', 'Hastanede iyileştirilecek asker yok.');
        const pick = mixTake({ ...u.hospital.mix }, want); let c = 0; for (const k in pick) c += pick[k] * TIER.heal[+k.slice(1) - 1]; c = Math.ceil(c * Math.max(0.5, 1 - lb(u, 'heal')));
        const cost = { cash: c }; if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz Cash! Gerekli: ${costText(cost)}`);
        pay(u, cost); mixAdd(u.hospital.mix, pick, -1); giveTroops(u, pick); markDirty('users'); pushResources(u.username);
        socket.emit('toast', { type: 'success', msg: `${mixTotal(pick)} asker iyileştirildi!` });
    });

    // ── Sefer başlat (şehir / maden / bounty / oyuncu): birlikler yola çıkar, varınca savaş ──
    function startMarch(u, kind, target, name, data) {
        if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        u.marches = u.marches || [];
        if (u.marches.length >= marchSlots(u)) return socket.emit('error', `Sefer sınırı dolu (${marchSlots(u)}). Villa Sv. 6/12/20'de yeni sefer hakkı açılır.`);
        if (['player', 'city', 'mine', 'hall', 'fort', 'light', 'ter', 'casino'].includes(kind) && (u.noAtk || 0) > Date.now() && !(kind === 'ter' ? terFriendly(siteGet(kind, target), u) : (world.hall && siteGet(kind, target) && siteFriendly(siteGet(kind, target), u)))) return socket.emit('error', `Belediye ateşkes emri: ${Math.ceil((u.noAtk - Date.now()) / 60000)} dk saldırı seferi çıkaramazsın.`);
        syncTroops(u);
        let mix = data.troops && typeof data.troops === 'object' ? cleanMix(data.troops, u.troops) : null;
        if (!mix || !mixTotal(mix)) { const n = int(data.army?.total ?? data.total ?? data.amount); mix = mixTake({ ...u.troops }, n); } // eski istemci: toplam sayı
        const n = mixTotal(mix); if (!n) return socket.emit('error', 'Gönderilecek asker seç!');
        const cap = crimeOps(u); if (n > cap) return socket.emit('error', `Sefer kapasiten ${cap}. Lokantayı yükselterek artır.`);
        const to = targetPos(kind, target); if (!to) return socket.emit('error', 'Hedef bulunamadı.');
        if (kind === 'player' && u.shieldUntil > Date.now()) { u.shieldUntil = 0; socket.emit('toast', { type: 'info', msg: 'Saldırıya geçtiğin için kalkanın kalktı.' }); }
        const from = { x: u.base.x, z: u.base.z }, dist = Math.hypot(to.x - from.x, to.z - from.z);
        const dur = Math.round(Math.min(MARCH_MAX, Math.max(MARCH_MIN, dist / marchSpeed(mix, u) * 1000)));
        mixAdd(u.troops, mix, -1); syncTroops(u);
        const m = { id: 'm' + (marchSeq++) + Date.now().toString(36), kind, target, name, troops: mix, from, to, t0: Date.now(), t1: Date.now() + dur, dur, state: 'go', lead: leadType(mix) };
        u.marches.push(m); markDirty('users');
        if (kind === 'player' && users[target]) emitTo(target, 'incoming', { from: u.username, at: m.t1, n }); // radar uyarısı
        socket.emit('marchStarted', marchPublic(u, m, true));
        pushResources(u.username); broadcastMarches();
    }
    on('attackCity', (data) => {
        const u = me(); if (!u) return; const city = world.cities[data.cityId]; if (!city) return socket.emit('error', 'Şehir bulunamadı.');
        if (city.owner === u.username) return socket.emit('error', 'Bu şehir zaten senin!');
        const owner = city.owner && users[city.owner]; if (owner && sameClan(u, owner)) return socket.emit('error', 'Klan arkadaşının şehrine saldıramazsın!');
        if (city.shieldUntil > Date.now()) return socket.emit('error', `Şehir kalkanlı! (${Math.ceil((city.shieldUntil - Date.now()) / 60000)} dk)`);
        startMarch(u, 'city', city.id, city.name, data);
    });
    on('occupyMine', (data) => {
        const u = me(); if (!u) return; const mine = world.mines[data.mineId]; if (!mine) return socket.emit('error', 'Maden bulunamadı.');
        if (mine.owner === u.username) return socket.emit('error', 'Bu maden zaten senin!');
        const owner = mine.owner && users[mine.owner]; if (owner && sameClan(u, owner)) return socket.emit('error', 'Klan arkadaşının madenine saldıramazsın!');
        startMarch(u, 'mine', mine.id, mine.name, data);
    });
    on('attackBoss', (data) => {
        const u = me(); if (!u) return; const boss = world.bosses[data.bossId]; if (!boss || boss.defeated) return socket.emit('error', 'Hedef şu an yok!');
        startMarch(u, 'boss', boss.id, boss.beast, data);
    });
    on('gatherRes', (data) => {
        const u = me(); if (!u) return; const t = (world.res || {})[data.id]; if (!t) return socket.emit('error', 'Bu kaynak noktası tükenmiş.');
        if (t.by && t.by !== u.username) return socket.emit('error', `Bu noktada ${t.by} topluyor.`);
        if ((u.marches || []).some(m => m.kind === 'res' && m.target === t.id)) return socket.emit('error', 'Bu noktaya zaten seferin var.');
        startMarch(u, 'res', t.id, `Sv. ${t.lvl} ${({ cash: 'Cash', cargo: 'Cargo', arms: 'Arms', metal: 'Metal' })[t.type]} Noktası`, data);
    });
    on('attackThug', (data) => {
        const u = me(); if (!u) return; const th = (world.thugs || {})[data.id]; if (!th) return socket.emit('error', 'Bu çete dağılmış.');
        const top = (u.st || {}).thugMax || 0; if (th.lvl > top + 1) return socket.emit('error', `Önce Sv. ${top + 1} bir çeteyi yenmelisin.`);
        startMarch(u, 'thug', th.id, `Sv. ${th.lvl} Çete`, data);
    });
    on('attackPlayer', (data) => {
        const u = me(); if (!u) return; const t = users[data.target]; if (!t || !t.base) return socket.emit('error', 'Hedef üs bulunamadı.');
        if (t.username === u.username) return socket.emit('error', 'Kendine saldıramazsın!');
        if (sameClan(u, t)) return socket.emit('error', 'Klan arkadaşına saldıramazsın!');
        if (t.shieldUntil > Date.now()) return socket.emit('error', `${t.username} kalkan altında! (${Math.ceil((t.shieldUntil - Date.now()) / 60000)} dk)`);
        startMarch(u, 'player', t.username, t.username, data);
    });
    on('recallMarch', (data) => { // yoldaki seferi geri çağır: bulunduğu noktadan geri döner
        const u = me(); if (!u) return; const m = (u.marches || []).find(x => x.id === data.id); if (!m) return socket.emit('error', 'Sefer bulunamadı.');
        if (m.kind === 'rally') { // katılımı geri çek (lider kendi askerini çekerse baskın dağılır)
            const L = users[m.rl]; if (m.state === 'back') return socket.emit('error', 'Sefer zaten dönüyor.'); if (m.state === 'go') return socket.emit('error', 'Baskın yola çıktı, geri çağrılamaz.');
            if (L && L.rally && L.rally.id === m.rid && L === u) return rallyDisband(L, 'lider iptal etti');
            marchHome(u, m, m.state === 'join' ? marchHere(m) : m.to); markDirty('users'); socket.emit('toast', { type: 'info', msg: 'Baskından çekildin.' }); pushResources(u.username); broadcastMarches(); if (L) pushRallies(L.clan); return;
        }
        if (m.state === 'gather') { gatherEnd(u, m, true); pushResources(u.username); broadcastMarches(); return; }
        if (m.state === 'station') { siteLeave(u, m); socket.emit('toast', { type: 'info', msg: `${m.name} garnizonundan çekildin.` }); pushResources(u.username); broadcastMarches(); return; }
        if (m.state !== 'go') return socket.emit('error', 'Sefer zaten dönüyor.');
        const now = Date.now(), k = Math.min(1, (now - m.t0) / Math.max(1, m.t1 - m.t0));
        m.to = { x: Math.round(m.from.x + (m.to.x - m.from.x) * k), z: Math.round(m.from.z + (m.to.z - m.from.z) * k) };
        m.state = 'back'; m.t1 = now + Math.max(2000, now - m.t0); m.t0 = now; m.recalled = true; markDirty('users');
        if (m.kind === 'player' && users[m.target]) emitTo(m.target, 'incoming', { from: u.username, at: 0, n: 0, cancel: true });
        socket.emit('toast', { type: 'info', msg: `Sefer geri çağrıldı: ${m.name}` }); pushResources(u.username); broadcastMarches();
    });
    on('deployDefenders', (data) => {
        const u = me(); if (!u) return; const city = world.cities[data.cityId];
        if (!city || city.owner !== u.username) return socket.emit('error', 'Şehir senin değil!');
        syncTroops(u); let mix = data.troops ? cleanMix(data.troops, u.troops) : mixTake({ ...u.troops }, int(data.total ?? data.amount));
        const n = mixTotal(mix); if (!n) return socket.emit('error', 'Yerleştirilecek asker seç!');
        mixAdd(u.troops, mix, -1); syncTroops(u); city.defMix = mixAdd(city.defMix || {}, mix); city.defenders = mixTotal(city.defMix);
        markDirty('users'); markDirty('world'); socket.emit('toast', { type: 'success', msg: `${city.name} şehrine ${n} asker yerleştirildi.` }); broadcastWorld(); pushResources(u.username);
    });
    on('recallDefenders', (data) => {
        const u = me(); if (!u) return; const city = world.cities[data.cityId];
        if (!city || city.owner !== u.username) return socket.emit('error', 'Şehir senin değil!');
        const n = mixTotal(city.defMix); if (!n) return socket.emit('error', 'Şehirde askerin yok.');
        giveTroops(u, city.defMix); city.defMix = {}; city.defenders = 0; markDirty('users'); markDirty('world');
        socket.emit('toast', { type: 'success', msg: `${n} asker üsse döndü.` }); broadcastWorld(); pushResources(u.username);
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
        (u.marches || []).filter(m => m.state === 'station').forEach(m => siteLeave(u, m)); broadcastMarches();
        Object.values(world.cities).forEach(x => { if (x.owner === u.username) x.ownerClan = null; }); markDirty('world');
        io.emit('clansData', clans); socket.emit('resourcesUpdate', { clan: null });
        socket.emit('toast', { type: 'info', msg: 'Klandan ayrıldın.' });
    });

    // ── Sıralama / Profil / Görevler ──
    on('getLeaderboard', () => {
        const arr = Object.values(users).filter(p => p.verified).map(p => ({
            username: p.username, power: calculatePlayerPower(p), clan: p.clan, empireColor: p.empireColor, character: p.character, skin: (p.skins && p.skins.on) || null, ach: (p.ach && p.ach.pts) || 0, rank: achRank(p),
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
        q.claimed = true; u.cash += q.reward; u.gold = (u.gold || 0) + 20; markDirty('users');
        pushResources(u.username);
        socket.emit('toast', { type: 'success', msg: `Ödül alındı: ${q.reward.toLocaleString('tr-TR')} Cash + 20 Altın!` });
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
        if (nearHall(x, z, 40)) return socket.emit('error', 'Belediye Sarayı bölgesine üs kurulamaz.');
        if (terBlock(u, x, z)) return socket.emit('error', 'Bir klanın bölgesine üs kurulamaz.');
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

    // inşaatı başlat (kaynak baştan ödenir); instant: altınla hemen bitir (MC "Hemen Yükselt")
    function startBuild(u, id, kind, from, cost, instant) {
        if (u.build && Date.now() >= u.build.end) finishBuild(u, true);
        if (u.build) return socket.emit('error', `İnşaat ekibi meşgul: ${BNAME[u.build.kind] || 'Bina'} Sv. ${u.build.to} yapılıyor.`);
        if (!canAfford(u, cost)) return socket.emit('error', `Yetersiz kaynak! Gerekli: ${costText(cost)}`);
        const dur = Math.round(buildTime(kind, from) * Math.max(0.5, 1 - lb(u, 'build'))), g = instant ? instantGold(dur) : 0;
        if (g && (u.gold || 0) < g) return socket.emit('error', `Yetersiz altın! Gerekli: ${g}`);
        pay(u, cost); if (g) u.gold -= g;
        u.build = { id, kind, to: from + 1, start: Date.now(), end: Date.now() + dur, dur, helps: [] };
        if (u.clan && clans[u.clan]) (clans[u.clan].members || []).forEach(n => n !== u.username && emitTo(n, 'helpReq', { u: u.username }));
        if (instant || dur <= 2000) return finishBuild(u, true);
        markDirty('users'); socket.emit('buildStarted', u.build); pushResources(u.username);
    }
    function upgradeMansion(data) {
        const u = me(); if (!u) return; if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        accrue(u);
        const lvl = u.base.level || 1;
        if (lvl >= MAX_LEVEL) return socket.emit('error', 'Villa maksimum seviyede!');
        const wall = bLevel(u, 'wall_main');
        if (wall < lvl) return socket.emit('error', `Önce Duvarı Sv. ${lvl} yapmalısın! (Şu an Sv. ${wall})`);
        startBuild(u, 'mansion', 'mansion', lvl, upCostFor(u, 'mansion', lvl), !!(data && data.instant));
    }
    on('upgradeBase', upgradeMansion);

    on('upgradeBuilding', (data) => {
        if (data.kind === 'mansion' || data.id === 'mansion') return upgradeMansion(data);
        const u = me(); if (!u) return; if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        accrue(u);
        // id'si bilinmeyen eski istekler için aynı türdeki en düşük seviyeli binayı seç
        let b = u.buildings.find(x => x.id === data.id);
        if (!b && data.kind) b = u.buildings.filter(x => x.kind === data.kind).sort((a, c) => a.level - c.level)[0];
        if (!b) return socket.emit('error', 'Bina bulunamadı.');
        const mansionLvl = u.base.level || 1;
        if (b.level >= MAX_LEVEL) return socket.emit('error', 'Bina maksimum seviyede!');
        if (b.level >= mansionLvl) return socket.emit('error', `Önce Mansion'ı Lv ${b.level + 1} yapmalısın!`);
        startBuild(u, b.id, b.kind, b.level, upCostFor(u, b.kind, b.level), !!data.instant);
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

    // ── Çanta / eşya kullan ──
    function applyItem(u, id, n, data) {
        const it = ITEMS[id], now = Date.now(); let msg = '';
        if (it.give) { Object.entries(it.give).forEach(([r, v]) => u[r] = (u[r] || 0) + v * n); msg = costText(Object.fromEntries(Object.entries(it.give).map(([r, v]) => [r, v * n]))); }
        if (it.medal) return 'Madalyayı Kahramanlar sayfasında yıldız yükseltmek için kullan.';
        if (it.skinFrag) return 'Parçaları Villa › Görünüm sayfasında birleştir.';
        if (it.diceItem) return 'Sihirli Zarı Etkinlik › Zar Turu\'nda at.';
        if (it.skinBox) { const got = {}; for (let i = 0; i < n; i++) { const k = 'sf_' + skinFragPick(); got[k] = (got[k] || 0) + it.skinBox; } giveItems(u, got); msg = Object.entries(got).map(([k, v]) => ITEMS[k].name + ' ×' + v).join(', '); }
        if (it.mats) { const m = {}; for (const k in it.mats) m[k] = it.mats[k] * n; giveMats(u, m); msg = matText(m); }
        if (it.vip) { const up = addVip(u, it.vip * n); msg = `+${(it.vip * n).toLocaleString('tr-TR')} VIP puanı` + (up ? ` — VIP ${up}!` : ''); }
        if (it.vipAct) { u.vipActiveUntil = Math.max(u.vipActiveUntil || 0, now) + it.vipAct * n; msg = 'VIP aktif'; }
        if (it.buff) { u.buffs = u.buffs || {}; u.buffs[it.buff[0]] = Math.max(u.buffs[it.buff[0]] || 0, now) + it.buff[1] * n; msg = it.name + ' etkin'; }
        if (it.shield) { u.shieldUntil = Math.max(u.shieldUntil || 0, now) + it.shield * n; msg = 'Kalkan açıldı'; }
        if (it.crew) { const k = 'k' + Math.min(5, bestTier(u)); /* asker kartı elit kademe vermez */ giveTroops(u, { [k]: it.crew * n }); msg = `+${it.crew * n} ${TROOPS.k.tiers[+k.slice(1) - 1]}`; }
        if (it.speed) { // önce inşaat, yoksa eğitim (data.target ile seçilebilir)
            const cr = data && data.target === 'craft' && u.gear && u.gear.craft ? u.gear.craft : null;
            const tr = !cr && (data && data.target === 'train' ? !!u.train : !u.build && !!u.train), J = cr || (tr ? u.train : u.build);
            if (!J) return 'Hızlandırılacak inşaat ya da eğitim yok.'; J.end -= it.speed * n; msg = cr ? 'Üretim hızlandı' : tr ? 'Eğitim hızlandı' : 'İnşaat hızlandı';
            if (J.end <= now) setTimeout(() => cr ? (u.gear.craft && finishCraft(u, true)) : tr ? (u.train && finishTrain(u, true)) : (u.build && finishBuild(u, true)), 50); else socket.emit(cr ? 'craftStarted' : tr ? 'trainStarted' : 'buildStarted', J); }
        if (it.heal) { syncTroops(u); const h = Math.min(it.heal * n, u.hospital.infantry || 0); if (!h) return 'Hastanede yaralı yok.'; const pick = mixTake(u.hospital.mix, h); giveTroops(u, pick); msg = `${h} asker iyileşti`; }
        if (it.tele) {
            if (!u.base) return 'Önce üssünü kur!';
            if ((u.marches || []).length) return 'Seferdeki birliklerin dönmeden villanı taşıyamazsın.';
            let x, z;
            if (it.tele === 'pick') { x = Math.round(Number(data.x)); z = Math.round(Number(data.z)); if (!spotFree(u, x, z)) return terBlock(u, x, z) ? 'Başka bir klanın bölgesine ışınlanamazsın.' : 'Bu konum uygun değil (başka bir üsse çok yakın ya da harita dışında).'; }
            else { for (let k = 0; k < 3000; k++) { const a = Math.random() * 6.283, r = 500 + Math.random() * 3800; const tx = Math.round(Math.cos(a) * r / 20) * 20, tz = Math.round(Math.sin(a) * r / 20) * 20; if (spotFree(u, tx, tz)) { x = tx; z = tz; break; } } if (x === undefined) return 'Uygun yer bulunamadı, tekrar dene.'; }
            moveBase(u, x, z); socket.emit('baseMoved', u.base); msg = `Villa taşındı (X ${Math.round((x + 5000) / 10)}, Y ${Math.round((z + 5000) / 10)})`;
        }
        return { ok: msg };
    }
    on('useItem', (data) => {
        const u = me(); if (!u) return; accrue(u);
        const id = String(data.id || ''), it = ITEMS[id]; if (!it) return socket.emit('error', 'Eşya bulunamadı.');
        const have = (u.bag || {})[id] || 0, n = it.tele ? 1 : Math.max(1, Math.min(int(data.n) || 1, have));
        if (have < n) return socket.emit('error', 'Bu eşyadan yok.');
        const r = applyItem(u, id, n, data); if (typeof r === 'string') return socket.emit('error', r);
        u.bag[id] -= n; if (u.bag[id] <= 0) delete u.bag[id]; markDirty('users');
        socket.emit('itemUsed', { id, n }); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: 'success', msg: `${it.name}${n > 1 ? ' ×' + n : ''}: ${r.ok}` });
    });
    on('buyItem', (data) => { // altın oyun içinde kazanılır (giriş, görev, boss, villa); gerçek para yok
        const u = me(); if (!u) return; accrue(u);
        const id = String(data.id || ''), it = ITEMS[id]; if (!it || !it.gold) return socket.emit('error', 'Bu eşya satılmıyor.');
        const n = it.tele ? 1 : Math.max(1, Math.min(int(data.n) || 1, 99)), cost = it.gold * n;
        if ((u.gold || 0) < cost) return socket.emit('error', `Yetersiz altın! Gerekli: ${cost}`);
        if (data.use) { const r = applyItem(u, id, n, data); if (typeof r === 'string') return socket.emit('error', r); u.gold -= cost; socket.emit('toast', { type: 'success', msg: `${it.name}${n > 1 ? ' ×' + n : ''}: ${r.ok} (-${cost} altın)` }); socket.emit('itemUsed', { id, n }); }
        else { u.gold -= cost; giveItems(u, { [id]: n }); socket.emit('toast', { type: 'success', msg: `${it.name}${n > 1 ? ' ×' + n : ''} çantana eklendi (-${cost} altın)` }); }
        markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
    });
    on('claimDaily', () => {
        const u = me(); if (!u) return; dailyLogin(u);
        if (!u.login || u.login.claimed) return socket.emit('error', 'Bugünün ödülü zaten alındı.');
        const r = DAILY_REWARDS[(u.login.day - 1) % 7]; giveItems(u, r.items); if (r.gold) u.gold = (u.gold || 0) + r.gold;
        u.login.claimed = true; addXP(u, 50, true); markDirty('users');
        socket.emit('dailyClaimed', { day: u.login.day, reward: r }); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: 'victory', msg: `${u.login.day}. gün giriş ödülü çantana eklendi!` });
    });
    on('claimVipChest', () => { // VIP aktifken günde bir altın sandığı
        const u = me(); if (!u) return; if (!vipActive(u)) return socket.emit('error', 'VIP aktif değil.');
        const today = dayKey(Date.now()); if (u.vipChestDay === today) return socket.emit('error', 'Bugünkü VIP sandığı alındı.');
        const g = VIP_PERKS.daily[vipLevel(u)] || 0; u.gold = (u.gold || 0) + g; u.vipChestDay = today; markDirty('users');
        pushResources(u.username); socket.emit('profileData', publicPlayer(u)); socket.emit('toast', { type: 'victory', msg: `VIP sandığı: +${g} altın` });
    });

    on('spinWheel', () => { // günde 1 bedava, sonrası altın
        const u = me(); if (!u) return; const today = dayKey(Date.now()), free = u.spinDay !== today;
        if (!free && (u.gold || 0) < WHEEL_COST) return socket.emit('error', `Yetersiz altın! (${WHEEL_COST})`);
        if (free) u.spinDay = today; else u.gold -= WHEEL_COST;
        const tot = WHEEL.reduce((a, r) => a + r.w, 0); let x = Math.random() * tot, idx = 0; for (; idx < WHEEL.length - 1; idx++) { x -= WHEEL[idx].w; if (x < 0) break; }
        const r = WHEEL[idx]; giveItems(u, r.items); if (r.gold) u.gold = (u.gold || 0) + r.gold; markDirty('users');
        socket.emit('wheelResult', { idx, reward: r, free }); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
    });
    on('claimMain', (data) => {
        const u = me(); if (!u) return; const q = MAIN_QUESTS.find(x => x.id === data.id); if (!q) return socket.emit('error', 'Görev yok.');
        if ((u.mainDone || {})[q.id]) return socket.emit('error', 'Ödül zaten alındı.');
        if (!u.base || (u.base.level || 1) < q.lvl) return socket.emit('error', `Önce Villayı Sv. ${q.lvl} yap.`);
        u.mainDone[q.id] = true; u.gold = (u.gold || 0) + q.gold; giveItems(u, q.items); addXP(u, 30 * q.lvl, true); markDirty('users');
        pushResources(u.username); socket.emit('profileData', publicPlayer(u)); socket.emit('toast', { type: 'victory', msg: `Gelişim görevi: Villa Sv. ${q.lvl} — +${q.gold} altın ve eşyalar çantada!` });
    });
    on('speedUp', (data) => { // target: build | train ; mode: free (≤ ücretsiz sınır), gold (dk başı 1 altın), item (hızlandırma eşyası, buy = altınla al)
        const u = me(); if (!u) return; const tg = data.target === 'train' ? 'train' : data.target === 'craft' ? 'craft' : 'build', tr = tg === 'train';
        const J = tg === 'train' ? u.train : tg === 'craft' ? (u.gear && u.gear.craft) : u.build, fin = tg === 'train' ? finishTrain : tg === 'craft' ? finishCraft : finishBuild;
        if (!J) return socket.emit('error', tg === 'train' ? 'Süren eğitim yok.' : tg === 'craft' ? 'Atölyede süren üretim yok.' : 'Devam eden inşaat yok.');
        const rem = J.end - Date.now(); if (rem <= 0) return fin(u, true);
        if (data.mode === 'free') { if (rem > freeMs(u) + 1500) return socket.emit('error', 'Kalan süre ücretsiz hızlandırma sınırından uzun.'); return fin(u, true); }
        if (data.mode === 'gold') { const g = instantGold(rem); if ((u.gold || 0) < g) return socket.emit('error', `Yetersiz altın! Gerekli: ${g}`); u.gold -= g; return fin(u, true); }
        const id = String(data.item || ''), it = ITEMS[id]; if (!it || !it.speed) return socket.emit('error', 'Bu eşya hızlandırma değil.');
        const have = (u.bag || {})[id] || 0, buy = !!data.buy, n = Math.max(1, Math.min(int(data.n) || 1, buy ? 99 : have));
        if (buy) { const c = it.gold * n; if ((u.gold || 0) < c) return socket.emit('error', `Yetersiz altın! Gerekli: ${c}`); u.gold -= c; }
        else { if (have < n) return socket.emit('error', 'Bu eşyadan yok.'); u.bag[id] -= n; if (u.bag[id] <= 0) delete u.bag[id]; }
        J.end -= it.speed * n; if (tg === 'build') evPoints(u, 'build', it.speed * n / 300e3 * 10); markDirty('users');
        if (J.end <= Date.now()) return fin(u, true);
        socket.emit(tg === 'train' ? 'trainStarted' : tg === 'craft' ? 'craftStarted' : 'buildStarted', J); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
    });
    on('claimChapter', () => { // bütün görevler bitince bölüm ödülü + sonraki bölüm
        const u = me(); if (!u) return; const info = storyInfo(u); if (info.done) return socket.emit('error', 'Bütün bölümler tamamlandı.');
        if (!info.ready) return socket.emit('error', 'Bölüm görevleri henüz bitmedi.');
        const S = STORY.find(x => x.id === info.ch); u.gold = (u.gold || 0) + (S.reward.gold || 0); giveItems(u, S.reward.items);
        u.story = { ch: info.ch + 1 }; addXP(u, 200 * info.ch, true); markDirty('users');
        socket.emit('chapterDone', { ch: info.ch, reward: S.reward }); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
    });
    on('learnTalent', (data) => {
        const u = me(); if (!u) return; const L = lead(u), d = TALDEF[data.id]; if (!d) return socket.emit('error', 'Yetenek yok.');
        if (L.pts <= 0) return socket.emit('error', 'Yetenek puanın yok. Lider seviyesi atlayınca puan kazanırsın.');
        if ((L.tal[d.id] || 0) >= d.max) return socket.emit('error', 'Bu yetenek en üst seviyede.');
        L.tal[d.id] = (L.tal[d.id] || 0) + 1; L.pts--; markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
    });
    on('resetTalents', () => { // 100 altın: bütün puanlar geri
        const u = me(); if (!u) return; const L = lead(u); const spent = Object.values(L.tal).reduce((a, b) => a + b, 0); if (!spent) return socket.emit('error', 'Dağıtılmış puan yok.');
        if ((u.gold || 0) < 100) return socket.emit('error', 'Yetersiz altın! (100)'); u.gold -= 100; L.tal = {}; L.pts += spent; markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: 'success', msg: `Yetenekler sıfırlandı: ${spent} puan geri geldi.` });
    });
    on('confTalk', (data) => { // günde 3 sohbet; iyi cevap daha çok yakınlık
        const u = me(); if (!u) return; const k = String(data.id || ''); if (!CONFIDANTS[k]) return; const c = conf(u);
        if (!confOpen(u, k)) return socket.emit('error', `Villa Sv. ${CONFIDANTS[k].unlock}'te tanışırsın.`); if (c.talk <= 0) return socket.emit('error', 'Bugünkü sohbet hakların bitti.');
        c.talk--; const g = data.good ? 30 : 12, up = addFavor(u, k, g); markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: up ? 'victory' : 'success', msg: `${CONFIDANTS[k].name}: yakınlık +${g}${up ? ` — seviye ${c[k].lvl}!` : ''}` });
    });
    on('confGameStart', (data) => { // elmas oyunu: sunucu başlangıç kabını ve karıştırmayı belirler
        const u = me(); if (!u) return; const k = String(data.id || ''); if (!CONFIDANTS[k] || !confOpen(u, k)) return; const c = conf(u);
        let paid = false; if (c.game <= 0) { if (!((u.bag || {}).gift_rose > 0)) return socket.emit('error', 'Bugünkü ücretsiz oyunların bitti. Yeni oyun için 1 Gül Buketi gerekir.'); u.bag.gift_rose--; if (u.bag.gift_rose <= 0) delete u.bag.gift_rose; paid = true; }
        const start = Math.floor(Math.random() * 3), swaps = []; let pos = start; const N = 6 + Math.floor(Math.random() * 4);
        for (let i = 0; i < N; i++) { const a = Math.floor(Math.random() * 3); let b = Math.floor(Math.random() * 2); if (b >= a) b++; swaps.push([a, b]); if (pos === a) pos = b; else if (pos === b) pos = a; }
        c.cur = { k, pos, at: Date.now() }; if (!paid) c.game--; markDirty('users'); socket.emit('confGame', { id: k, start, swaps, streak: c.streak || 0, next: cupFav(c.streak || 0) }); if (paid) pushResources(u.username);
    });
    on('confGamePick', (data) => {
        const u = me(); if (!u) return; const c = conf(u), g = c.cur; if (!g) return; c.cur = null;
        const win = Number(data.cup) === g.pos, st = c.streak || 0;
        const fav = win ? cupFav(st) : 10, up = addFavor(u, g.k, fav); c.streak = win ? Math.min(CONF_STREAK_MAX, st + 1) : 0; markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('confGameResult', { win, pos: g.pos, fav, up, lvl: c[g.k].lvl, streak: c.streak, next: cupFav(c.streak) });
    });
    on('confGift', (data) => { // hediye eşyası ver
        const u = me(); if (!u) return; const k = String(data.id || ''), it = ITEMS[data.item]; if (!CONFIDANTS[k] || !confOpen(u, k) || !it || !it.fav) return socket.emit('error', 'Hediye verilemedi.');
        if (!((u.bag || {})[data.item] > 0)) return socket.emit('error', 'Bu hediyeden yok.');
        u.bag[data.item]--; if (u.bag[data.item] <= 0) delete u.bag[data.item]; const up = addFavor(u, k, it.fav); markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: up ? 'victory' : 'success', msg: `${CONFIDANTS[k].name} hediyeye bayıldı: yakınlık +${it.fav}${up ? ` — seviye ${conf(u)[k].lvl}!` : ''}` });
    });





    on('confRose', () => { // günlük bedava güller
        const u = me(); if (!u) return; const c = conf(u), d = dayKey(Date.now()); if (c.roseDay === d) return socket.emit('error', 'Bugünkü güllerini aldın. Yarın yine gel!');
        c.roseDay = d; giveItems(u, { gift_rose: CONF_ROSES }); markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: 'success', msg: `${CONF_ROSES} Gül Buketi çantana kondu.` });
    });
    on('confOutfit', (data) => { // kıyafet değiştir (yakınlık seviyesiyle açılır)
        const u = me(); if (!u) return; const k = String(data.id || ''); if (!CONFIDANTS[k] || !confOpen(u, k)) return socket.emit('error', 'Sırdaş bulunamadı.');
        const c = conf(u), o = (CONF_OUTFITS[k] || []).find(q => q.id === data.o); if (!o) return socket.emit('error', 'Kıyafet bulunamadı.');
        if (o.lvl && c[k].lvl < o.lvl) return socket.emit('error', `${o.name}: yakınlık Sv. ${o.lvl} gerekir.`);
        c[k].o = o.id; markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: 'success', msg: `${CONFIDANTS[k].name}: ${o.name}` });
    });
    on('heroStar', (data) => { // madalyayla +1 yıldız (en çok 6)
        const u = me(); if (!u) return; const h = (u.heroes || []).find(x => x.id === data.id); if (!h) return socket.emit('error', 'Bu kahraman henüz ailende değil.');
        const st = h.stars || 1; if (st >= 6) return socket.emit('error', 'En yüksek yıldızda.'); const need = STAR_COST[st + 1], have = (u.bag || {}).hero_medal || 0;
        if (have < need) return socket.emit('error', `Yetersiz madalya: ${have}/${need}. Madalyalar çetelerden, bounty'den, etkinlik ve kaçakçıdan gelir.`);
        u.bag.hero_medal -= need; if (u.bag.hero_medal <= 0) delete u.bag.hero_medal; h.stars = st + 1; addXP(u, 80 * h.stars, true); markDirty('users');
        socket.emit('toast', { type: 'victory', msg: `${h.name} ${h.stars} yıldız oldu!` }); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
    });

    // ── BELEDİYE SARAYI ──
    on('attackHall', (data) => { // kind: hall | fort · id · troops (dost elindeyse takviye)
        const u = me(); if (!u) return; const kind = ['fort', 'light', 'casino'].includes(data.kind) ? data.kind : 'hall', T = siteGet(kind, kind === 'hall' ? 'hall' : String(data.id || ''));
        if (!T) return socket.emit('error', 'Hedef bulunamadı.'); const H = world.hall;
        if (kind === 'casino' ? !casNow().active : (kind !== 'light' && H.phase !== 'war')) return socket.emit('error', siteWhyNot(T, u));
        if (siteFriendly(T, u)) { syncTroops(u); const want = mixTotal(cleanMix(data.troops, u.troops)) || int(data.total); if ((T.gn || 0) + want > siteCap(T)) return socket.emit('error', `${T.name} garnizon kapasitesi ${siteCap(T)} (şu an ${T.gn || 0}).`); }
        startMarch(u, kind, T.id, T.name, data);
    });
    on('hallTitle', (data) => { // başkan: unvan ver / al · başkanlığı klan arkadaşına bir kez devret
        const u = me(); if (!u) return; const H = world.hall, now = Date.now(); if (!H || !H.mayor || H.mayor !== u.username) return socket.emit('error', 'Unvanları yalnız Belediye Başkanı dağıtır.');
        const t = String(data.title || ''), TT = TITLES[t]; if (!TT) return socket.emit('error', 'Unvan bulunamadı.');
        const name = data.user ? String(data.user) : null, tg = name ? users[name] : null; if (name && (!tg || !tg.base)) return socket.emit('error', 'Oyuncu bulunamadı.');
        if (t === 'mayor') {
            if (!tg || tg === u || !sameClan(u, tg)) return socket.emit('error', 'Başkanlık yalnız klan arkadaşına devredilebilir.'); if (H.handed) return socket.emit('error', 'Başkanlık bu dönem zaten devredildi.');
            delete H.titles[u.username]; delete H.titles[name]; H.titles[name] = 'mayor'; H.mayor = name; H.handed = true;
            chatWorld(`${u.username} başkanlığı ${name} adlı aile üyesine devretti.`); emitTo(name, 'toast', { type: 'victory', msg: 'Artık Belediye Başkanısın!' });
            markDirty('world'); broadcastWorld(); pushResources(name); pushResources(u.username); return;
        }
        if (name === u.username) return socket.emit('error', 'Kendine unvan veremezsin.'); if (tg && H.titles[name] === 'mayor') return socket.emit('error', 'Başkana unvan verilemez.');
        if ((H.tcd[t] || 0) > now) return socket.emit('error', `${TT.name} unvanı ${Math.ceil((H.tcd[t] - now) / 60000)} dk sonra yeniden verilebilir.`);
        const prev = Object.keys(H.titles).find(n => H.titles[n] === t); if (prev) { delete H.titles[prev]; emitTo(prev, 'toast', { type: 'info', msg: `${TT.name} unvanın geri alındı.` }); pushResources(prev); }
        if (tg) { if (H.titles[name]) delete H.titles[name]; H.titles[name] = t;
            emitTo(name, 'toast', { type: TT.off ? 'victory' : 'defeat', msg: `Başkan ${u.username} sana "${TT.name}" unvanını verdi!` }); marchReport(tg, 'Belediye', `Başkan ${u.username} sana "${TT.name}" unvanını verdi. Etkiler unvan kaldırılana ya da yeni başkan seçilene kadar sürer.`); pushResources(name); }
        H.tcd[t] = now + TITLE_CD; H.log.unshift({ t: now, u: u.username, s: 'title:' + t, to: name }); H.log = H.log.slice(0, 20);
        markDirty('world'); markDirty('users'); broadcastWorld(); socket.emit('toast', { type: 'success', msg: tg ? `${name}: ${TT.name}` : `${TT.name} unvanı boşaltıldı.` });
    });
    on('hallSkill', (data) => { // kara parayla şehir becerisi
        const u = me(); if (!u) return; const H = world.hall, now = Date.now(), id = String(data.id || ''), K = HALL_SKILLS[id]; if (!K) return socket.emit('error', 'Beceri bulunamadı.');
        const my = H && H.mayor && H.titles[u.username]; if (!my || !K.who.includes(my)) return socket.emit('error', `Bu beceriyi yalnız ${K.who.map(w => TITLES[w].name).join(' / ')} kullanabilir.`);
        const cost = skillCost(H, id); if ((H.dirty || 0) < cost) return socket.emit('error', `Yetersiz kara para: ${(H.dirty || 0).toLocaleString('tr-TR')} / ${cost.toLocaleString('tr-TR')}`);
        if ((H.cds[id] || 0) > now) return socket.emit('error', `${K.name} bekleme süresinde (${Math.ceil((H.cds[id] - now) / 60000)} dk).`);
        if (K.uses && (H.uses[id] || 0) >= K.uses) return socket.emit('error', `${K.name}: bu dönemki kullanım hakkı bitti.`);
        let t = null; if (K.target) { t = users[String(data.target || '')]; if (!t || !t.base) return socket.emit('error', 'Hedef patron seç.'); }
        let note = '';
        if (K.fx) { Object.entries(K.fx).forEach(([k, v]) => H.buffs[k] = { v, until: now + K.dur, s: id }); note = `${K.name}: ${K.desc}`; new Set(Object.values(sessions)).forEach(pushResources); }
        else if (id === 'embezzle') { u.gold = (u.gold || 0) + K.gold; pushResources(u.username); }
        else if (id === 'gift') { H.gseq = (H.gseq || 0) + 1; const g = { id: 'g' + H.gseq + now.toString(36), by: u.username, left: 20, got: [], until: now + 3600e3 }; H.gifts.push(g); chatWorld(`Başkan ${u.username} şehre hediye sandığı bıraktı! İlk 20 patron açabilir.`, { gift: g.id }); }
        else if (id === 'truce') { Object.values(users).forEach(x => { if (x.base) x.shieldUntil = Math.max(x.shieldUntil || 0, now + 4 * 3600e3); }); note = `${K.name}: bütün patronlar 4 saat kalkan altında`; new Set(Object.values(sessions)).forEach(pushResources); }
        else if (id === 'asylum') { t.shieldUntil = Math.max(t.shieldUntil || 0, now + 8 * 3600e3); emitTo(t.username, 'toast', { type: 'victory', msg: `Belediye sana 8 saat sığınak verdi (kalkan).` }); pushResources(t.username); }
        else if (id === 'order') { t.noAtk = now + 3600e3; emitTo(t.username, 'toast', { type: 'defeat', msg: 'Belediye ateşkes emri: 1 saat saldırı seferi çıkaramazsın.' }); marchReport(t, 'Belediye', `${u.username} hakkında ateşkes emri çıkardı: 1 saat saldırı seferi çıkaramazsın.`); note = `${K.name}: ${t.username}`; }
        else if (id === 'demolish') { const q = freeBaseSpot(t); if (!q) return socket.emit('error', 'Uygun yer bulunamadı, sonra dene.'); moveBase(t, q.x, q.z); emitTo(t.username, 'baseMoved', t.base); emitTo(t.username, 'toast', { type: 'defeat', msg: 'Belediye yıkım emri: villan başka bir yere taşındı!' }); marchReport(t, 'Belediye', `${u.username} yıkım emri verdi; villan haritada başka bir yere taşındı.`); note = `${K.name}: ${t.username} villası taşındı`; }
        H.dirty -= cost; H.cds[id] = now + (K.cd || 0); H.uses[id] = (H.uses[id] || 0) + 1; H.log.unshift({ t: now, u: u.username, s: id, to: t ? t.username : null }); H.log = H.log.slice(0, 20);
        if (note) chatWorld(note);
        markDirty('world'); markDirty('users'); broadcastWorld(); socket.emit('toast', { type: 'success', msg: `${K.name} kullanıldı.` });
    });
    on('hallPack', (data) => { // başkan / sekreter paket dağıtır (her paketten oyuncu başı dönemde 1)
        const u = me(); if (!u) return; const H = world.hall, my = H && H.mayor && H.titles[u.username]; if (my !== 'mayor' && my !== 'secretary') return socket.emit('error', 'Paketleri Başkan ya da Sekreter dağıtır.');
        const k = String(data.pack || ''), PK = HALL_PACKS[k]; if (!PK) return socket.emit('error', 'Paket bulunamadı.'); const t = users[String(data.user || '')]; if (!t || !t.base) return socket.emit('error', 'Oyuncu seç.');
        if (!((H.packs || {})[k] > 0)) return socket.emit('error', `${PK.name} bu dönem için bitti.`); H.packGot[k] = H.packGot[k] || []; if (H.packGot[k].includes(t.username)) return socket.emit('error', `${t.username} bu dönem ${PK.name} aldı.`);
        H.packs[k]--; H.packGot[k].push(t.username); giveItems(t, PK.items); emitTo(t.username, 'toast', { type: 'victory', msg: `Belediye'den ${PK.name}! Çantana bak.` }); marchReport(t, 'Belediye', `${u.username} sana ${PK.name} gönderdi. Eşyalar çantanda.`); pushResources(t.username);
        markDirty('world'); markDirty('users'); broadcastWorld(); socket.emit('toast', { type: 'success', msg: `${PK.name} → ${t.username}` });
    });
    on('claimGift', (data) => { // başkanın hediye sandığı (sohbetten)
        const u = me(); if (!u) return; const H = world.hall, g = H && (H.gifts || []).find(x => x.id === data.id); if (!g || g.left <= 0 || g.until < Date.now()) return socket.emit('error', 'Bu hediye sandığı boşaldı.');
        if (g.got.includes(u.username)) return socket.emit('error', 'Bu sandıktan payını aldın.'); g.got.push(u.username); g.left--;
        const it = GIFT_POOL[Math.floor(Math.random() * GIFT_POOL.length)]; u.gold = (u.gold || 0) + 25; giveItems(u, it); markDirty('users'); markDirty('world'); pushResources(u.username); broadcastWorld();
        socket.emit('toast', { type: 'victory', msg: `Hediye sandığı: 25 altın + ${Object.entries(it).map(([k, n]) => (ITEMS[k] ? ITEMS[k].name : k) + ' ×' + n).join(', ')}` });
    });

    // ── KLAN TEKNOLOJİSİ ──
    on('getClanTech', () => { const u = me(); if (!u) return; socket.emit('clanTechData', ctInfo(u)); });
    on('clanDonate', (data) => {
        const u = me(); if (!u) return; accrue(u); const c = u.clan && clans[u.clan]; if (!c) return socket.emit('error', 'Bağış için bir klanda olmalısın.');
        const id = String(data.id || ''), T = CTECH[id]; if (!T) return socket.emit('error', 'Teknoloji bulunamadı.'); const t = ctOf(c)[id]; if (t.l >= CT_MAX) return socket.emit('error', `${T.name} en yüksek seviyede.`);
        const d = donOf(u); if (d.n <= 0) return socket.emit('error', `Bağış hakkın kalmadı. ${Math.max(1, Math.ceil((d.t + DON_MS - Date.now()) / 60000))} dk sonra +1 hak.`);
        const amt = donAmt(T.res, t.l), RN = { cash: 'Cash', cargo: 'Cargo', arms: 'Arms', metal: 'Metal' }[T.res]; if ((u[T.res] || 0) < amt) return socket.emit('error', `Yetersiz ${RN}: ${amt.toLocaleString('tr-TR')} gerekli.`);
        u[T.res] -= amt; if (d.n >= DON_MAX) d.t = Date.now(); d.n--;
        const crit = Math.random() < 0.1, pts = DON_PTS * (crit ? 2 : 1); t.p += pts; let up = false; while (t.l < CT_MAX && t.p >= ctNeed(t.l)) { t.p -= ctNeed(t.l); t.l++; up = true; } if (t.l >= CT_MAX) t.p = 0;
        stat(u, 'donate'); u.cpts = (u.cpts || 0) + pts; const wk = weekKey(Date.now()); if (!u.cptsWk || u.cptsWk.wk !== wk) u.cptsWk = { wk, p: 0 }; u.cptsWk.p += pts; addXP(u, 8, true);
        markDirty('users'); markDirty('clans'); pushResources(u.username); socket.emit('clanTechData', ctInfo(u));
        socket.emit('toast', { type: crit ? 'victory' : 'success', msg: `${T.name}: +${pts} puan${crit ? ' (KRİTİK ×2!)' : ''} · klan puanın +${pts}` });
        if (up) { chatSys(u.clan, `Klan teknolojisi ${T.name} Sv. ${t.l} oldu! (${u.username} bağışıyla)`, u.character); (c.members || []).forEach(n => { emitTo(n, 'toast', { type: 'victory', msg: `Klan teknolojisi: ${T.name} Sv. ${t.l}!` }); if (isOnline(n)) { pushResources(n); emitTo(n, 'clanTechData', ctInfo(users[n])); } }); }
    });
    on('clanShopBuy', (data) => {
        const u = me(); if (!u) return; const it = CSHOP.find(x => x.id === data.id); if (!it) return socket.emit('error', 'Ürün bulunamadı.');
        if ((u.cpts || 0) < it.cost) return socket.emit('error', `Yetersiz klan puanı: ${u.cpts || 0} / ${it.cost}`);
        u.cpts -= it.cost; giveItems(u, it.items); markDirty('users'); pushResources(u.username); socket.emit('clanTechData', ctInfo(u));
        socket.emit('toast', { type: 'success', msg: `Klan Dükkânı: ${Object.entries(it.items).map(([k, n]) => (ITEMS[k] ? ITEMS[k].name : k) + ' ×' + n).join(', ')}` });
    });
    // ── HAPİSHANE KULESİ ──
    on('getSlam', () => { const u = me(); if (!u) return; socket.emit('slamData', slamInfo(u)); });
    on('slamFight', (data) => { // asker ölmez: güç karşılaştırması; enerji harcanır
        const u = me(); if (!u) return; const s = slamOf(u); if (s.f > SLAM_MAX) return socket.emit('error', 'Kulenin tepesindesin! Pazartesi kule yeniden başlar.');
        if (s.en < SLAM_COST) return socket.emit('error', `Enerjin yetmiyor (${s.en}/${SLAM_COST}). Her 5 dakikada 1 dolar.`);
        syncTroops(u); const mix = cleanMix(data.troops, u.troops), n = mixTotal(mix); if (!n) return socket.emit('error', 'Savaşacak asker seç!'); if (n > crimeOps(u)) return socket.emit('error', `Sefer kapasiten ${crimeOps(u)}.`);
        const f = s.f, g = slamGuard(f), ap = sidePower(mix, { n: g }, attackMult(u), false, heroTM(u)) * (0.92 + Math.random() * 0.16), dp = sidePower({ n: g }, mix, slamDef(f), true) * (0.92 + Math.random() * 0.16), win = ap > dp, r = ap / Math.max(1, dp);
        if (s.en >= SLAM_EN) s.et = Date.now(); s.en -= SLAM_COST;
        let R = null, stars = 0;
        if (win) { stars = r >= 1.6 ? 3 : r >= 1.3 ? 2 : 1; R = slamGive(u, f); s.f = f + 1; s.wbest = Math.max(s.wbest, f); s.best = Math.max(s.best, f); stat(u, 'slam'); addXP(u, 20 + f * 2, true); questProgress(u, 'attack'); evPoints(u, 'war', 30 + f * 5); }
        markDirty('users'); pushResources(u.username);
        socket.emit('slamResult', { win, f, stars, ratio: +r.toFixed(2), rew: R }); socket.emit('slamData', slamInfo(u));
    });
    on('slamWipe', () => { // haftada bir: geçen haftanın en iyisinin %80'ine kadar katları anında geç (ödüller verilir)
        const u = me(); if (!u) return; const s = slamOf(u), to = slamWipeTo(s); if (!to) return socket.emit('error', 'Bu hafta süpürülecek kat yok.');
        const tot = { cash: 0, cargo: 0, arms: 0, metal: 0 }, its = {}; let coins = 0; const from = s.f;
        for (let f = s.f; f <= to; f++) { const R = slamGive(u, f); Object.keys(tot).forEach(k => tot[k] += R.res[k]); Object.keys(R.items).forEach(k => its[k] = (its[k] || 0) + R.items[k]); coins += R.coins; }
        s.f = to + 1; s.wbest = Math.max(s.wbest, to); s.best = Math.max(s.best, to); s.wiped = true; markDirty('users'); pushResources(u.username);
        socket.emit('slamResult', { win: true, wipe: true, from, f: to, stars: 3, rew: { res: tot, items: its, coins } }); socket.emit('slamData', slamInfo(u));
    });
    on('slamBuy', (data) => {
        const u = me(); if (!u) return; const s = slamOf(u), it = SLAM_SHOP.find(x => x.id === data.id); if (!it) return socket.emit('error', 'Ürün bulunamadı.');
        if ((s.coins || 0) < it.cost) return socket.emit('error', `Yetersiz hapishane parası: ${s.coins || 0} / ${it.cost}`);
        s.coins -= it.cost; giveItems(u, it.items); markDirty('users'); pushResources(u.username); socket.emit('slamData', slamInfo(u));
        socket.emit('toast', { type: 'success', msg: `Hapishane Dükkânı: ${Object.entries(it.items).map(([k, n]) => (ITEMS[k] ? ITEMS[k].name : k) + ' ×' + n).join(', ')}` });
    });

    // ── VİLLA GÖRÜNÜMLERİ ──
    on('skinCraft', (data) => { // parçaları birleştir → görünüm kalıcı olarak senin
        const u = me(); if (!u) return; const id = String(data.id || ''), S = SKINS[id]; if (!S) return socket.emit('error', 'Görünüm bulunamadı.'); const k = skinsOf(u);
        if (k.own.includes(id)) return socket.emit('error', `${S.name} zaten senin.`); const have = (u.bag || {})['sf_' + id] || 0;
        if (have < S.frags) return socket.emit('error', `Yetersiz parça: ${have} / ${S.frags}.`);
        u.bag['sf_' + id] -= S.frags; if (u.bag['sf_' + id] <= 0) delete u.bag['sf_' + id]; k.own.push(id); if (!k.on) k.on = id;
        markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u)); io.emit('skinChanged', { u: u.username, skin: k.on });
        socket.emit('toast', { type: 'victory', msg: `${S.name} açıldı! Kalıcı bonus etkin.` });
    });
    on('skinUse', (data) => { // haritada görünecek görünüm (null: klasik villa)
        const u = me(); if (!u) return; const k = skinsOf(u), id = data.id ? String(data.id) : null; if (id && !k.own.includes(id)) return socket.emit('error', 'Bu görünüm senin değil.');
        k.on = id; markDirty('users'); socket.emit('profileData', publicPlayer(u)); io.emit('skinChanged', { u: u.username, skin: id });
        socket.emit('toast', { type: 'success', msg: id ? `${SKINS[id].name} kullanılıyor.` : 'Klasik villa görünümü.' });
    });

    // ── ZAR TURU ──
    on('getDice', () => { const u = me(); if (!u) return; socket.emit('diceData', diceInfo(u)); });
    on('diceRoll', () => {
        const u = me(); if (!u) return; accrue(u); const x = diceOf(u); let used = 'free';
        if (x.free > 0) x.free--; else if (((u.bag || {}).dice || 0) > 0) { u.bag.dice--; if (u.bag.dice <= 0) delete u.bag.dice; used = 'item'; }
        else return socket.emit('error', 'Zarın kalmadı. Yarın 3 bedava zar; Sihirli Zar mağazada, Hapishane ve Klan dükkânında.');
        const roll = 1 + Math.floor(Math.random() * 6), N = DICE_BOARD.length, from = x.pos || 0, out = { roll, from, used, laps: [] };
        let pos = from, lapGot = [];
        const step = k => { for (let i = 0; i < Math.abs(k); i++) { pos = (pos + (k > 0 ? 1 : N - 1)) % N; if (k > 0 && pos === 0) { const L = DICE_LAP[Math.min(DICE_LAP.length - 1, x.laps)]; lapGot.push(diceGrant(u, L, 1)); x.laps++; x.lapsAll = (x.lapsAll || 0) + 1; } } };
        step(roll); const T = DICE_BOARD[pos], mult = x.boost ? 2 : 1; x.boost = false; out.tile = T.t; out.mult = mult;
        if (T.t === 'res') out.got = diceGrant(u, { res: { [T.r]: T.v } }, mult);
        else if (T.t === 'item') out.got = diceGrant(u, { items: T.items }, mult);
        else if (T.t === 'boost') { x.boost = true; out.msg = 'Kumarhane: bir sonraki karenin ödülü iki katı!'; }
        else if (T.t === 'jail') out.msg = 'Polis baskını! Bu karede ödül yok.';
        else if (T.t === 'start') out.msg = 'Başlangıç karesi.';
        else if (T.t === 'chance') { const C = DICE_CHANCE[Math.floor(Math.random() * DICE_CHANCE.length)]; out.msg = C.msg; out.chance = true;
            if (C.move) { out.mid = pos; step(C.move); const T2 = DICE_BOARD[pos]; out.tile2 = T2.t; if (T2.t === 'res') out.got = diceGrant(u, { res: { [T2.r]: T2.v } }, 1); else if (T2.t === 'item') out.got = diceGrant(u, { items: T2.items }, 1); }
            else out.got = diceGrant(u, C, mult); }
        x.pos = pos; out.to = pos; out.laps = lapGot; stat(u, 'dice'); evPoints(u, 'build', 40);
        markDirty('users'); pushResources(u.username); socket.emit('diceResult', out); socket.emit('diceData', diceInfo(u));
    });

    on('unlockTier', (data) => { // elit kademe kilidi (T6–T8): kamp seviyesi + önceki kademe + pırlanta + Cash
        const u = me(); if (!u) return; accrue(u); const l = int(data.l), C = TIER_UNLOCK[l]; if (!C) return socket.emit('error', 'Bu kademenin kilidi yok.');
        u.tierUnl = u.tierUnl || {}; if (u.tierUnl[l]) return socket.emit('error', `T${l} zaten açık.`);
        if (bLevel(u, 'camp_main') < TIER.camp[l - 1]) return socket.emit('error', `Önce Eğitim Kampı Sv. ${TIER.camp[l - 1]}.`);
        if (TIER_UNLOCK[l - 1] && !u.tierUnl[l - 1]) return socket.emit('error', `Önce T${l - 1} kilidini aç.`);
        const g = gear(u), gem = g.mat.gem || 0; if (gem < C.gem) return socket.emit('error', `Yetersiz Pırlanta: ${gem} / ${C.gem}.`);
        if ((u.cash || 0) < C.cash) return socket.emit('error', `Yetersiz Cash: ${C.cash.toLocaleString('tr-TR')} gerekli.`);
        g.mat.gem -= C.gem; u.cash -= C.cash; u.tierUnl[l] = true; addXP(u, 500 * l, true); markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('toast', { type: 'victory', msg: `Elit kademe T${l} açıldı! ${TROOPS.k.tiers[l - 1]}, ${TROOPS.t.tiers[l - 1]}, ${TROOPS.m.tiers[l - 1]}, ${TROOPS.a.tiers[l - 1]} eğitilebilir.` });
    });
    // ── KLAN BÖLGESİ ──
    on('attackTer', (data) => { // klan yapısı: dostsa garnizon / inşaat askeri, düşmansa kuşatma (tamamlanmış karargâh yalnız baskınla)
        const u = me(); if (!u) return; const T = (world.ters || {})[String(data.id || '')]; if (!T) return socket.emit('error', 'Yapı bulunamadı.');
        if (terFriendly(T, u)) { syncTroops(u); const want = mixTotal(cleanMix(data.troops, u.troops)) || int(data.total); if ((T.gn || 0) + want > TER[T.type].cap) return socket.emit('error', `${T.name} garnizon kapasitesi ${TER[T.type].cap} (şu an ${T.gn || 0}).`); }
        else if (T.type === 'hq' && T.state === 'done') return socket.emit('error', 'Tamamlanmış karargâh yalnız klan baskınıyla kuşatılabilir.');
        startMarch(u, 'ter', T.id, T.name, data);
    });
    on('terPlace', (data) => { // klan lideri: karargâh / kule inşaatını başlat
        const u = me(); if (!u) return; accrue(u); const C = u.clan && clans[u.clan]; if (!C) return socket.emit('error', 'Önce bir klana katıl.');
        if (C.leader !== u.username) return socket.emit('error', 'Klan yapılarını yalnız klan lideri kurar.');
        const type = data.type === 'tower' ? 'tower' : 'hq', D = TER[type], x = Math.round(Number(data.x) / 10) * 10, z = Math.round(Number(data.z) / 10) * 10;
        const own = Object.values(world.ters || {}).filter(T => T.clan === u.clan), hq = own.find(T => T.type === 'hq');
        if (type === 'hq' && hq) return socket.emit('error', 'Klanının zaten bir karargâhı var.');
        if (type === 'tower') { if (!hq || hq.state !== 'done') return socket.emit('error', 'Kule kurmak için önce karargâh tamamlanmalı.'); if (own.filter(T => T.type === 'tower').length >= TER_TOWERS) return socket.emit('error', `Bir klan en çok ${TER_TOWERS} kule kurabilir.`); }
        const why = terWhyPlace(u, type, x, z); if (why) return socket.emit('error', why);
        if (!canAfford(u, D.cost)) return socket.emit('error', `${costText(D.cost)} gerekli.`);
        pay(u, D.cost); const id = 'ter' + (marchSeq++) + Date.now().toString(36), nTw = own.filter(T => T.type === 'tower').length;
        world.ters[id] = { id, kind: 'ter', type, clan: u.clan, name: type === 'hq' ? D.name : `${D.name} ${['I', 'II', 'III', 'IV'][nTw] || nTw + 1}`, x, z, state: 'build', prog: 0, need: D.need, dur: 0, max: D.max, npc: 0, gn: 0, gl: [], by: u.username, t0: Date.now() };
        WPOS[id] = { x, z }; markDirty('world'); markDirty('users'); pushResources(u.username); broadcastWorld();
        chatSys(u.clan, `${u.username} ${world.ters[id].name} inşaatını başlattı (X ${Math.round((x + 5000) / 10)}, Y ${Math.round((z + 5000) / 10)}). İnşaat için yapıya asker gönderin!`, u.character);
        socket.emit('terPlaced', { id }); socket.emit('toast', { type: 'success', msg: `${world.ters[id].name} inşaatı başladı! Klan arkadaşların asker göndererek inşaatı ilerletir.` });
    });
    on('terDemolish', (data) => { // klan lideri: yapıyı kaldır (karargâh için önce kuleler)
        const u = me(); if (!u) return; const T = (world.ters || {})[String(data.id || '')]; if (!T || !terFriendly(T, u)) return socket.emit('error', 'Yapı bulunamadı.');
        const C = clans[u.clan]; if (!C || C.leader !== u.username) return socket.emit('error', 'Yapıyı yalnız klan lideri kaldırır.');
        if (T.type === 'hq' && Object.values(world.ters).some(q => q.clan === T.clan && q.type === 'tower')) return socket.emit('error', 'Önce kuleleri kaldır.');
        terRaze(T, null, true); chatSys(u.clan, `${u.username} ${T.name} yapısını kaldırdı.`, u.character); broadcastWorld(); broadcastMarches(); socket.emit('toast', { type: 'info', msg: `${T.name} kaldırıldı.` });
    });
    on('terTeleport', () => { // klan bölgesine ücretsiz ışınlanma (bekleme süreli)
        const u = me(); if (!u) return; if (!u.base) return socket.emit('error', 'Önce üssünü kur!'); if (!u.clan) return socket.emit('error', 'Önce bir klana katıl.');
        const left = (u.terTp || 0) + TER_TP_CD - Date.now(); if (left > 0) return socket.emit('error', `Bölge ışınlanması ${Math.ceil(left / 60000)} dk sonra hazır.`);
        if ((u.marches || []).length) return socket.emit('error', 'Seferdeki birliklerin dönmeden villanı taşıyamazsın.');
        const src = Object.values(world.ters || {}).filter(T => T.clan === u.clan && terActive(T)).sort((a, b) => (b.type === 'hq') - (a.type === 'hq')); if (!src.length) return socket.emit('error', 'Klanının etkin bir bölgesi yok.');
        let x, z; for (let k = 0; k < 900 && x === undefined; k++) { const T = src[k < 450 ? 0 : k % src.length], a = Math.random() * 6.283, r = 230 + Math.random() * (TER[T.type].r * 0.85 - 230), tx = Math.round((T.x + Math.cos(a) * r) / 20) * 20, tz = Math.round((T.z + Math.sin(a) * r) / 20) * 20; if (spotFree(u, tx, tz) && terCover(tx, tz, u.clan)) { x = tx; z = tz; } }
        if (x === undefined) return socket.emit('error', 'Bölgede boş yer bulunamadı.');
        moveBase(u, x, z); u.terTp = Date.now(); markDirty('users'); socket.emit('baseMoved', u.base); pushResources(u.username); socket.emit('toast', { type: 'success', msg: 'Villan klan bölgesine taşındı! Bölge etkileri artık sende.' });
    });
    // ── BAŞARIMLAR ──
    on('getAch', () => { const u = me(); if (!u) return; socket.emit('achData', achInfo(u)); });
    on('achClaim', (data) => { // id: tek başarım (sıradaki kademe) · all: hazır olanların hepsi
        const u = me(); if (!u) return; accrue(u); const L = data && data.all ? ACH : ACH.filter(A => A.id === String((data || {}).id || '')); if (!L.length) return socket.emit('error', 'Başarım bulunamadı.');
        let gold = 0, pts = 0, n = 0, up = false; L.forEach(A => { for (let i = 0; i < 5; i++) { const r = achClaim(u, A); if (!r) break; gold += r.gold; pts += r.pts; n++; up = up || r.rankUp; if (!(data && data.all)) break; } });
        if (!n) return socket.emit('error', 'Alınacak başarım ödülü yok.');
        markDirty('users'); pushResources(u.username); const info = achInfo(u); socket.emit('achData', info); achDotSent.set(u.username, info.ready); socket.emit('achDot', { n: info.ready });
        socket.emit('toast', { type: 'victory', msg: `Başarım ödülü: +${gold} altın · +${pts} puan${n > 1 ? ` (${n} kademe)` : ''}` });
        if (up) { const R = ACH_RANKS[info.rank][0]; socket.emit('toast', { type: 'victory', msg: `Yeni başarım rütbesi: ${R}! Saldırı/savunma +%${(ACH_FX.atk * info.rank * 100).toFixed(1).replace('.', ',')}, üretim +%${Math.round(ACH_FX.prod * info.rank * 100)}.` }); if (info.rank >= 5) chatWorld(`${u.username} "${R}" başarım rütbesine ulaştı!`); socket.emit('profileData', publicPlayer(u)); }
    });
    // ── KUMARHANE SAVAŞI ──
    on('getCas', () => { const u = me(); if (!u) return; socket.emit('casData', casInfo(u)); });
    on('casClaim', (data) => { const u = me(); if (!u) return; const x = casOf(u), i = int(data && data.i); if (!(i >= 0 && i < CAS_TIERS.length)) return socket.emit('error', 'Ödül bulunamadı.');
        if (x.claimed[i]) return socket.emit('error', 'Bu ödülü aldın.'); if (x.pts < CAS_TIERS[i]) return socket.emit('error', `${CAS_TIERS[i].toLocaleString('tr-TR')} puan gerekli.`);
        const R = CAS_REW[i]; x.claimed[i] = true; u.casFis = (u.casFis || 0) + (R.fis || 0); u.gold = (u.gold || 0) + (R.gold || 0); if (R.items) giveItems(u, R.items);
        markDirty('users'); pushResources(u.username); socket.emit('casData', casInfo(u)); socket.emit('toast', { type: 'victory', msg: `Kumarhane ödülü: +${R.fis} fiş${R.gold ? ' · +' + R.gold + ' altın' : ''}` }); });
    on('casDaily', () => { const u = me(); if (!u) return; if (!casNow().active) return socket.emit('error', 'Kumarhane Savaşı şu an kapalı.'); const x = casOf(u), d = dayKey(Date.now()); if (x.day === d) return socket.emit('error', 'Bugünkü bedava fişini aldın.');
        x.day = d; u.casFis = (u.casFis || 0) + CAS_DAILY; markDirty('users'); socket.emit('casData', casInfo(u)); socket.emit('toast', { type: 'success', msg: `+${CAS_DAILY} bedava fiş` }); });
    on('casRoulette', (data) => { // bahis: { t: red|black|odd|even|low|high|dozen|num, v }, amt 1–100 fiş
        const u = me(); if (!u) return; casOf(u); const b = (data && data.bet) || {}, amt = Math.max(1, Math.min(100, int(data && data.amt) || 1));
        if (!['red', 'black', 'odd', 'even', 'low', 'high', 'dozen', 'num'].includes(b.t)) return socket.emit('error', 'Geçersiz bahis.'); if ((u.casFis || 0) < amt) return socket.emit('error', `Yetersiz fiş: ${u.casFis || 0} / ${amt}.`);
        u.casFis -= amt; const n = casSpin(), mul = casBetWin(b, n), pay = amt * mul; u.casFis += pay; stat(u, 'roulette');
        markDirty('users'); socket.emit('casSpin', { n, red: CAS_RED.has(n), bet: b, amt, mul, pay, fis: u.casFis }); });
    on('casSlot', (data) => { // kollu makine: 3 makara; üçlü ×x, çift = iade
        const u = me(); if (!u) return; casOf(u); const amt = [1, 5, 10, 25].includes(int(data && data.amt)) ? int(data.amt) : 1; if ((u.casFis || 0) < amt) return socket.emit('error', `Yetersiz fiş: ${u.casFis || 0} / ${amt}.`);
        u.casFis -= amt; const R = [casReel(), casReel(), casReel()], S3 = R[0] === R[1] && R[1] === R[2], S2 = !S3 && (R[0] === R[1] || R[1] === R[2] || R[0] === R[2]);
        const sym = S3 ? CAS_SYMS.find(q => q.id === R[0]) : null, mul = S3 ? sym.x : S2 ? 1 : 0, pay = amt * mul; u.casFis += pay; stat(u, 'slots');
        if (S3 && sym.x >= 40) chatWorld(`${u.username} kollu makinede büyük ikramiye vurdu: ${pay.toLocaleString('tr-TR')} fiş!`);
        markDirty('users'); socket.emit('casSlotRes', { reels: R, mul, pay, amt, fis: u.casFis, big: S3 }); });
    on('casShop', (data) => { const u = me(); if (!u) return; const x = casOf(u), it = CAS_SHOP.find(q => q.id === String((data && data.id) || '')); if (!it) return socket.emit('error', 'Ürün bulunamadı.');
        if ((u.casFis || 0) < it.cost) return socket.emit('error', `Yetersiz fiş: ${u.casFis || 0} / ${it.cost}.`); x.shop = x.shop || {}; if (it.lim && (x.shop[it.id] || 0) >= it.lim) return socket.emit('error', 'Bu etkinlikte alım sınırına ulaştın.');
        u.casFis -= it.cost; x.shop[it.id] = (x.shop[it.id] || 0) + 1; if (it.items) giveItems(u, it.items); if (it.gold) u.gold = (u.gold || 0) + it.gold;
        markDirty('users'); pushResources(u.username); socket.emit('casData', casInfo(u)); socket.emit('toast', { type: 'success', msg: 'Fiş Dükkânı: satın alındı.' }); });
    // ── KAÇAKÇI ──
    on('getSmuggler', () => { const u = me(); if (!u) return; socket.emit('smugData', smugInfo(u)); });
    on('buySmug', (data) => {
        const u = me(); if (!u) return; accrue(u); const o = smugOffers(u).find(x => x.id === data.id); if (!o) return socket.emit('error', 'Bu teklif artık yok.');
        if (o.left <= 0) return socket.emit('error', 'Bu tekliften kalmadı.');
        for (const k in o.price) { const have = k === 'gold' ? (u.gold || 0) : (u[k] || 0); if (have < o.price[k]) return socket.emit('error', `Yetersiz ${k === 'gold' ? 'altın' : k}! Gerekli: ${o.price[k].toLocaleString('tr-TR')}`); }
        for (const k in o.price) { if (k === 'gold') u.gold -= o.price[k]; else u[k] -= o.price[k]; }
        if (o.give.items) giveItems(u, o.give.items); if (o.give.res) for (const k in o.give.res) u[k] = (u[k] || 0) + o.give.res[k];
        const S = smug(u); S.bought[o.id] = (S.bought[o.id] || 0) + 1; markDirty('users');
        socket.emit('toast', { type: 'success', msg: 'Kaçakçıyla anlaşma tamam: mallar çantada.' }); pushResources(u.username); socket.emit('profileData', publicPlayer(u)); socket.emit('smugData', smugInfo(u));
    });
    on('smugReroll', () => {
        const u = me(); if (!u) return; const S = smug(u); if ((u.gold || 0) < SMUG_REROLL) return socket.emit('error', `Yetersiz altın! (${SMUG_REROLL})`);
        u.gold -= SMUG_REROLL; S.roll++; S.bought = {}; markDirty('users'); pushResources(u.username); socket.emit('smugData', smugInfo(u));
    });
    // ── KLAN BASKINI ──
    on('getRallies', () => { const u = me(); if (!u) return; socket.emit('ralliesData', clanRallies(u)); });
    on('startRally', (data) => { // kind: boss | city · id · wait (sn) · troops
        const u = me(); if (!u) return; accrue(u); if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        if (!u.clan || !clans[u.clan]) return socket.emit('error', 'Baskın başlatmak için bir klanda olmalısın.');
        if (u.rally) return socket.emit('error', 'Zaten süren bir baskının var.');
        u.marches = u.marches || []; if (u.marches.length >= marchSlots(u)) return socket.emit('error', `Sefer sınırı dolu (${marchSlots(u)}).`);
        const kind = ['city', 'hall', 'fort', 'light', 'ter', 'casino'].includes(data.kind) ? data.kind : 'boss', id = String(data.id || (data.kind === 'hall' ? 'hall' : '')); let name;
        if (kind === 'boss') { const b = world.bosses[id]; if (!b || b.defeated) return socket.emit('error', 'Hedef şu an yok!'); name = b.beast; }
        else if (kind === 'ter') { const T = siteGet('ter', id); if (!T) return socket.emit('error', 'Yapı bulunamadı.'); if (terFriendly(T, u)) return socket.emit('error', 'Bu yapı senin klanının.'); name = T.name; }
        else if (isSite(kind)) { const T = siteGet(kind, id); if (!T) return socket.emit('error', 'Hedef bulunamadı.'); const w = siteWhyNot(T, u); if (w) return socket.emit('error', w); name = T.name; }
        else { const c = world.cities[id]; if (!c) return socket.emit('error', 'Şehir bulunamadı.'); if (c.owner === u.username) return socket.emit('error', 'Bu şehir zaten senin!');
            const o = c.owner && users[c.owner]; if (o && sameClan(u, o)) return socket.emit('error', 'Klan arkadaşının şehrine baskın olmaz!'); name = c.name; }
        if (Object.values(users).some(L => L.rally && L.clan === u.clan && L.rally.target === id)) return socket.emit('error', 'Klanın bu hedefe zaten baskın kuruyor. Ona katıl!');
        syncTroops(u); const mix = cleanMix(data.troops, u.troops), n = mixTotal(mix); if (!n) return socket.emit('error', 'Baskına asker seç!');
        if (n > crimeOps(u)) return socket.emit('error', `Sefer kapasiten ${crimeOps(u)}.`);
        const wait = Math.max(RALLY_MIN, Math.min(600e3, (Number(data.wait) || 60) * 1000)), now = Date.now();
        const R = u.rally = { id: 'r' + (marchSeq++) + now.toString(36), kind, target: id, name, clan: u.clan, t0: now, launchAt: now + wait, state: 'wait' };
        const home = { x: u.base.x, z: u.base.z };
        mixAdd(u.troops, mix, -1); syncTroops(u);
        u.marches.push({ id: 'm' + (marchSeq++) + now.toString(36), kind: 'rally', rid: R.id, rl: u.username, target: id, name: 'Baskın: ' + name, troops: mix, from: home, to: home, t0: now, t1: R.launchAt, dur: wait, state: 'wait', lead: leadType(mix) });
        markDirty('users'); pushResources(u.username); broadcastMarches();
        (clans[u.clan].members || []).forEach(nm => { if (nm !== u.username) emitTo(nm, 'toast', { type: 'info', msg: `${u.username} ${name} hedefine baskın topluyor! Klan menüsünden katıl.` }); });
        chatSys(u.clan, `${u.username}, ${name} hedefine baskın başlattı (${Math.max(1, Math.round(wait / 60000))} dk toplanma). Katılmak için Klan › Baskınlar.`, u.character);
        socket.emit('toast', { type: 'success', msg: `Baskın kuruldu: ${name}. Klan üyelerini bekliyorsun.` }); pushRallies(u.clan);
    });
    on('joinRally', (data) => { // leader · troops
        const u = me(); if (!u) return; accrue(u); if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        const L = users[String(data.leader || '')], R = L && L.rally; if (!R || R.state !== 'wait') return socket.emit('error', 'Bu baskın artık toplanmıyor.');
        if (L === u) return socket.emit('error', 'Kendi baskınına zaten katıldın.'); if (!sameClan(u, L)) return socket.emit('error', 'Yalnız klan arkadaşlarının baskınına katılabilirsin.');
        if ((u.marches || []).some(m => m.rid === R.id)) return socket.emit('error', 'Bu baskına zaten asker yolladın.');
        u.marches = u.marches || []; if (u.marches.length >= marchSlots(u)) return socket.emit('error', `Sefer sınırı dolu (${marchSlots(u)}).`);
        syncTroops(u); const mix = cleanMix(data.troops, u.troops), n = mixTotal(mix); if (!n) return socket.emit('error', 'Gönderilecek asker seç!');
        if (n > crimeOps(u)) return socket.emit('error', `Sefer kapasiten ${crimeOps(u)}.`);
        const room = rallyCap(L) - rallyTotal(R); if (n > room) return socket.emit('error', `Baskında yalnız ${Math.max(0, room)} asker yeri kaldı.`);
        const from = { x: u.base.x, z: u.base.z }, to = { x: L.base.x, z: L.base.z }, now = Date.now();
        const dur = Math.round(Math.max(3000, Math.hypot(to.x - from.x, to.z - from.z) / marchSpeed(mix, u) * 1000));
        if (now + dur > R.launchAt - 1000) return socket.emit('error', `Toplanmaya yetişemezsin: yol ${tfmtS(dur)}, kalan ${tfmtS(R.launchAt - now)}.`);
        mixAdd(u.troops, mix, -1); syncTroops(u);
        u.marches.push({ id: 'm' + (marchSeq++) + now.toString(36), kind: 'rally', rid: R.id, rl: L.username, target: R.target, name: 'Baskın: ' + R.name, troops: mix, from, to, t0: now, t1: now + dur, dur, state: 'join', lead: leadType(mix) });
        markDirty('users'); pushResources(u.username); broadcastMarches(); pushRallies(u.clan);
        socket.emit('toast', { type: 'success', msg: `${n} asker baskına yola çıktı (${tfmtS(dur)}).` });
    });
    on('cancelRally', () => { const u = me(); if (!u || !u.rally) return socket.emit('error', 'Süren baskının yok.'); if (u.rally.state !== 'wait') return socket.emit('error', 'Baskın yola çıktı, iptal edilemez.'); rallyDisband(u, 'lider iptal etti'); });

    // ── GARAJ: parça al / sat, araba seç ──
    on('carPart', (data) => { // buy: true → al ve tak, false → sat (tam iade)
        const u = me(); if (!u) return; accrue(u); const g = garage(u), C = CARS[data.car], P = PARTS[data.part];
        if (!C || !P || !C.parts.includes(data.part)) return socket.emit('error', 'Parça bulunamadı.');
        if (((u.base && u.base.level) || 1) < C.villa) return socket.emit('error', `${C.name} için Villa Sv. ${C.villa} gerekli.`);
        const c = g.cars[data.car] = g.cars[data.car] || { parts: [] }, has = c.parts.includes(data.part), mat = gear(u).mat;
        if (data.buy) {
            if (has) return socket.emit('error', 'Bu parça zaten takılı.');
            for (const k in P.cost) if ((mat[k] || 0) < P.cost[k]) return socket.emit('error', `Yetersiz ${MATS[k]}! Gerekli: ${P.cost[k]} (sende ${mat[k] || 0})`);
            if ((u.cash || 0) < P.cash) return socket.emit('error', `Yetersiz Cash! Gerekli: ${P.cash.toLocaleString('tr-TR')}`);
            for (const k in P.cost) mat[k] -= P.cost[k]; u.cash -= P.cash; c.parts.push(data.part); addXP(u, 30, true);
            const done = carDone(u, data.car); if (done && !g.active) g.active = data.car;
            socket.emit('toast', { type: done ? 'victory' : 'success', msg: done ? `${C.name} hazır! Garajda aktif edebilirsin.` : `${P.name} takıldı.` });
        } else {
            if (!has) return socket.emit('error', 'Bu parça takılı değil.');
            c.parts = c.parts.filter(x => x !== data.part); giveMats(u, P.cost); u.cash += P.cash; if (g.active === data.car) g.active = null;
            socket.emit('toast', { type: 'info', msg: `${P.name} satıldı: ${matText(P.cost)} + ${P.cash.toLocaleString('tr-TR')} Cash geri geldi.` });
        }
        markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
    });
    on('setCar', (data) => { // aktif araba (null: hiçbiri)
        const u = me(); if (!u) return; const g = garage(u);
        if (!data.car) g.active = null; else { if (!CARS[data.car]) return socket.emit('error', 'Araba yok.'); if (!carDone(u, data.car)) return socket.emit('error', 'Önce bütün parçaları tak.'); g.active = data.car; }
        markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        if (g.active) socket.emit('toast', { type: 'success', msg: `${CARS[g.active].name} aktif: etkileri hemen işliyor.` });
    });
    // ── EKİPMAN: üret / kuşan / geliştir / parçala ──
    const gearFind = (u, id) => gear(u).inv.find(x => x.id === String(id || ''));
    const gearPush = u => { markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u)); };
    on('gearCraft', (data) => { // Dökümhane: yuva + kademe; tek üretim kuyruğu; instant = altınla hemen
        const u = me(); if (!u) return; accrue(u); if (!u.base) return socket.emit('error', 'Önce üssünü kur!');
        const g = gear(u), s = String(data.slot || ''), t = int(data.tier);
        if (!GEAR_SLOTS[s] || !(t >= 0 && t < GEAR_TIERS.length)) return socket.emit('error', 'Geçersiz ekipman.');
        if (g.craft && Date.now() >= g.craft.end) finishCraft(u, true);
        if (g.craft) return socket.emit('error', 'Atölye meşgul: önce süren üretim bitmeli.');
        if (g.inv.length >= GEAR_INV_MAX) return socket.emit('error', `Ekipman dolabı dolu (${GEAR_INV_MAX}). Kullanmadıklarını parçala.`);
        const T = GEAR_TIERS[t]; if (bLevel(u, 'smelter_1') < T.smelter) return socket.emit('error', `${T.name} kademesi için Dökümhane Sv. ${T.smelter} gerekli.`);
        const cost = gearCost(s, t); for (const k in cost) if ((g.mat[k] || 0) < cost[k]) return socket.emit('error', `Yetersiz ${MATS[k]}! Gerekli: ${cost[k]} (sende ${g.mat[k] || 0})`);
        if ((u.cash || 0) < T.cash) return socket.emit('error', `Yetersiz Cash! Gerekli: ${T.cash.toLocaleString('tr-TR')}`);
        const dur = craftMs(u, t), gold = data.instant ? instantGold(dur) : 0;
        if (gold && (u.gold || 0) < gold) return socket.emit('error', `Yetersiz altın! Gerekli: ${gold}`);
        for (const k in cost) g.mat[k] -= cost[k]; u.cash -= T.cash; if (gold) u.gold -= gold;
        const now = Date.now(); g.craft = { s, t, start: now, end: now + dur, dur };
        if (gold) { finishCraft(u, true); return gearPush(u); }
        socket.emit('craftStarted', g.craft); gearPush(u);
    });
    on('gearEquip', (data) => { // kuşan (aynı yuvadakinin yerine geçer) · off: çıkar
        const u = me(); if (!u) return; const g = gear(u), it = gearFind(u, data.id); if (!it) return socket.emit('error', 'Ekipman bulunamadı.');
        if (data.off) { if (g.eq[it.s] === it.id) delete g.eq[it.s]; return gearPush(u); }
        const need = GEAR_TIERS[it.t].lead; if (lead(u).lvl < need) return socket.emit('error', `Bu ekipman için Lider Sv. ${need} gerekli.`);
        g.eq[it.s] = it.id; gearPush(u);
    });
    on('gearEnhance', (data) => { // +1 (en çok +5): tarif malzemesinin %25 × (sv+1)'i, +2'den sonra Pırlanta
        const u = me(); if (!u) return; const g = gear(u), it = gearFind(u, data.id); if (!it) return socket.emit('error', 'Ekipman bulunamadı.');
        if ((it.e || 0) >= GEAR_ENH_MAX) return socket.emit('error', 'Bu ekipman en üst seviyede.');
        const cost = enhCost(it); for (const k in cost) if ((g.mat[k] || 0) < cost[k]) return socket.emit('error', `Yetersiz ${MATS[k]}! Gerekli: ${cost[k]} (sende ${g.mat[k] || 0})`);
        for (const k in cost) g.mat[k] -= cost[k]; it.e = (it.e || 0) + 1; addXP(u, 25 * (it.t + 1) * it.e, true);
        socket.emit('toast', { type: 'success', msg: `${gearName(it)} geliştirildi!` }); gearPush(u);
    });
    on('gearSalvage', (data) => { // kuşanılmamış ekipmanı parçala: tarifin yarısı geri
        const u = me(); if (!u) return; const g = gear(u), it = gearFind(u, data.id); if (!it) return socket.emit('error', 'Ekipman bulunamadı.');
        if (g.eq[it.s] === it.id) return socket.emit('error', 'Kuşanılmış ekipman parçalanamaz. Önce çıkar.');
        const back = {}, c = gearCost(it.s, it.t); for (const k in c) { const v = Math.floor(c[k] * 0.5); if (v > 0) back[k] = v; }
        g.inv = g.inv.filter(x => x !== it); giveMats(u, back);
        socket.emit('toast', { type: 'success', msg: `${gearName(it)} parçalandı: ${matText(back)}` }); gearPush(u);
    });
    on('getEvent', () => { const u = me(); if (!u) return; const c = evNow(); socket.emit('eventData', { ...evInfo(u), top: evTop(c.id, 10) }); });
    on('claimEvent', (data) => {
        const u = me(); if (!u) return; const c = evNow(), e = evOf(u), i = int(data.tier) - 1; if (i < 0 || i >= c.E.tiers.length) return socket.emit('error', 'Kademe yok.');
        if (e.claimed[i]) return socket.emit('error', 'Bu ödül alındı.'); if (e.pts < c.E.tiers[i]) return socket.emit('error', 'Yeterli puan yok.');
        e.claimed[i] = true; const R = EV_REWARD[i]; u.gold = (u.gold || 0) + R.gold; giveItems(u, R.items); markDirty('users');
        pushResources(u.username); socket.emit('profileData', publicPlayer(u)); socket.emit('eventData', { ...evInfo(u), top: evTop(c.id, 10) });
        socket.emit('toast', { type: 'victory', msg: `Etkinlik ödülü ${i + 1}: ${R.gold} altın ve eşyalar çantada!` });
    });
    on('getHelps', () => { const u = me(); if (!u) return; socket.emit('helpsData', clanHelps(u)); });
    on('helpAll', () => { // bütün klan isteklerine yardım
        const u = me(); if (!u) return; const L = clanHelps(u); if (!L.length) return socket.emit('error', 'Yardım edilecek inşaat yok.');
        L.forEach(x => { const t = users[x.u]; if (!t || !t.build) return; const rem = t.build.end - Date.now(); t.build.helps = t.build.helps || []; t.build.helps.push(u.username); t.build.end -= helpCut(rem);
            emitTo(t.username, 'buildStarted', t.build); emitTo(t.username, 'toast', { type: 'info', msg: `${u.username} inşaatına yardım etti (-${tfmtS(helpCut(rem))})` }); if (t.build.end <= Date.now()) finishBuild(t, true); markDirty('users'); });
        u.gold = (u.gold || 0) + Math.min(10, L.length); addXP(u, 5 * L.length, true); markDirty('users');
        socket.emit('toast', { type: 'success', msg: `${L.length} klan üyesine yardım ettin (+${Math.min(10, L.length)} altın)` }); socket.emit('helpsData', clanHelps(u)); pushResources(u.username);
    });
    on('claimOnline', () => {
        const u = me(); if (!u) return; const o = onlineTick(u);
        if (o.i >= ONLINE_REWARDS.length) return socket.emit('error', 'Bugünkü bütün çevrimiçi ödülleri alındı.');
        if (onlRem(u) > 1500) return socket.emit('error', 'Bu sandık henüz açılmadı.');
        const r = ONLINE_REWARDS[o.i]; giveItems(u, r.items); if (r.gold) u.gold = (u.gold || 0) + r.gold;
        o.i++; if (o.i < ONLINE_REWARDS.length) { o.left = ONLINE_REWARDS[o.i].min * 60e3; o.since = Date.now(); }
        markDirty('users'); pushResources(u.username); socket.emit('profileData', publicPlayer(u));
        socket.emit('onlineClaimed', { idx: o.i - 1, reward: r }); socket.emit('toast', { type: 'victory', msg: 'Çevrimiçi ödülü çantana eklendi!' });
    });
    on('chatSend', (data) => {
        const u = me(); if (!u) return; const ch = data.ch === 'clan' ? 'clan' : 'world';
        const text = String(data.msg || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200); if (!text) return;
        if (Date.now() - (chatLast[u.username] || 0) < 1500) return socket.emit('error', 'Çok hızlı yazıyorsun.');
        chatLast[u.username] = Date.now();
        const m = { from: u.username, ch: u.character || 'soulreaper', vip: vipLevel(u), clan: u.clan && clans[u.clan] ? clans[u.clan].name : null, msg: text, t: Date.now() };
        if (ch === 'clan') { if (!u.clan) return socket.emit('error', 'Klanın yok.'); const L = chat.clans[u.clan] = chat.clans[u.clan] || []; L.push(m); if (L.length > CHAT_MAX) L.shift(); (clans[u.clan].members || []).forEach(un => emitTo(un, 'chatMsg', Object.assign({ chan: 'clan' }, m))); }
        else { chat.world.push(m); if (chat.world.length > CHAT_MAX) chat.world.shift(); io.emit('chatMsg', Object.assign({ chan: 'world' }, m)); }
    });

    socket.on('disconnect', () => {
        const un = sessions[socket.id];
        delete sessions[socket.id];
        if (un && users[un]) { const u = users[un]; accrue(u);
            if (u.onl && u.onl.since && !Object.values(sessions).includes(un)) { u.onl.left = Math.max(0, onlRem(u)); u.onl.since = null; } // başka sekmesi açık değilse süre durur
            markDirty('users'); }
    });
});

app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
// Eski kayıtları dönüştür — TROOPS/ITEMS/STORY vb. tanımlar hazır olduktan sonra (TDZ hatasını önler)
Object.values(users).forEach(migrateUser); markDirty('users');
initHall();
initLights();
initTer();
initCasino();

server.listen(PORT, () => console.log(`[✓] AtlasWarfare Sunucu Port ${PORT} üzerinde aktif.`));
