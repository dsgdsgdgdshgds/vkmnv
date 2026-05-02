const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ── DOSYA YOLU ── */
const dataDir = '/var/data';
const filePath = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/* ── SERVER ── */
http.createServer((_, r) => { r.writeHead(200); r.end('OK'); }).listen(process.env.PORT || 8080);

/* ── CONFIG ── */
const GROQ_KEYS = [
  process.env.groq,
  process.env.groq1,
  process.env.groq2,
  process.env.groq3,
  process.env.groq4
].filter(Boolean);

const GOOGLE_API_KEY = process.env.google_api_key;  // Google Custom Search API anahtarı
const GOOGLE_CX      = process.env.google_cx;       // Custom Search Engine ID (cx)

const TOKENS = [
  { token: process.env.token,  char: 'Edward Elric', act: 'Firuze ile Fmab izliyor' },
  { token: process.env.token2, char: 'Awe',           act: 'Aweeeeeee! izliyor'      }
].filter(t => t.token);

const MODEL = 'llama-3.3-70b-versatile';

/* ── HAFIZA (her bot için ayrı) ── */
const memories = new Map(); // char -> Map<userId, messages[]>
const MAX_MESAJ = 6;        // 3 çift

function getMemory(char, userId) {
  if (!memories.has(char)) memories.set(char, new Map());
  const m = memories.get(char);
  if (!m.has(userId)) m.set(userId, []);
  return m.get(userId);
}

/* ── GUARD ── */
const guardData     = new Map();
let activeGuilds    = new Set();
let whiteListedBots = new Set();
const HARIC_ID_LIST = [];

if (fs.existsSync(filePath)) {
  try { activeGuilds = new Set(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }
  catch (e) { console.error('Guard okuma hatası:', e); }
}
if (fs.existsSync(whiteListPath)) {
  try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(whiteListPath, 'utf8'))); }
  catch (e) { console.error('Whitelist okuma hatası:', e); }
}

function saveGuardList() { fs.writeFileSync(filePath,      JSON.stringify([...activeGuilds]),    'utf8'); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify([...whiteListedBots]), 'utf8'); }

/* ══════════════════════════════════════════════════════
   GOOGLE CUSTOM SEARCH
   ══════════════════════════════════════════════════════ */
async function googleSearch(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CX) return null;
  try {
    const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: { key: GOOGLE_API_KEY, cx: GOOGLE_CX, q: query, num: 4, hl: 'tr', gl: 'tr' },
      timeout: 8000
    });
    const items = res.data?.items;
    if (!items?.length) return null;
    return items.map((item, i) => `[${i + 1}] ${item.title}\n${item.snippet}`).join('\n\n');
  } catch (e) {
    console.error('Google Search hatası:', e.message);
    return null;
  }
}

/* ── Güncel bilgi gerektiren soruları tespit et ── */
function aramaGerektirir(soru) {
  const anahtar = [
    'bugün', 'güncel', 'son dakika', 'şu an', 'şimdi', 'haber', 'fiyat',
    'ne kadar', 'kaç lira', 'ne zaman', 'kim kazandı', 'puan', 'sonuç',
    'maç', 'kur', 'dolar', 'euro', 'borsa', 'hava durumu', 'sıcaklık',
    'deprem', 'seçim', 'yeni', 'duyurdu', 'açıkladı', 'çıktı', 'oldu',
    'nerede', 'hangi', '2024', '2025', 'bu yıl', 'bu hafta', 'bu ay'
  ];
  const lower = soru.toLowerCase();
  return anahtar.some(k => lower.includes(k));
}

/* ══════════════════════════════════════════════════════
   GROQ API
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, keyIndex = 0, deneme = 0) {
  const apiKey = GROQ_KEYS[keyIndex];
  if (!apiKey) return null;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: MODEL, messages, temperature: 0.6, max_tokens: 1500 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return res.data.choices[0].message.content.trim();
  } catch (e) {
    const status = e.response?.status;
    const yeniden = status === 429 || status >= 500 || e.message.includes('ECONNRESET') || e.message.includes('timeout');
    if (yeniden) {
      const nextKey = (keyIndex + 1) % GROQ_KEYS.length;
      if (nextKey !== keyIndex) {
        await new Promise(r => setTimeout(r, 1000));
        return groqCall(messages, nextKey, deneme);
      }
      if (deneme < 3) {
        await new Promise(r => setTimeout(r, (deneme + 1) * 4000));
        return groqCall(messages, 0, deneme + 1);
      }
    }
    console.error('Groq hatası:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId, char) {
  const suAn    = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const gecmis  = getMemory(char, kullaniciId);

  // Google araması
  let aramaEki = '';
  if (aramaGerektirir(soru)) {
    const sonuc = await googleSearch(soru);
    if (sonuc) {
      aramaEki = `\n\n[GOOGLE SONUÇLARI - ${suAn}]\n${sonuc}\n[/GOOGLE]`;
    }
  }

  const systemPrompt =
    `Sen ${char}'sin. Geliştiricin Batuhan. Güncel tarih/saat: ${suAn}. Türkçe konuş. ` +
    (aramaEki
      ? 'Sana Google arama sonuçları verildi. Bu bilgileri kullanarak doğru ve güncel cevap ver. Link verme, bilgiyi doğal aktar.'
      : 'Kendi bilginle kısa ve net cevap ver.');

  const kullaniciMesaj = aramaEki ? `${soru}${aramaEki}` : soru;

  gecmis.push({ role: 'user', content: kullaniciMesaj });
  const cevap = await groqCall([{ role: 'system', content: systemPrompt }, ...gecmis]);
  const sonCevap = cevap || (char === 'Awe' ? 'Enerjim bitti...' : 'Simya enerjim düştü...');
  gecmis.push({ role: 'assistant', content: sonCevap });

  if (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);
  return sonCevap;
}

/* ══════════════════════════════════════════════════════
   GUARD SİSTEMİ
   ══════════════════════════════════════════════════════ */
function checkLimit(guildId, userId, action) {
  if (!activeGuilds.has(guildId) || HARIC_ID_LIST.includes(userId)) return true;
  const now = Date.now();
  const key = `${guildId}-${userId}`;
  if (!guardData.has(key)) guardData.set(key, { ban: [], channelDelete: [] });
  const logs = guardData.get(key);
  logs[action] = logs[action].filter(t => now - t < 12 * 60 * 60 * 1000);
  if (logs[action].length >= 2) return false;
  logs[action].push(now);
  return true;
}

async function banIhlalci(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Guard] ${sebep}` }); }
  catch (e) { console.error(`Ban başarısız: ${userId}`); }
}

/* ══════════════════════════════════════════════════════
   BOT BAŞLATMA
   ══════════════════════════════════════════════════════ */
function startBot(config) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
  });

  client.on('messageCreate', async msg => {
    if (msg.author.bot || !msg.guild) return;

    /* Guard komutları */
    if (msg.content.toLowerCase() === 'eguard') {
      if (!msg.member.permissions.has('Administrator')) return msg.reply('Yetkin yok.');
      activeGuilds.add(msg.guild.id);
      saveGuardList();
      return msg.reply('✅ **Guard Aktif!**');
    }

    if (msg.content.toLowerCase().startsWith('ebeyazliste')) {
      if (msg.author.id !== msg.guild.ownerId) return msg.reply('Bunu sadece sunucu sahibi yapabilir.');
      const args  = msg.content.split(' ');
      const islem = args[1];
      const botId = args[2];
      if (!botId) return msg.reply('Bot ID belirtmelisin.');
      if (islem === 'ekle') {
        whiteListedBots.add(botId); saveWhiteList();
        return msg.reply(`✅ \`${botId}\` beyaz listeye eklendi.`);
      }
      if (islem === 'cikar' || islem === 'çıkar') {
        whiteListedBots.delete(botId); saveWhiteList();
        return msg.reply(`❌ \`${botId}\` listeden çıkarıldı.`);
      }
    }

    /* Mention → AI cevap */
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
    if (entry && entry.executor.id !== member.guild.ownerId) {
      await member.ban({ reason: '[Guard] İzinsiz Bot.' }).catch(() => {});
    }
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