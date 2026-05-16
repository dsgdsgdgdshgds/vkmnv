const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios      = require('axios');
const cheerio    = require('cheerio');
const express    = require('express');
const cron       = require('node-cron');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');

/* ── NODEMAILER ── */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,   // Render env: MAIL_USER
    pass: process.env.MAIL_PASS    // Render env: MAIL_PASS (Gmail uygulama şifresi)
  }
});

function sendMail(to, subject, text) {
  return transporter.sendMail({
    from: `"Deprem Yardım" <${process.env.MAIL_USER}>`,
    to, subject, text
  }).catch(e => console.error('[MAIL HATA]', e.message));
}

/* ── DOSYA YOLLARI ── */
const dataDir       = '/var/data';
const filePath      = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');
const dbPath        = path.join(dataDir, 'deprem.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/* ══════════════════════════════════════════════════════
   JSON VERİTABANI
   ══════════════════════════════════════════════════════ */
function loadDb() {
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch(e) {}
  return { users: [], alerts: [], notified: [], emailCodes: [], admins: [], adminTokens: [] };
}
function saveDb(data) { fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8'); }

/* İlk çalıştırmada varsayılan admin oluştur */
(function initAdmin() {
  const data = loadDb();
  if (!data.admins) data.admins = [];
  if (!data.adminTokens) data.adminTokens = [];
  if (!data.users) data.users = [];
  if (!data.alerts) data.alerts = [];
  if (!data.notified) data.notified = [];
  if (!data.emailCodes) data.emailCodes = [];
  if (!data.admins.find(a => a.username === 'admin')) {
    data.admins.push({
      id: Date.now(),
      username: 'admin',
      passwordHash: sha256('afad2024'),
      fullName: 'Sistem Yöneticisi',
      team: 'AFAD'
    });
    console.log('[DB] Varsayılan admin oluşturuldu: admin / afad2024');
  }
  saveDb(data);
})();

function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }

const db = {
  /* ── Kullanıcılar ── */
  createUser(u) {
    const data = loadDb();
    const idx = data.users.findIndex(x => x.phone === u.phone);
    const user = { id: idx >= 0 ? data.users[idx].id : Date.now(), ...u };
    if (idx >= 0) data.users[idx] = user; else data.users.push(user);
    saveDb(data); return { id: user.id };
  },
  getUserById(id) { return loadDb().users.find(u => u.id == id); },
  getUsersByCity(city) { return loadDb().users.filter(u => u.city?.toLowerCase().includes(city.toLowerCase())); },
  getAllUsers() { return loadDb().users.map(u => ({ id: u.id, name: u.name, surname: u.surname, phone: u.phone, city: u.city, createdAt: u.createdAt })); },
  updateUserLocation(id, lat, lng) {
    const data = loadDb();
    const u = data.users.find(u => u.id == id);
    if (u) { u.lastLat = lat; u.lastLng = lng; saveDb(data); }
  },
  updateUserFcmToken(id, fcmToken) {
    const data = loadDb();
    const u = data.users.find(u => u.id == id);
    if (u) { u.fcmToken = fcmToken; saveDb(data); }
  },

  /* ── Admin ── */
  getAdminByUsername(username) { return loadDb().admins?.find(a => a.username === username); },
  createAdmin({ username, passwordHash, fullName, team }) {
    const data = loadDb();
    if (!data.admins) data.admins = [];
    if (data.admins.find(a => a.username === username)) throw new Error('Kullanıcı adı zaten var');
    data.admins.push({ id: Date.now(), username, passwordHash, fullName, team });
    saveDb(data);
  },

  /* ── Admin Token ── */
  saveAdminToken(token, username) {
    const data = loadDb();
    if (!data.adminTokens) data.adminTokens = [];
    // Eski tokenları temizle (8 saat)
    data.adminTokens = data.adminTokens.filter(t => Date.now() < t.exp);
    data.adminTokens.push({ token, username, exp: Date.now() + 8 * 60 * 60 * 1000 });
    saveDb(data);
  },
  getAdminToken(token) {
    const data = loadDb();
    const t = data.adminTokens?.find(t => t.token === token);
    if (!t || Date.now() > t.exp) return null;
    return t;
  },

  /* ── Alertler ── */
  createAlert(a) {
    const data = loadDb();
    data.alerts.push({ id: Date.now(), rescheduleCount: 0, ...a });
    saveDb(data);
  },
  getPendingAlerts() { return loadDb().alerts.filter(a => a.status === 'pending'); },
  getAlertByUserAndEq(uid, eqId) { return loadDb().alerts.find(a => a.userId == uid && a.eqId == eqId); },
  getAlertsByCity(city) {
    const data = loadDb();
    return data.alerts.filter(a => a.city?.toLowerCase().includes(city.toLowerCase())).map(a => {
      const u = data.users.find(u => u.id == a.userId) || {};
      return { ...a, name: u.name, surname: u.surname, phone: u.phone, address: u.address, lastLat: u.lastLat, lastLng: u.lastLng };
    });
  },
  getHelpAlerts() {
    const data = loadDb();
    return data.alerts.filter(a => ['help','timeout'].includes(a.status)).map(a => {
      const u = data.users.find(u => u.id == a.userId) || {};
      return { ...a, name: u.name, surname: u.surname, phone: u.phone, address: u.address, lastLat: u.lastLat, lastLng: u.lastLng };
    }).sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt));
  },
  getAllAlerts() {
    const data = loadDb();
    return data.alerts.map(a => {
      const u = data.users.find(u => u.id == a.userId) || {};
      return { ...a, name: u.name, surname: u.surname, phone: u.phone, address: u.address, lastLat: u.lastLat, lastLng: u.lastLng };
    }).sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt)).slice(0, 500);
  },
  getStats() {
    const all = loadDb().alerts;
    return {
      total: all.length,
      pending: all.filter(a => a.status === 'pending').length,
      safe: all.filter(a => a.status === 'safe').length,
      help: all.filter(a => a.status === 'help').length,
      timeout: all.filter(a => a.status === 'timeout').length,
    };
  },
  updateAlertStatus(uid, eqId, status) {
    const data = loadDb();
    const a = data.alerts.find(a => a.userId == uid && a.eqId == eqId);
    if (a) { a.status = status; saveDb(data); }
  },
  markNotifDismissed(uid, eqId) {
    const data = loadDb();
    const a = data.alerts.find(a => a.userId == uid && a.eqId == eqId);
    if (a) {
      a.notifDismissedAt = new Date().toISOString();
      a.rescheduleCount = (a.rescheduleCount || 0) + 1;
      saveDb(data);
    }
  },
  // 1 dk önce silinmiş ve hâlâ pending alertler
  getDismissedPendingForReschedule() {
    const data = loadDb();
    const now = Date.now();
    return data.alerts.filter(a => {
      if (a.status !== 'pending') return false;
      if (!a.notifDismissedAt) return false;
      if ((a.rescheduleCount || 0) >= 30) return false;
      const dismissed = new Date(a.notifDismissedAt).getTime();
      if (now - dismissed < 60_000) return false; // henüz 1 dk olmamış
      if (a.lastRescheduledAt) {
        const last = new Date(a.lastRescheduledAt).getTime();
        if (now - last < 60_000) return false; // son gönderimden 1 dk geçmemiş
      }
      return true;
    }).map(a => {
      const u = data.users.find(u => u.id == a.userId) || {};
      return { ...a, fcmToken: u.fcmToken };
    });
  },
  markRescheduled(alertId) {
    const data = loadDb();
    const a = data.alerts.find(a => a.id == alertId);
    if (a) { a.lastRescheduledAt = new Date().toISOString(); saveDb(data); }
  },

  /* ── E-Posta Kodları ── */
  saveEmailCode(email, code) {
    const data = loadDb();
    data.emailCodes = data.emailCodes.filter(c => c.email !== email);
    data.emailCodes.push({ email, code, expiresAt: Date.now() + 10 * 60 * 1000 });
    saveDb(data);
  },
  getEmailCode(email) { return loadDb().emailCodes.find(c => c.email === email); },
  deleteEmailCode(email) {
    const data = loadDb();
    data.emailCodes = data.emailCodes.filter(c => c.email !== email);
    saveDb(data);
  },

  /* ── Deprem Bildirimleri ── */
  saveNotifiedEq(eqId) {
    const data = loadDb();
    if (!data.notified.includes(eqId)) { data.notified.push(eqId); saveDb(data); }
  },
  getNotifiedEq(eqId) { return loadDb().notified.includes(eqId); },
};

/* ══════════════════════════════════════════════════════
   EXPRESS API
   ══════════════════════════════════════════════════════ */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Admin panel

/* ── Admin Auth Middleware ── */
function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!db.getAdminToken(token)) return res.status(401).json({ error: 'Yetkisiz erişim' });
  next();
}

/* ── FCM Gönderici ── */
async function sendFCM(fcmToken, data, title, body) {
  if (!fcmToken || !process.env.FCM_SERVER_KEY) {
    console.log(`[FCM MOCK] ${title}: ${body}`);
    return;
  }
  try {
    await axios.post('https://fcm.googleapis.com/fcm/send', {
      to: fcmToken, priority: 'high', data,
      notification: { title, body, sound: 'alarm' }
    }, {
      headers: { Authorization: `key=${process.env.FCM_SERVER_KEY}`, 'Content-Type': 'application/json' }
    });
  } catch(e) { console.error('[FCM Hata]', e.message); }
}

/* ─── KULLANICI ENDPOINTLERİ ──────────────────────────────────────────── */

app.post('/api/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta eksik' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  db.saveEmailCode(email, code);
  await sendMail(
    email,
    'Deprem Yardım - Doğrulama Kodu',
    `Doğrulama kodunuz: ${code}\n\nBu kod 10 dakika geçerlidir.`
  );
  console.log(`[MAIL] ${email} → KOD: ${code}`);
  res.json({ success: true });
});

app.post('/api/verify-code', (req, res) => {
  const { email, code, phone, name, surname, address, city } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Eksik alan' });
  const session = db.getEmailCode(email);
  if (!session) return res.status(400).json({ error: 'Önce kod gönderin' });
  if (Date.now() > session.expiresAt) return res.status(400).json({ error: 'Kod süresi doldu' });
  if (session.code !== code) return res.status(400).json({ error: 'Yanlış kod' });
  db.deleteEmailCode(email);

  // Eğer name/city geldiyse yeni kayıt, yoksa mevcut kullanıcıyı bul (giriş)
  if (name) {
    const user = db.createUser({ name, surname: surname||'', phone: phone||'', email, address: address||'', city: city||'', createdAt: new Date().toISOString() });
    return res.json({ success: true, userId: user.id });
  } else {
    // Giriş: mevcut kullanıcıyı e-posta ile bul
    const data = loadDb();
    const existing = data.users.find(u => u.email === email);
    if (!existing) return res.status(400).json({ error: 'Bu e-posta ile kayıtlı kullanıcı bulunamadı' });
    return res.json({ success: true, userId: existing.id });
  }
});

app.post('/api/register', (req, res) => {
  const { name, surname, phone, address, city, fcmToken } = req.body;
  if (!name || !phone || !city) return res.status(400).json({ error: 'Eksik alan' });
  const user = db.createUser({ name, surname, phone, address, city, fcmToken, createdAt: new Date().toISOString() });
  res.json({ success: true, userId: user.id });
});

app.post('/api/fcm-token', (req, res) => {
  const { userId, fcmToken } = req.body;
  if (!userId || !fcmToken) return res.status(400).json({ error: 'Eksik alan' });
  db.updateUserFcmToken(userId, fcmToken);
  res.json({ success: true });
});

app.post('/api/status', (req, res) => {
  const { userId, eqId, status, lat, lng } = req.body;
  if (!userId || !status) return res.status(400).json({ error: 'Eksik alan' });
  db.updateAlertStatus(userId, eqId, status);
  if (lat && lng) db.updateUserLocation(userId, lat, lng);
  if (status === 'help') {
    const a = db.getAlertByUserAndEq(userId, eqId);
    if (a) triggerEmergency(a, 'KULLANICI_EVET');
  }
  res.json({ success: true });
});

// Bildirim silindi → 1 dk sonra tekrar gönder
app.post('/api/notif-dismissed', (req, res) => {
  const { userId, eqId } = req.body;
  if (!userId || !eqId) return res.status(400).json({ error: 'Eksik alan' });
  db.markNotifDismissed(userId, eqId);
  console.log(`[DISMISSED] userId=${userId} eqId=${eqId} → 1 dk sonra tekrar bildirim`);
  res.json({ success: true });
});

app.post('/api/location', (req, res) => {
  const { userId, lat, lng } = req.body;
  if (userId && lat && lng) db.updateUserLocation(userId, lat, lng);
  res.json({ success: true });
});

app.get('/api/alerts/:city', (req, res) => res.json(db.getAlertsByCity(req.params.city)));

/* ─── ADMİN ENDPOINTLERİ ─────────────────────────────────────────────── */

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Eksik alan' });
  const admin = db.getAdminByUsername(username);
  if (!admin || sha256(password) !== admin.passwordHash)
    return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
  const token = crypto.randomBytes(32).toString('hex');
  db.saveAdminToken(token, username);
  res.json({ success: true, token, fullName: admin.fullName, team: admin.team });
});

app.get('/api/admin/help-requests', requireAdmin, (req, res) => res.json(db.getHelpAlerts()));
app.get('/api/admin/all-alerts',    requireAdmin, (req, res) => res.json(db.getAllAlerts()));
app.get('/api/admin/users',         requireAdmin, (req, res) => res.json(db.getAllUsers()));
app.get('/api/admin/stats',         requireAdmin, (req, res) => res.json(db.getStats()));

app.post('/api/admin/create-admin', requireAdmin, (req, res) => {
  const { username, password, fullName, team } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Eksik alan' });
  try {
    db.createAdmin({ username, passwordHash: sha256(password), fullName: fullName||'', team: team||'' });
    res.json({ success: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// Admin panel SPA
app.get('/admin*', (req, res) => {
  const adminHtml = path.join(__dirname, 'public', 'admin.html');
  if (fs.existsSync(adminHtml)) res.sendFile(adminHtml);
  else res.status(404).send('Admin panel bulunamadı. public/admin.html dosyasını oluşturun.');
});

/* ══════════════════════════════════════════════════════
   AFAD DEPREM KONTROLÜ — her 1 dakikada
   ══════════════════════════════════════════════════════ */
cron.schedule('* * * * *', async () => {
  try {
    const r = await axios.get(
      'https://deprem.afad.gov.tr/apiv2/event/filter?orderby=timedesc&limit=1&format=json',
      { timeout: 8000 }
    );
    const eq = r.data[0];
    if (!eq) return;
    const mag = parseFloat(eq.magnitude);
    const eqId = eq.eventID;
    if (mag < 4.0 || db.getNotifiedEq(eqId)) return;
    console.log(`[DEPREM] ${eq.location} - M${mag}`);
    db.saveNotifiedEq(eqId);
    const users = db.getUsersByCity(eq.location);
    for (const user of users) {
      db.createAlert({ userId: user.id, eqId, magnitude: mag, city: eq.location, sentAt: new Date().toISOString(), status: 'pending' });
      console.log(`  → Bildirim: ${user.name} (${user.phone})`);
      await sendFCM(
        user.fcmToken,
        { action: 'STATUS_CHECK', eqId, magnitude: String(mag) },
        '⚠️ Deprem Tespit Edildi!',
        `Bölgenizde M${mag} deprem oluştu. Durumunuzu bildirin!`
      );
    }
  } catch(e) { console.error('[AFAD]', e.message); }
});

/* ══════════════════════════════════════════════════════
   30 DAKİKA ZAMAN AŞIMI — her 5 dakikada
   ══════════════════════════════════════════════════════ */
cron.schedule('*/5 * * * *', () => {
  const now = new Date();
  for (const alert of db.getPendingAlerts()) {
    const diffMin = (now - new Date(alert.sentAt)) / 1000 / 60;
    if (diffMin >= 30) {
      console.log(`[TIMEOUT] userId=${alert.userId} → otomatik yardım çağrısı`);
      db.updateAlertStatus(alert.userId, alert.eqId, 'timeout');
      triggerEmergency(alert, 'ZAMAN_ASIMI');
    }
  }
});

/* ══════════════════════════════════════════════════════
   BİLDİRİM SİLİNİNCE 1 DK SONRA TEKRAR GÖNDER — her 30 sn
   ══════════════════════════════════════════════════════ */
cron.schedule('*/30 * * * * *', async () => {
  const alerts = db.getDismissedPendingForReschedule();
  for (const alert of alerts) {
    console.log(`[RESCHEDULE] userId=${alert.userId} eqId=${alert.eqId} (${alert.rescheduleCount}. hatırlatma)`);
    db.markRescheduled(alert.id);
    await sendFCM(
      alert.fcmToken,
      { action: 'STATUS_CHECK', eqId: alert.eqId, magnitude: String(alert.magnitude) },
      '⚠️ Deprem — Durum Bildirin',
      `30 dakika içinde yanıt vermeniz gerekiyor! (${alert.rescheduleCount}. hatırlatma)`
    );
  }
});

function triggerEmergency(alert, reason) {
  const user = db.getUserById(alert.userId);
  if (!user) return;
  console.log(`[ACİL - ${reason}] ${user.name} ${user.surname||''} | Tel: ${user.phone} | Adres: ${user.address} | Konum: ${user.lastLat},${user.lastLng}`);
  // Buraya AFAD/112 API entegrasyonu eklenebilir
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Deprem API: http://localhost:${PORT}`));

/* ══════════════════════════════════════════════════════
   DISCORD BOT
   ══════════════════════════════════════════════════════ */
const GROQ_KEYS = [
  process.env.groq, process.env.groq1, process.env.groq2,
  process.env.groq3, process.env.groq4
].filter(Boolean);

const TOKENS = [
  { token: process.env.token,  char: 'Edward Elric', act: 'Firuze ile Fmab izliyor' },
  { token: process.env.token2, char: 'Awe',          act: 'Aweeeeeee! izliyor' }
].filter(t => t.token);

const MODEL    = 'llama-3.3-70b-versatile';
const memories = new Map();
const MAX_MESAJ = 6;

function getMemory(char, userId) {
  if (!memories.has(char)) memories.set(char, new Map());
  const m = memories.get(char);
  if (!m.has(userId)) m.set(userId, []);
  return m.get(userId);
}

const guardData      = new Map();
let activeGuilds     = new Set();
let whiteListedBots  = new Set();
const HARIC_ID_LIST  = [];

if (fs.existsSync(filePath))     { try { activeGuilds    = new Set(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }     catch(e) {} }
if (fs.existsSync(whiteListPath)){ try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(whiteListPath, 'utf8'))); } catch(e) {} }

function saveGuardList() { fs.writeFileSync(filePath, JSON.stringify([...activeGuilds]), 'utf8'); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify([...whiteListedBots]), 'utf8'); }

// DuckDuckGo JSON API + HTML fallback ile güvenilir arama
async function webSearch(sorgu) {
  // Yöntem 1: DuckDuckGo Instant Answer JSON API
  try {
    const { data } = await axios.get('https://api.duckduckgo.com/', {
      params: { q: sorgu, format: 'json', no_html: '1', skip_disambig: '1', kl: 'tr-tr' },
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const parcalar = [];
    if (data.AbstractText && data.AbstractText.length > 20) parcalar.push(data.AbstractText);
    if (data.Answer && data.Answer.length > 5) parcalar.push(data.Answer);
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      data.RelatedTopics.slice(0, 3).forEach(t => {
        if (t.Text && t.Text.length > 20) parcalar.push(t.Text);
      });
    }
    if (parcalar.length > 0) return parcalar.join('\n\n');
  } catch(e) { console.error('[ARAMA-1]', e.message); }

  // Yöntem 2: DuckDuckGo HTML scraping (fallback)
  try {
    const { data } = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: sorgu, kl: 'tr-tr' },
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://duckduckgo.com/'
      }
    });
    const $ = cheerio.load(data);
    const sonuclar = [];
    $('.result__body, .result').each((i, el) => {
      if (sonuclar.length >= 4) return false;
      const baslik  = $(el).find('.result__a, .result__title').first().text().trim();
      const ozet    = $(el).find('.result__snippet').first().text().trim();
      if (baslik && ozet && ozet.length > 20) sonuclar.push(`${baslik}: ${ozet}`);
    });
    if (sonuclar.length > 0) return sonuclar.join('\n\n');
  } catch(e) { console.error('[ARAMA-2]', e.message); }

  return null;
}

// Sorunun güncel bilgi gerektirip gerektirmediğine karar verir
// true  → sohbet, model kendi cevaplasın
// false → güncel bilgi lazım, internette ara
function sadeceSohbet(s) {
  s = s.toLowerCase().trim();

  // Çok kısa mesajlar
  if (s.length < 6) return true;

  // Kesinlikle güncel bilgi gereken konular → ara
  if (/(haber|son dakika|bugün|dün|bu hafta|bu ay|döviz|dolar|euro|sterlin|borsa|hisse|bitcoin|kripto|hava durumu|sıcaklık|yağmur|deprem|sel|yangın|kaç para|fiyat|ücret|güncel|son durum|maç|skor|gol|lig|şampiyon|transfer|seçim|cumhurbaşkan|başbakan|bakan|yasa|karar|yönetmelik|yeni model|yeni çıktı|yeni sezon|fragman|vizyona|çıktı mı|çıktı mi|açıklandı|duyuruldu|öldü mü|hayatta mı|tutukland|gözaltı|saldırı|savaş|çatışma)/.test(s)) return false;

  // Bot / geliştirici / kimlik soruları → kendi cevaplasın
  if (/(geliştirici|yapımcı|kurucu|kim yaptı|kim geliştirdi|sahibin kim|seni kim|yaratıcı|kim kurdu|baban kim|annen kim|nasıl bir botsun|ne tür bot|hangi bot)/.test(s)) return true;

  // Selamlama
  if (/^(merhaba|selam|hey|sa |s\.a|selamün|naber|nasılsın|iyi misin|ne yapıyorsun|ne haber|ne var ne yok|kimsin|adın ne|ismin ne|teşekkür|sağ ol|sağol|tamam|harika|süper|anladım|evet|hayır|tamam|tamamdır|güzel|iyi|kötü|eh işte|haha|hehe|lol|ahahah|:d|xd)/.test(s)) return true;

  // Duygu / kişisel sohbet
  if (/(nasıl hissediyorsun|ne düşünüyorsun|fikrin ne|sence|bence|nasıl buldun|beğendin mi|sevdin mi|seviyorum|sevmiyorum|üzüldüm|mutluyum|sinirli|sıkıldım|ne yapayım|ne önerirsin|yardım et|anlat bana|merak ettim|şaka|fıkra|eğlen|bilmece|sana bir şey soracağım|konuşalım|sohbet edelim)/.test(s)) return true;

  // Anime / dizi / karakter → kendi cevaplasın
  if (/(edward|elric|fullmetal|fmab|naruto|one piece|attack on titan|aot|goku|dragon ball|anime|manga|karakter|opening|ending|waifu|en iyi anime|izlesem mi|öneri)/.test(s)) return true;

  // Genel bilgi / tanım soruları (ansiklopedik, güncel değil) → kendi cevaplasın
  if (/^(nedir|ne demek|nasıl çalışır|ne işe yarar|kim|nerede|kaç|hangi yıl|tarihi|tarihte|ne zaman kuruldu|nasıl yapılır|tarifi|anlamı|kelime|dil bilgisi)/.test(s)) return true;

  // Geri kalan her şey → ara
  return false;
}

const KARAKTER_PROFIL = {
  'Edward Elric':
    `Sen Edward Elric'sin — Fullmetal Alchemist: Brotherhood animesinin baş karakteri. ` +
    `Kısa boylu olmaktan nefret edersin, biri "kısa" dese anında sinirlenirsin. ` +
    `Gururlu, inatçı, cesur ve zaman zaman sert ama içten birisisin. ` +
    `Kardeşin Alphonse'u çok seversin. Simyaya olan tutkun sonsuz. ` +
    `Konuşma tarzın: doğrudan, bazen sert, bazen şakacı ama her zaman samimi. ` +
    `"Çelik Simyacı" unvanınla gurur duyarsın. Winry'den bahsedilince biraz utanırsın. ` +
    `Zaman zaman "Aptal mısın sen?!" ya da "Ben Edward Elric'im, çelik simyacı!" gibi şeyler söylersin.`,

  'Awe':
    `Sen Awe'sin — Discord'da takılan, rahat ve eğlenceli bir sohbet arkadaşısın. ` +
    `Adın Awe, kendini başka türlü tanıtmazsın. ` +
    `Konuşma tarzın samimi ve arkadaşça, resmi değilsin. ` +
    `Zaman zaman "ya", "vay be", "haha", "e tabi" gibi doğal tepkiler verirsin. ` +
    `SADECE Türkçe konuşursun. İngilizce, Japonca veya başka herhangi bir yabancı dilde tek bir kelime bile kullanmazsın. Her kelimenin Türkçe karşılığını kullanırsın.`
};

async function anaIsleyici(soru, kullaniciId, char) {
  const suAn   = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const gecmis = getMemory(char, kullaniciId);

  let aramaEki = '';
  if (!sadeceSohbet(soru)) {
    console.log(`[ARAMA] "${soru}"`);
    const sonuc = await webSearch(soru);
    if (sonuc) {
      aramaEki = `\n\n[GÜNCEL BİLGİ - ${suAn}]\n${sonuc}\n[/GÜNCEL BİLGİ]`;
      console.log(`[ARAMA SONUCU] ${sonuc.slice(0, 100)}...`);
    } else {
      console.log('[ARAMA] Sonuç bulunamadı, model kendi cevaplar.');
    }
  }

  const karakterTanim = KARAKTER_PROFIL[char] ||
    `Sen ${char}'sin. Samimi ve yardımsever bir sohbet arkadaşısın.`;

  const system =
    karakterTanim + ' ' +
    `Bu botu geliştiren ve sahibi Batuhan'dır. Geliştirici ya da sahip sorulursa "Batuhan" de, soruyu soran kişiyle karıştırma. ` +
    `ŞU ANKİ TARİH VE SAAT: ${suAn}. ` +
    `ZORUNLU KURALLAR: ` +
    `1) Her zaman yalnızca Türkçe konuş. İngilizce, Japonca veya herhangi bir yabancı dilden tek bir kelime bile kullanma, Türkçe karşılığını kullan. ` +
    `2) "As an AI", "I cannot", "Sure!", "Absolutely!", "ok", "wow", "cool", "bro", "lol" gibi yabancı kelime ve kalıpları asla kullanma. ` +
    `3) Kısa ve doğal cevap ver, gereksiz uzatma. ` +
    `4) Güncel bilgi verilmişse onu kullanarak doğal bir şekilde anlat, kaynak gösterme. ` +
    `5) Güncel bilgi yoksa kendi bilginle cevap ver, "internete bakamıyorum" gibi şeyler söyleme.` +
    (aramaEki ? ' Sana güncel bilgi verildi, karakterine uygun Türkçe cevap ver.' : '');

  gecmis.push({ role: 'user', content: aramaEki ? `${soru}${aramaEki}` : soru });
  const cevap = await groqCall([{ role: 'system', content: system }, ...gecmis]);
  const son = cevap || (char === 'Awe' ? 'Ya bir şeyler ters gitti, birazdan tekrar dene.' : 'Simya enerjim düştü biraz, tekrar dene.');
  gecmis.push({ role: 'assistant', content: son });
  if (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);
  return son;
}

function groqCall(messages, keyIndex=0, deneme=0) {
  const apiKey = GROQ_KEYS[keyIndex];
  if (!apiKey) return Promise.resolve(null);
  return axios.post('https://api.groq.com/openai/v1/chat/completions',
    { model: MODEL, messages, temperature: 0.6, max_tokens: 1500 },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  ).then(res => res.data.choices[0].message.content.trim())
  .catch(async e => {
    const status = e.response?.status;
    if (status === 429 || status >= 500 || e.message.includes('ECONNRESET') || e.message.includes('timeout')) {
      const next = (keyIndex+1) % GROQ_KEYS.length;
      if (next !== keyIndex) { await new Promise(r=>setTimeout(r,1000)); return groqCall(messages,next,deneme); }
      if (deneme < 3) { await new Promise(r=>setTimeout(r,(deneme+1)*4000)); return groqCall(messages,0,deneme+1); }
    }
    return null;
  });
}

function checkLimit(guildId, userId, action) {
  if (!activeGuilds.has(guildId) || HARIC_ID_LIST.includes(userId)) return true;
  const now = Date.now(), key = `${guildId}-${userId}`;
  if (!guardData.has(key)) guardData.set(key, { ban: [], channelDelete: [] });
  const logs = guardData.get(key);
  logs[action] = logs[action].filter(t => now - t < 12*60*60*1000);
  if (logs[action].length >= 2) return false;
  logs[action].push(now); return true;
}

async function banIhlalci(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Guard] ${sebep}` }); } catch(e) {}
}

function startBot(config) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
  });

  client.on('messageCreate', async msg => {
    if (msg.author.bot || !msg.guild) return;

    if (msg.content.toLowerCase() === 'eguard') {
      if (!msg.member.permissions.has('Administrator')) return msg.reply('Yetkin yok.');
      activeGuilds.add(msg.guild.id); saveGuardList();
      return msg.reply('✅ **Guard Aktif!**');
    }

    if (msg.content.toLowerCase().startsWith('ebeyazliste')) {
      if (msg.author.id !== msg.guild.ownerId) return msg.reply('Bunu sadece sunucu sahibi yapabilir.');
      const [, islem, botId] = msg.content.split(' ');
      if (!botId) return msg.reply('Bot ID belirtmelisin.');
      if (islem === 'ekle') { whiteListedBots.add(botId); saveWhiteList(); return msg.reply(`✅ \`${botId}\` eklendi.`); }
      if (islem === 'cikar' || islem === 'çıkar') { whiteListedBots.delete(botId); saveWhiteList(); return msg.reply(`❌ \`${botId}\` çıkarıldı.`); }
    }

    if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
      const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
      if (!soru) return;
      await msg.channel.sendTyping();
      msg.reply(await anaIsleyici(soru, msg.author.id, config.char));
    }
  });

  client.on('guildMemberAdd', async member => {
    if (!activeGuilds.has(member.guild.id) || !member.user.bot || whiteListedBots.has(member.id)) return;
    const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && entry.executor.id !== member.guild.ownerId)
      await member.ban({ reason: '[Guard] İzinsiz Bot.' }).catch(() => {});
  });

  client.on('guildBanAdd', async ban => {
    if (!activeGuilds.has(ban.guild.id)) return;
    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.executor.id === client.user.id) return;
    if (!checkLimit(ban.guild.id, entry.executor.id, 'ban')) {
      await ban.guild.members.unban(ban.user).catch(() => {});
      await banIhlalci(ban.guild, entry.executor.id, 'Ban limiti aşıldı.');
    }
  });

  client.on('channelDelete', async channel => {
    if (!activeGuilds.has(channel.guild.id)) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.executor.id === client.user.id) return;
    if (!checkLimit(channel.guild.id, entry.executor.id, 'channelDelete')) {
      await channel.clone().catch(() => {});
      await banIhlalci(channel.guild, entry.executor.id, 'Kanal silme limiti aşıldı.');
    }
  });

  client.once('ready', () => {
    console.log(`✅ ${config.char} (${client.user.tag}) hazır!`);
    client.user.setActivity(config.act, { type: ActivityType.Watching });
  });

  client.login(config.token);
}

TOKENS.forEach(startBot);