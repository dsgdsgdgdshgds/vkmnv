const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios   = require('axios');
const cheerio = require('cheerio');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const express = require('express');
const cron    = require('node-cron');
const Database = require('better-sqlite3');

/* ── DOSYA YOLU ── */
const dataDir       = '/var/data';
const filePath      = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/* ══════════════════════════════════════════════════════
   DEPREM VERİTABANI
   ══════════════════════════════════════════════════════ */
const sqldb = new Database(path.join(dataDir, 'deprem.db'));
sqldb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, surname TEXT, phone TEXT UNIQUE NOT NULL,
    address TEXT, city TEXT NOT NULL, fcmToken TEXT,
    lastLat REAL, lastLng REAL,
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER, eqId TEXT, magnitude REAL, city TEXT,
    sentAt TEXT, status TEXT DEFAULT 'pending'
  );
  CREATE TABLE IF NOT EXISTS notified_earthquakes (
    eqId TEXT PRIMARY KEY,
    notifiedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sms_codes (
    phone TEXT PRIMARY KEY,
    code TEXT, expiresAt INTEGER
  );
`);

const db = {
  createUser: (u) => {
    const r = sqldb.prepare(`INSERT OR REPLACE INTO users (name,surname,phone,address,city,fcmToken) VALUES (?,?,?,?,?,?)`).run(u.name,u.surname,u.phone,u.address,u.city,u.fcmToken||'');
    return { id: r.lastInsertRowid };
  },
  getUserById: (id) => sqldb.prepare('SELECT * FROM users WHERE id=?').get(id),
  getUsersByCity: (city) => sqldb.prepare("SELECT * FROM users WHERE UPPER(city) LIKE UPPER(?)").all(`%${city}%`),
  updateUserLocation: (id,lat,lng) => sqldb.prepare('UPDATE users SET lastLat=?,lastLng=? WHERE id=?').run(lat,lng,id),
  createAlert: (a) => sqldb.prepare(`INSERT INTO alerts (userId,eqId,magnitude,city,sentAt,status) VALUES (?,?,?,?,?,?)`).run(a.userId,a.eqId,a.magnitude,a.city,a.sentAt,a.status),
  getPendingAlerts: () => sqldb.prepare("SELECT * FROM alerts WHERE status='pending'").all(),
  getAlertByUserAndEq: (uid,eqId) => sqldb.prepare('SELECT * FROM alerts WHERE userId=? AND eqId=?').get(uid,eqId),
  getAlertsByCity: (city) => sqldb.prepare(`SELECT a.*,u.name,u.phone,u.lastLat,u.lastLng FROM alerts a JOIN users u ON a.userId=u.id WHERE UPPER(a.city) LIKE UPPER(?)`).all(`%${city}%`),
  updateAlertStatus: (uid,eqId,status) => sqldb.prepare('UPDATE alerts SET status=? WHERE userId=? AND eqId=?').run(status,uid,eqId),
  saveNotifiedEq: (eqId) => sqldb.prepare('INSERT OR IGNORE INTO notified_earthquakes (eqId) VALUES (?)').run(eqId),
  getNotifiedEq: (eqId) => sqldb.prepare('SELECT * FROM notified_earthquakes WHERE eqId=?').get(eqId),
  saveCode: (phone,code) => sqldb.prepare('INSERT OR REPLACE INTO sms_codes (phone,code,expiresAt) VALUES (?,?,?)').run(phone,code,Date.now()+5*60*1000),
  getCode: (phone) => sqldb.prepare('SELECT * FROM sms_codes WHERE phone=?').get(phone),
  deleteCode: (phone) => sqldb.prepare('DELETE FROM sms_codes WHERE phone=?').run(phone),
};

/* ══════════════════════════════════════════════════════
   EXPRESS API (Deprem Uygulaması)
   ══════════════════════════════════════════════════════ */
const app = express();
app.use(express.json());

// Kod gönder
app.post('/api/send-code', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefon eksik' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  db.saveCode(phone, code);
  console.log(`[SMS] ${phone} → KOD: ${code}`);
  // Netgsm entegrasyonu buraya:
  // axios.get(`https://api.netgsm.com.tr/sms/send/get?usercode=XX&password=XX&gsmno=${phone}&message=Deprem Yardım kodunuz: ${code}`)
  res.json({ success: true });
});

// Kodu doğrula ve kayıt et
app.post('/api/verify-code', (req, res) => {
  const { phone, code, name, surname, address, city } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Eksik alan' });
  const session = db.getCode(phone);
  if (!session) return res.status(400).json({ error: 'Önce kod gönderin' });
  if (Date.now() > session.expiresAt) return res.status(400).json({ error: 'Kod süresi doldu' });
  if (session.code !== code) return res.status(400).json({ error: 'Yanlış kod' });
  db.deleteCode(phone);
  const user = db.createUser({ name:name||'', surname:surname||'', phone, address:address||'', city:city||'' });
  res.json({ success: true, userId: user.id });
});

// Eski kayıt (geriye dönük)
app.post('/api/register', (req, res) => {
  const { name, surname, phone, address, city, fcmToken } = req.body;
  if (!name || !phone || !city) return res.status(400).json({ error: 'Eksik alan' });
  const user = db.createUser({ name, surname, phone, address, city, fcmToken });
  res.json({ success: true, userId: user.id });
});

// Durum bildirimi
app.post('/api/status', (req, res) => {
  const { userId, eqId, status, lat, lng } = req.body;
  if (!userId || !status) return res.status(400).json({ error: 'Eksik alan' });
  db.updateAlertStatus(userId, eqId, status);
  if (lat && lng) db.updateUserLocation(userId, lat, lng);
  if (status === 'help') {
    const alert = db.getAlertByUserAndEq(userId, eqId);
    if (alert) triggerEmergency(alert);
  }
  res.json({ success: true });
});

// Konum güncelle
app.post('/api/location', (req, res) => {
  const { userId, lat, lng } = req.body;
  if (userId && lat && lng) db.updateUserLocation(userId, lat, lng);
  res.json({ success: true });
});

// Şehir uyarıları
app.get('/api/alerts/:city', (req, res) => {
  res.json(db.getAlertsByCity(req.params.city));
});

function triggerEmergency(alert) {
  const user = db.getUserById(alert.userId);
  if (!user) return;
  console.log(`[ACİL] ${user.name} - ${user.address} - Tel: ${user.phone} - Konum: ${user.lastLat},${user.lastLng}`);
}

/* ══════════════════════════════════════════════════════
   AFAD DEPREM KONTROLÜ (her 1 dakika)
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
  } catch (e) { console.error('[AFAD]', e.message); }
});

// 30 dakika timeout
cron.schedule('*/5 * * * *', () => {
  const now = new Date();
  for (const alert of db.getPendingAlerts()) {
    const diff = (now - new Date(alert.sentAt)) / 1000 / 60;
    if (diff >= 30) {
      db.updateAlertStatus(alert.userId, alert.eqId, 'timeout');
      triggerEmergency(alert);
    }
  }
});

/* ══════════════════════════════════════════════════════
   HTTP SERVER (Render port + Express birleşik)
   ══════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Deprem API: http://localhost:${PORT}`));

/* ══════════════════════════════════════════════════════
   DISCORD BOT (orijinal kod aynen)
   ══════════════════════════════════════════════════════ */
const GROQ_KEYS = [
  process.env.groq, process.env.groq1, process.env.groq2,
  process.env.groq3, process.env.groq4
].filter(Boolean);

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

if (fs.existsSync(filePath)) {
  try { activeGuilds = new Set(JSON.parse(fs.readFileSync(filePath, 'utf8'))); } catch(e) {}
}
if (fs.existsSync(whiteListPath)) {
  try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(whiteListPath, 'utf8'))); } catch(e) {}
}

function saveGuardList() { fs.writeFileSync(filePath, JSON.stringify([...activeGuilds]), 'utf8'); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify([...whiteListedBots]), 'utf8'); }

async function webSearch(query) {
  try {
    const { data } = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query, kl: 'tr-tr' }, timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Referer': 'https://duckduckgo.com/'
      }
    });
    const $ = cheerio.load(data);
    const results = [];
    $('#links .result').each((i, el) => {
      if (results.length >= 4) return false;
      const title = $(el).find('.result__a').first().text().trim();
      const snippet = $(el).find('.result__snippet').first().text().trim();
      if (title && snippet && snippet.length > 15)
        results.push(`[${results.length+1}] ${title}\n${snippet}`);
    });
    if (results.length > 0) return results.join('\n\n');
    const zeroClick = $('.zci__body, .c-base__title').first().text().trim();
    if (zeroClick.length > 10) return zeroClick;
    return null;
  } catch(e) { return null; }
}

function sadeceSohbet(soru) {
  const s = soru.toLowerCase().trim();
  return s.length < 8 ||
    /^(merhaba|selam|naber|nasılsın|iyi misin|ne yapıyorsun|kimsin|adın ne|teşekkür|sağol|tamam|harika|süper|anladım|evet|hayır|ok\b)/.test(s);
}

async function groqCall(messages, keyIndex=0, deneme=0) {
  const apiKey = GROQ_KEYS[keyIndex];
  if (!apiKey) return null;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: MODEL, messages, temperature: 0.6, max_tokens: 1500 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return res.data.choices[0].message.content.trim();
  } catch(e) {
    const status = e.response?.status;
    const tekrar = status === 429 || status >= 500 || e.message.includes('ECONNRESET') || e.message.includes('timeout');
    if (tekrar) {
      const nextKey = (keyIndex+1) % GROQ_KEYS.length;
      if (nextKey !== keyIndex) { await new Promise(r=>setTimeout(r,1000)); return groqCall(messages,nextKey,deneme); }
      if (deneme < 3) { await new Promise(r=>setTimeout(r,(deneme+1)*4000)); return groqCall(messages,0,deneme+1); }
    }
    return null;
  }
}

async function anaIsleyici(soru, kullaniciId, char) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const gecmis = getMemory(char, kullaniciId);
  let aramaEki = '';
  if (!sadeceSohbet(soru)) {
    const sonuc = await webSearch(soru);
    if (sonuc) aramaEki = `\n\n[WEB ARAMA SONUÇLARI - ${suAn}]\n${sonuc}\n[/WEB]`;
  }
  const system = `Sen ${char}'sin. Seni yaratan ve sahibin Batuhan'dır. Güncel tarih/saat: ${suAn}. Türkçe konuş. Kısa ve net cevap ver. ` +
    (aramaEki ? 'Sana web arama sonuçları verildi. Bu bilgileri kullanarak doğrudan ve güncel cevap ver.' : 'Kendi bilginle cevap ver.');
  const kullaniciMesaj = aramaEki ? `${soru}${aramaEki}` : soru;
  gecmis.push({ role: 'user', content: kullaniciMesaj });
  const cevap = await groqCall([{ role: 'system', content: system }, ...gecmis]);
  const sonCevap = cevap || (char === 'Awe' ? 'Enerjim bitti...' : 'Simya enerjim düştü...');
  gecmis.push({ role: 'assistant', content: sonCevap });
  if (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);
  return sonCevap;
}

function checkLimit(guildId, userId, action) {
  if (!activeGuilds.has(guildId) || HARIC_ID_LIST.includes(userId)) return true;
  const now = Date.now();
  const key = `${guildId}-${userId}`;
  if (!guardData.has(key)) guardData.set(key, { ban: [], channelDelete: [] });
  const logs = guardData.get(key);
  logs[action] = logs[action].filter(t => now - t < 12*60*60*1000);
  if (logs[action].length >= 2) return false;
  logs[action].push(now);
  return true;
}

async function banIhlalci(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Guard] ${sebep}` }); }
  catch(e) { console.error(`Ban başarısız: ${userId}`); }
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
      if (islem === 'ekle') { whiteListedBots.add(botId); saveWhiteList(); return msg.reply(`✅ \`${botId}\` beyaz listeye eklendi.`); }
      if (islem === 'cikar' || islem === 'çıkar') { whiteListedBots.delete(botId); saveWhiteList(); return msg.reply(`❌ \`${botId}\` listeden çıkarıldı.`); }
    }
    if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
      const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
      if (!soru) return;
      await msg.channel.sendTyping();
      const cevap = await anaIsleyici(soru, msg.author.id, config.char);
      msg.reply(cevap);
    }
  });

  client.on('guildMemberAdd', async member => {
    if (!activeGuilds.has(member.guild.id) || !member.user.bot) return;
    if (whiteListedBots.has(member.id)) return;
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