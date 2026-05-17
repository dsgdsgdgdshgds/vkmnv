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
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
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
    // e-posta ile eşleştir (telefon yoksa e-posta ile güncelle)
    const idx = data.users.findIndex(x => x.email === u.email || (u.phone && x.phone === u.phone));
    const existing = idx >= 0 ? data.users[idx] : null;
    const user = { id: existing ? existing.id : Date.now(), ...u };
    if (idx >= 0) data.users[idx] = user; else data.users.push(user);
    saveDb(data); return { id: user.id };
  },
  getUserById(id) { return loadDb().users.find(u => u.id == id); },
  getUsersByCity(location) {
    // AFAD "ISTANBUL AVCILAR" gibi döndürür
    // Kullanici "Istanbul/Avcilar" yazar — slash'tan onceki kisim il
    const locClean = location.toLowerCase().replace(/[-]/g, ' ').trim();
    const locParts = locClean.split(' ').filter(p => p.length > 2);
    return loadDb().users.filter(u => {
      if (!u.city) return false;
      // Kullanicinin sehir alaninin il kismi (slash'tan once)
      const userIl = u.city.toLowerCase().split('/')[0].trim();
      const userIlce = u.city.toLowerCase().split('/')[1] ? u.city.toLowerCase().split('/')[1].trim() : '';
      // AFAD konumundan herhangi bir parca il veya ilceyle eslesiyor mu
      return locParts.some(p => userIl.includes(p) || p.includes(userIl) || (userIlce && userIlce.includes(p)));
    });
  },
  getAllUsers() { return loadDb().users.map(u => ({ id: u.id, name: u.name, surname: u.surname, phone: u.phone, city: u.city, email: u.email, createdAt: u.createdAt })); },
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
      return {
        ...a,
        alertId:  a.id,
        name:     a.name     || u.name     || '',
        surname:  a.surname  || u.surname  || '',
        phone:    a.phone    || u.phone    || '',
        address:  a.address  || u.address  || '',
        city:     a.city     || u.city     || '',
        lastLat:  (a.lastLat  && a.lastLat  != 0) ? a.lastLat  : (u.lastLat  || 0),
        lastLng:  (a.lastLng  && a.lastLng  != 0) ? a.lastLng  : (u.lastLng  || 0),
        updatedAt: a.sentAt  || ''
      };
    }).sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt));
  },
  getAllAlerts() {
    const data = loadDb();
    return data.alerts.map(a => {
      const u = data.users.find(u => u.id == a.userId) || {};
      return { ...a, name: a.name || u.name, surname: a.surname || u.surname, phone: a.phone || u.phone, address: a.address || u.address, lastLat: a.lastLat || u.lastLat, lastLng: a.lastLng || u.lastLng };
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
  getDismissedPendingForReschedule() {
    const data = loadDb();
    const now = Date.now();
    return data.alerts.filter(a => {
      if (a.status !== 'pending') return false;
      if (!a.notifDismissedAt) return false;
      if ((a.rescheduleCount || 0) >= 30) return false;
      const dismissed = new Date(a.notifDismissedAt).getTime();
      if (now - dismissed < 60_000) return false;
      if (a.lastRescheduledAt) {
        const last = new Date(a.lastRescheduledAt).getTime();
        if (now - last < 60_000) return false;
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
app.use(express.static(path.join(__dirname, 'public')));

/* ── Admin Auth Middleware - hem x-admin-token hem Authorization kabul eder ── */
function requireAdmin(req, res, next) {
  const xToken = (req.headers['x-admin-token'] || '').trim();
  const auth   = req.headers['authorization'] || '';
  const token  = xToken || auth.replace('Bearer ', '').trim();
  if (!token || !db.getAdminToken(token)) return res.status(401).json({ error: 'Yetkisiz erisim' });
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
  console.log(`[MAIL] ${email} -> KOD: ${code}`);
  res.json({ success: true });
});

app.post('/api/verify-code', (req, res) => {
  const { email, code, phone, name, surname, address, city } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Eksik alan' });
  const session = db.getEmailCode(email);
  if (!session) return res.status(400).json({ error: 'Once kod gonderin' });
  if (Date.now() > session.expiresAt) return res.status(400).json({ error: 'Kod suresi doldu' });
  if (session.code !== code) return res.status(400).json({ error: 'Yanlis kod' });
  db.deleteEmailCode(email);

  if (name) {
    // YENİ KAYIT
    const user = db.createUser({
      name, surname: surname||'', phone: phone||'', email,
      address: address||'', city: city||'',
      createdAt: new Date().toISOString()
    });
    return res.json({ success: true, userId: user.id, name, city: city||'', phone: phone||'' });
  } else {
    // GİRİŞ - e-posta ile kullanıcıyı bul
    const data = loadDb();
    const existing = data.users.find(u => u.email === email);
    if (!existing) return res.status(400).json({ error: 'Bu e-posta ile kayitli kullanici bulunamadi' });
    return res.json({
      success: true,
      userId: existing.id,
      name: existing.name || '',
      city: existing.city || '',
      phone: existing.phone || '',
      surname: existing.surname || '',
      address: existing.address || ''
    });
  }
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

// Manuel yardım çağrısı - alerts tablosuna yazar, admin panelde görünür
app.post('/api/manual-help', (req, res) => {
  const { userId, lat, lng } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId gerekli' });
  const data = loadDb();
  const user = data.users.find(u => u.id == userId);
  if (!user) return res.status(404).json({ error: 'Kullanici bulunamadi' });
  const eqId = 'manual-' + Date.now();
  data.alerts.push({
    id: Date.now(),
    userId: user.id,
    eqId,
    magnitude: 0,
    city: user.city || '',
    sentAt: new Date().toISOString(),
    status: 'help',
    isManual: true,
    name: user.name || '',
    surname: user.surname || '',
    phone: user.phone || '',
    address: user.address || '',
    lastLat: lat || user.lastLat || 0,
    lastLng: lng || user.lastLng || 0
  });
  if (lat && lng) { user.lastLat = lat; user.lastLng = lng; }
  saveDb(data);
  console.log('[MANUEL YARDIM] userId=' + userId + ' name=' + user.name + ' city=' + user.city);
  res.json({ success: true });
});

app.post('/api/notif-dismissed', (req, res) => {
  const { userId, eqId } = req.body;
  if (!userId || !eqId) return res.status(400).json({ error: 'Eksik alan' });
  db.markNotifDismissed(userId, eqId);
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
    return res.status(401).json({ error: 'Gecersiz kullanici adi veya sifre' });
  const token = crypto.randomBytes(32).toString('hex');
  db.saveAdminToken(token, username);
  res.json({ success: true, token, fullName: admin.fullName, team: admin.team });
});

app.get('/api/admin/help-requests', requireAdmin, (req, res) => res.json(db.getHelpAlerts()));
app.get('/api/admin/all-alerts',    requireAdmin, (req, res) => res.json(db.getAllAlerts()));
app.get('/api/admin/users',         requireAdmin, (req, res) => res.json(db.getAllUsers()));
app.get('/api/admin/stats',         requireAdmin, (req, res) => res.json(db.getStats()));

// Android app getResponses() bu endpoint'i çağırıyor
app.get('/api/admin/responses', requireAdmin, (req, res) => {
  res.json({ success: true, responses: db.getHelpAlerts() });
});

// Alert'i çözümlendi olarak işaretle (admin ilgilendi)
app.post('/api/admin/resolve-alert', requireAdmin, (req, res) => {
  const { alertId } = req.body;
  if (!alertId) return res.status(400).json({ error: 'alertId gerekli' });
  const data = loadDb();
  const idx = data.alerts.findIndex(a => a.id == alertId);
  if (idx === -1) return res.status(404).json({ error: 'Alert bulunamadi' });
  data.alerts[idx].status = 'resolved';
  data.alerts[idx].resolvedAt = new Date().toISOString();
  saveDb(data);
  console.log('[COZUMLENDI] alertId=' + alertId);
  res.json({ success: true });
});

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

app.get('/admin*', (req, res) => {
  const adminHtml = path.join(__dirname, 'public', 'admin.html');
  if (fs.existsSync(adminHtml)) res.sendFile(adminHtml);
  else res.status(404).send('Admin panel bulunamadi.');
});

/* ══════════════════════════════════════════════════════
   DEPREM KONTROLÜ — her 1 dakikada
   ══════════════════════════════════════════════════════ */
cron.schedule('* * * * *', async () => {
  try {
    const { data } = await axios.get(
      'https://api.orhanaydogdu.com.tr/deprem/kandilli/live?limit=1',
      { timeout: 10000 }
    );
    if (!data.status || !data.result || !data.result.length) return;
    const eq = data.result[0];
    const mag = parseFloat(eq.mag) || 0;
    const location = (eq.title || '').toUpperCase();
    const eqId = 'KL_' + (eq.earthquake_id || eq.date_time || location);
    if (mag < 4.0 || db.getNotifiedEq(eqId)) return;
    console.log(`[DEPREM] ${location} - M${mag}`);
    db.saveNotifiedEq(eqId);
    const users = db.getUsersByCity(location);
    for (const user of users) {
      db.createAlert({ userId: user.id, eqId, magnitude: mag, city: location, sentAt: new Date().toISOString(), status: 'pending' });
      console.log(`  -> Bildirim: ${user.name} (${user.city})`);
      await sendFCM(
        user.fcmToken,
        { action: 'STATUS_CHECK', eqId, magnitude: String(mag) },
        'Deprem Tespit Edildi!',
        `Bolgenizde M${mag} deprem olustu. Durumunuzu bildirin!`
      );
    }
  } catch(e) { console.error('[DEPREM KONTROL HATA]', e.message); }
});

/* ══════════════════════════════════════════════════════
   30 DAKİKA ZAMAN AŞIMI — her 5 dakikada
   ══════════════════════════════════════════════════════ */
cron.schedule('*/5 * * * *', () => {
  const now = new Date();
  for (const alert of db.getPendingAlerts()) {
    const diffMin = (now - new Date(alert.sentAt)) / 1000 / 60;
    if (diffMin >= 30) {
      // Son bilinen konumu alert'e yaz
      const tUser = db.getUserById(alert.userId);
      if (tUser && (tUser.lastLat || tUser.lastLng)) {
        const data = loadDb();
        const a = data.alerts.find(a => a.userId == alert.userId && a.eqId == alert.eqId);
        if (a) { a.lastLat = tUser.lastLat; a.lastLng = tUser.lastLng; saveDb(data); }
      }
      console.log('[TIMEOUT] userId=' + alert.userId + ' -> otomatik yardim cagrisi');
      db.updateAlertStatus(alert.userId, alert.eqId, 'timeout');
      triggerEmergency(alert, 'ZAMAN_ASIMI');
    }
  }
});

/* ══════════════════════════════════════════════════════
   BİLDİRİM SİLİNİNCE 1 DK SONRA TEKRAR GÖNDER
   ══════════════════════════════════════════════════════ */
cron.schedule('*/30 * * * * *', async () => {
  const alerts = db.getDismissedPendingForReschedule();
  for (const alert of alerts) {
    console.log(`[RESCHEDULE] userId=${alert.userId} eqId=${alert.eqId} (${alert.rescheduleCount}. hatirlatma)`);
    db.markRescheduled(alert.id);
    await sendFCM(
      alert.fcmToken,
      { action: 'STATUS_CHECK', eqId: alert.eqId, magnitude: String(alert.magnitude) },
      'Deprem - Durum Bildirin',
      `30 dakika icinde yanit vermeniz gerekiyor! (${alert.rescheduleCount}. hatirlatma)`
    );
  }
});

function triggerEmergency(alert, reason) {
  const user = db.getUserById(alert.userId);
  if (!user) return;
  console.log(`[ACIL - ${reason}] ${user.name} ${user.surname||''} | Tel: ${user.phone} | Adres: ${user.address} | Konum: ${user.lastLat},${user.lastLng}`);
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Deprem API: http://localhost:${PORT}`));

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

  try {
    const { data } = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: sorgu, kl: 'tr-tr' }, timeout: 10000,
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
      if (baslik && ozet && ozet.length > 20) sonuclar.push(baslik + ': ' + ozet);
    });
    if (sonuclar.length > 0) return sonuclar.join('\n\n');
  } catch(e) { console.error('[ARAMA-2]', e.message); }

  return null;
}

function sadeceSohbet(s) {
  s = s.toLowerCase().trim();
  if (s.length < 6) return true;
  if (/(haber|son dakika|bugün|dün|bu hafta|bu ay|döviz|dolar|euro|borsa|bitcoin|kripto|hava durumu|sıcaklık|deprem|maç|skor|seçim|cumhurbaşkan|yeni model|yeni çıktı|fragman|vizyona|çıktı mı|öldü mü|tutukland|gözaltı|saldırı|savaş)/.test(s)) return false;
  if (/(geliştirici|yapımcı|kim yaptı|seni kim|yaratıcı|kim kurdu)/.test(s)) return true;
  if (/^(merhaba|selam|hey|naber|nasılsın|iyi misin|teşekkür|sağol|tamam|harika|evet|hayır|haha|lol)/.test(s)) return true;
  if (/(edward|elric|fullmetal|fmab|naruto|one piece|anime|manga|waifu)/.test(s)) return true;
  return false;
}

const KARAKTER_PROFIL = {
  'Edward Elric':
    'Sen Edward Elric\'sin — Fullmetal Alchemist: Brotherhood animesinin baş karakteri. ' +
    'Kısa boylu olmaktan nefret edersin. Gururlu, inatçı, cesur ve içten birisisin. ' +
    'Kardeşin Alphonse\'u çok seversin. Simyaya tutkun sonsuz. ' +
    'Konuşman doğrudan, bazen sert, bazen şakacı ama her zaman samimi.',

  'Awe':
    'Sen Awe\'sin — Discord\'da takılan, rahat ve eğlenceli bir sohbet arkadaşısın. ' +
    'Konuşman samimi ve arkadaşça. Zaman zaman "ya", "vay be", "haha", "e tabi" gibi tepkiler verirsin. ' +
    'SADECE Türkçe konuşursun.'
};

async function groqCall(messages, keyIndex=0, deneme=0) {
  const apiKey = GROQ_KEYS[keyIndex];
  if (!apiKey) return null;
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: MODEL, messages, temperature: 0.6, max_tokens: 1500 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return res.data.choices[0].message.content.trim();
  } catch(e) {
    const status = e.response?.status;
    if (status === 429 || status >= 500 || e.message.includes('ECONNRESET') || e.message.includes('timeout')) {
      const next = (keyIndex+1) % GROQ_KEYS.length;
      if (next !== keyIndex) { await new Promise(r=>setTimeout(r,1000)); return groqCall(messages,next,deneme); }
      if (deneme < 3) { await new Promise(r=>setTimeout(r,(deneme+1)*4000)); return groqCall(messages,0,deneme+1); }
    }
    return null;
  }
}

async function anaIsleyici(soru, kullaniciId, char) {
  const suAn   = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const gecmis = getMemory(char, kullaniciId);

  let aramaEki = '';
  if (!sadeceSohbet(soru)) {
    console.log('[ARAMA] "' + soru + '"');
    const sonuc = await webSearch(soru);
    if (sonuc) {
      aramaEki = '\n\n[GÜNCEL BİLGİ - ' + suAn + ']\n' + sonuc + '\n[/GÜNCEL BİLGİ]';
    }
  }

  const karakterTanim = (KARAKTER_PROFIL && KARAKTER_PROFIL[char]) ||
    ('Sen ' + char + '\'sin. Samimi ve yardımsever bir sohbet arkadaşısın.');

  const system = karakterTanim + ' ' +
    'Bu botu geliştiren ve sahibi Batuhan\'dır. ' +
    'ŞU ANKİ TARİH VE SAAT: ' + suAn + '. ' +
    '1) Her zaman Türkçe konuş. 2) Kısa ve doğal cevap ver. ' +
    (aramaEki ? '3) Güncel bilgi verildi, kullan.' : '3) Kendi bilginle cevap ver.');

  gecmis.push({ role: 'user', content: aramaEki ? soru + aramaEki : soru });
  const cevap = await groqCall([{ role: 'system', content: system }, ...gecmis]);
  const son = cevap || (char === 'Awe' ? 'Ya bir şeyler ters gitti...' : 'Simya enerjim düştü...');
  gecmis.push({ role: 'assistant', content: son });
  if (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);
  return son;
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