const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios   = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const cron    = require('node-cron');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

/* ── DOSYA YOLLARI ── */
const dataDir       = '/var/data';
const filePath      = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');
const dbPath        = path.join(dataDir, 'deprem.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/* ── VONAGE SMS ── */
const VONAGE_KEY    = process.env.VONAGE_KEY    || 'RaTRxZYQIor1z4Bm';
const VONAGE_SECRET = process.env.VONAGE_SECRET || 'BURAYA_KOYMA_ENV_KULLAN';
const VONAGE_FROM   = 'DepremYardim';

/* ── ADMIN ── */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'afad2024';
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
const adminTokens = new Map(); // token -> { username, exp }

/* ══════════════════════════════════════════════════════
   JSON VERİTABANI
   ══════════════════════════════════════════════════════ */
function loadDb() {
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch(e) {}
  return { users: [], alerts: [], notified: [], codes: [] };
}
function saveDb(data) { fs.writeFileSync(dbPath, JSON.stringify(data), 'utf8'); }

const db = {
  createUser(u) {
    const data = loadDb();
    const existing = data.users.findIndex(x => x.phone === u.phone);
    const user = { id: existing >= 0 ? data.users[existing].id : Date.now(), ...u };
    if (existing >= 0) data.users[existing] = user; else data.users.push(user);
    saveDb(data); return { id: user.id };
  },
  getUserById(id) { return loadDb().users.find(u => u.id == id); },
  getUsersByCity(city) { return loadDb().users.filter(u => u.city?.toLowerCase().includes(city.toLowerCase())); },
  getAllUsers() { return loadDb().users; },
  updateUserLocation(id, lat, lng) {
    const data = loadDb();
    const u = data.users.find(u => u.id == id);
    if (u) { u.lastLat = lat; u.lastLng = lng; saveDb(data); }
  },
  createAlert(a) {
    const data = loadDb();
    data.alerts.push({ id: Date.now(), ...a });
    saveDb(data);
  },
  getPendingAlerts() { return loadDb().alerts.filter(a => a.status === 'pending'); },
  getAlertByUserAndEq(uid, eqId) { return loadDb().alerts.find(a => a.userId == uid && a.eqId == eqId); },
  getAlertsByCity(city) {
    const data = loadDb();
    return data.alerts.filter(a => a.city?.toLowerCase().includes(city.toLowerCase())).map(a => {
      const u = data.users.find(u => u.id == a.userId) || {};
      return { ...a, name: u.name, phone: u.phone, lastLat: u.lastLat, lastLng: u.lastLng };
    });
  },
  getAllAlerts() {
    const data = loadDb();
    return data.alerts.map(a => {
      const u = data.users.find(u => u.id == a.userId) || {};
      return { ...a, name: u.name||'', surname: u.surname||'', phone: u.phone||'',
               city: u.city||a.city||'', address: u.address||'',
               lastLat: u.lastLat, lastLng: u.lastLng };
    }).sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt));
  },
  updateAlertStatus(uid, eqId, status) {
    const data = loadDb();
    const a = data.alerts.find(a => a.userId == uid && a.eqId == eqId);
    if (a) { a.status = status; saveDb(data); }
  },
  saveNotifiedEq(eqId) {
    const data = loadDb();
    if (!data.notified.includes(eqId)) { data.notified.push(eqId); saveDb(data); }
  },
  getNotifiedEq(eqId) { return loadDb().notified.includes(eqId); },
  saveCode(phone, code) {
    const data = loadDb();
    data.codes = data.codes.filter(c => c.phone !== phone);
    data.codes.push({ phone, code, expiresAt: Date.now() + 5 * 60 * 1000 });
    saveDb(data);
  },
  getCode(phone) { return loadDb().codes.find(c => c.phone === phone); },
  deleteCode(phone) {
    const data = loadDb();
    data.codes = data.codes.filter(c => c.phone !== phone);
    saveDb(data);
  }
};

/* ══════════════════════════════════════════════════════
   EXPRESS API
   ══════════════════════════════════════════════════════ */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── SMS GÖNDER (Twilio) ── */
app.post('/api/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefon eksik' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  db.saveCode(phone, code);
  try {
    await axios.post('https://rest.nexmo.com/sms/json', null, {
      params: {
        api_key: VONAGE_KEY,
        api_secret: VONAGE_SECRET,
        from: VONAGE_FROM,
        to: phone.replace('+',''),
        text: `Deprem Yardim dogrulama kodunuz: ${code}`
      }
    });
    console.log(`[SMS] ${phone} → gonderildi`);
    res.json({ success: true });
  } catch(e) {
    console.error('[SMS HATA]', e.response?.data || e.message);
    res.status(500).json({ error: 'SMS gonderilemedi' });
  }
});

/* ── KOD DOĞRULA ── */
app.post('/api/verify-code', (req, res) => {
  const { phone, code, name, surname, address, city } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Eksik alan' });
  const session = db.getCode(phone);
  if (!session) return res.status(400).json({ error: 'Once kod gonderin' });
  if (Date.now() > session.expiresAt) return res.status(400).json({ error: 'Kod suresi doldu' });
  if (session.code !== code) return res.status(400).json({ error: 'Yanlis kod' });
  db.deleteCode(phone);
  const user = db.createUser({ name: name||'', surname: surname||'', phone, address: address||'', city: city||'' });
  res.json({ success: true, userId: user.id });
});

app.post('/api/register', (req, res) => {
  const { name, surname, phone, address, city, fcmToken } = req.body;
  if (!name || !phone || !city) return res.status(400).json({ error: 'Eksik alan' });
  const user = db.createUser({ name, surname, phone, address, city, fcmToken });
  res.json({ success: true, userId: user.id });
});

app.post('/api/fcm-token', (req, res) => {
  const { userId, fcmToken } = req.body;
  if (userId && fcmToken) {
    const data = loadDb();
    const u = data.users.find(u => u.id == userId);
    if (u) { u.fcmToken = fcmToken; saveDb(data); }
  }
  res.json({ success: true });
});

app.post('/api/status', (req, res) => {
  const { userId, eqId, status, lat, lng } = req.body;
  if (!userId || !status) return res.status(400).json({ error: 'Eksik alan' });
  db.updateAlertStatus(userId, eqId, status);
  if (lat && lng) db.updateUserLocation(userId, lat, lng);
  if (status === 'help') { const a = db.getAlertByUserAndEq(userId, eqId); if (a) triggerEmergency(a); }
  res.json({ success: true });
});

app.post('/api/location', (req, res) => {
  const { userId, lat, lng } = req.body;
  if (userId && lat && lng) db.updateUserLocation(userId, lat, lng);
  res.json({ success: true });
});

app.post('/api/notif-dismissed', (req, res) => {
  const { userId, eqId } = req.body;
  if (userId && eqId) db.updateAlertStatus(userId, eqId, 'dismissed');
  res.json({ success: true });
});

app.get('/api/alerts/:city', (req, res) => res.json(db.getAlertsByCity(req.params.city)));

/* ── ADMİN GİRİŞ ── */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Eksik alan' });
  if (username !== ADMIN_USER || sha256(password) !== sha256(ADMIN_PASS)) {
    return res.status(401).json({ error: 'Kullanici adi veya sifre yanlis' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, { username, exp: Date.now() + 8 * 60 * 60 * 1000 });
  res.json({ success: true, token });
});

/* ── ADMİN MIDDLEWARE ── */
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Token gerekli' });
  const t = adminTokens.get(token);
  if (!t || Date.now() > t.exp) return res.status(401).json({ error: 'Gecersiz token' });
  next();
}

/* ── ADMİN YANIT LİSTESİ ── */
app.get('/api/admin/responses', requireAdmin, (req, res) => {
  const responses = db.getAllAlerts().map(a => ({
    userId: a.userId,
    name: a.name,
    surname: a.surname,
    phone: a.phone,
    city: a.city,
    address: a.address,
    status: a.status,
    eqId: a.eqId,
    lat: a.lastLat || 0,
    lng: a.lastLng || 0,
    updatedAt: a.sentAt || ''
  }));
  res.json({ success: true, responses });
});

app.get('/api/admin/users', requireAdmin, (req, res) => res.json({ success: true, users: db.getAllUsers() }));
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const all = loadDb().alerts;
  res.json({ success: true, total: all.length,
    pending: all.filter(a=>a.status==='pending').length,
    safe: all.filter(a=>a.status==='safe').length,
    help: all.filter(a=>a.status==='help').length });
});

function triggerEmergency(alert) {
  const user = db.getUserById(alert.userId);
  if (!user) return;
  console.log(`[ACİL] ${user.name} - ${user.address} - Tel: ${user.phone} - Konum: ${user.lastLat},${user.lastLng}`);
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Deprem API: http://localhost:${PORT}`));

/* ══════════════════════════════════════════════════════
   AFAD DEPREM KONTROLÜ
   ══════════════════════════════════════════════════════ */
cron.schedule('* * * * *', async () => {
  try {
    const r = await axios.get('https://deprem.afad.gov.tr/apiv2/event/filter?orderby=timedesc&limit=1&format=json', { timeout: 8000 });
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
    }
  } catch(e) { console.error('[AFAD]', e.message); }
});

cron.schedule('*/5 * * * *', () => {
  const now = new Date();
  for (const alert of db.getPendingAlerts()) {
    if ((now - new Date(alert.sentAt)) / 1000 / 60 >= 30) {
      db.updateAlertStatus(alert.userId, alert.eqId, 'timeout');
      triggerEmergency(alert);
    }
  }
});

/* ══════════════════════════════════════════════════════
   DISCORD BOT
   ══════════════════════════════════════════════════════ */
const GROQ_KEYS = [process.env.groq, process.env.groq1, process.env.groq2, process.env.groq3, process.env.groq4].filter(Boolean);
const TOKENS = [
  { token: process.env.token,  char: 'Edward Elric', act: 'Firuze ile Fmab izliyor' },
  { token: process.env.token2, char: 'Awe',          act: 'Aweeeeeee! izliyor' }
].filter(t => t.token);

const MODEL = 'llama-3.3-70b-versatile';
const memories = new Map();
const MAX_MESAJ = 6;

function getMemory(char, userId) {
  if (!memories.has(char)) memories.set(char, new Map());
  const m = memories.get(char);
  if (!m.has(userId)) m.set(userId, []);
  return m.get(userId);
}

const guardData = new Map();
let activeGuilds = new Set();
let whiteListedBots = new Set();
const HARIC_ID_LIST = [];

if (fs.existsSync(filePath)) { try { activeGuilds = new Set(JSON.parse(fs.readFileSync(filePath, 'utf8'))); } catch(e) {} }
if (fs.existsSync(whiteListPath)) { try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(whiteListPath, 'utf8'))); } catch(e) {} }

function saveGuardList() { fs.writeFileSync(filePath, JSON.stringify([...activeGuilds]), 'utf8'); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify([...whiteListedBots]), 'utf8'); }

async function webSearch(query) {
  try {
    const { data } = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query, kl: 'tr-tr' }, timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'tr-TR,tr;q=0.9', 'Referer': 'https://duckduckgo.com/' }
    });
    const $ = cheerio.load(data);
    const results = [];
    $('#links .result').each((i, el) => {
      if (results.length >= 4) return false;
      const title = $(el).find('.result__a').first().text().trim();
      const snippet = $(el).find('.result__snippet').first().text().trim();
      if (title && snippet && snippet.length > 15) results.push(`[${results.length+1}] ${title}\n${snippet}`);
    });
    if (results.length > 0) return results.join('\n\n');
    const zc = $('.zci__body, .c-base__title').first().text().trim();
    return zc.length > 10 ? zc : null;
  } catch(e) { return null; }
}

function sadeceSohbet(s) {
  s = s.toLowerCase().trim();
  return s.length < 8 || /^(merhaba|selam|naber|nasılsın|iyi misin|ne yapıyorsun|kimsin|adın ne|teşekkür|sağol|tamam|harika|süper|anladım|evet|hayır|ok\b)/.test(s);
}

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
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const gecmis = getMemory(char, kullaniciId);
  let aramaEki = '';
  if (!sadeceSohbet(soru)) { const s = await webSearch(soru); if (s) aramaEki = `\n\n[WEB - ${suAn}]\n${s}\n[/WEB]`; }
  const system = `Sen ${char}'sin. Sahibin Batuhan. Tarih: ${suAn}. Türkçe, kısa cevap ver.` +
    (aramaEki ? ' Web sonuçlarını kullan, yönlendirme yapma.' : ' Kendi bilginle cevap ver.');
  gecmis.push({ role: 'user', content: aramaEki ? `${soru}${aramaEki}` : soru });
  const cevap = await groqCall([{ role: 'system', content: system }, ...gecmis]);
  const son = cevap || (char === 'Awe' ? 'Enerjim bitti...' : 'Simya enerjim düştü...');
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
              GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildPresences],
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