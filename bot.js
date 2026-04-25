const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

/* ── DOSYA YOLU VE DİZİN KONTROLÜ (MEHMET) ── */
const dataDir = '/var/data';
const filePath = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/* ── SERVER (MEHMET) ── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG (MEHMET) ── */
const GROQ_KEYS = [
  process.env.groq,
  process.env.groq1,
  process.env.groq2,
  process.env.groq3,
  process.env.groq4
].filter(Boolean);

const DISCORD_TOKEN = process.env.token;
const SMART = 'llama-3.3-70b-versatile';
let currentGroqIndex = 0;

/* ── HAFIZA VE GUARD CONFIG (MEHMET) ── */
const mem = new Map();
const MAX_MESAJ = 3;
const guardData = new Map();
let activeGuilds = new Set();
let whiteListedBots = new Set();
const HARIC_ID_LIST = [];

if (fs.existsSync(filePath)) {
  try { activeGuilds = new Set(JSON.parse(fs.readFileSync(filePath, 'utf8'))); } catch (e) {}
}
if (fs.existsSync(whiteListPath)) {
  try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(whiteListPath, 'utf8'))); } catch (e) {}
}

function saveGuardList() { fs.writeFileSync(filePath, JSON.stringify(Array.from(activeGuilds)), 'utf8'); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify(Array.from(whiteListedBots)), 'utf8'); }

/* ══════════════════════════════════════════════════════
   GROQ API - MULTIPLE KEY SİSTEMİ (MEHMET'İN YAPISI)
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.5, keyIndex = 0) {
  try {
    const apiKey = GROQ_KEYS[keyIndex];
    if (!apiKey) return null;

    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: SMART, messages, temperature, max_tokens },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    
    currentGroqIndex = keyIndex;
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    const nextKeyIndex = (keyIndex + 1) % GROQ_KEYS.length;
    if (nextKeyIndex !== keyIndex) {
      return groqCall(messages, max_tokens, temperature, nextKeyIndex);
    }
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   🌐 AHMET'İN TAM WEB GEZGİNİ SİSTEMİ
   ══════════════════════════════════════════════════════ */

async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 10 },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const sonuclar = [];
    $('a').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.startsWith('/url?q=')) {
        const url = href.replace('/url?q=', '').split('&')[0];
        if (url.startsWith('http') && !url.includes('google.com')) {
          const baslik = $(elem).find('h3').text().trim();
          if (baslik) sonuclar.push({ url, baslik });
        }
      }
    });
    return sonuclar.slice(0, 8);
  } catch (e) {
    // AHMET'İN DUCKDUCKGO FALLBACK'İ
    try {
      const { data } = await axios.post('https://html.duckduckgo.com/html/', 
        new URLSearchParams({ q: sorgu }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
      );
      const $ = cheerio.load(data);
      const sonuclar = [];
      $('.result').each((i, elem) => {
        const a = $(elem).find('.result__a');
        const url = a.attr('href');
        const baslik = a.text().trim();
        if (url && baslik) sonuclar.push({ url, baslik });
      });
      return sonuclar.slice(0, 8);
    } catch (e2) { return []; }
  }
}

async function siteZiyaretcisi(linkler, strateji) {
  const icerikler = [];
  const promises = linkler.slice(0, 5).map(async (link) => {
    try {
      const { data } = await axios.get(link.url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const $ = cheerio.load(data);
      let metin = '';
      $('p, h1, h2, h3, article').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) metin += text + '\n';
      });
      
      metin = metin.substring(0, 3000);
      let alakaPuani = 0;
      strateji.anahtar_kelimeler.forEach(kelime => {
        const regex = new RegExp(kelime, 'gi');
        const matches = metin.match(regex);
        if (matches) alakaPuani += matches.length;
      });

      if (metin.length > 100) {
        icerikler.push({ url: link.url, baslik: link.baslik, metin, alaka: alakaPuani });
      }
    } catch (e) {}
  });

  await Promise.allSettled(promises);
  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

/* ══════════════════════════════════════════════════════
   🧠 ANA İŞLEYİCİ - AKILLI KARAR & BİRLEŞTİRME
   ══════════════════════════════════════════════════════ */

async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  
  // 1. Niyet Analizi (Ahmet'in JSON Formatı)
  const niyetAnalizi = await groqCall([
    {
      role: 'system',
      content: `Kullanıcının sorusunu analiz et. SADECE JSON formatında şunu döndür:
      {
        "aramaGerekli": true/false,
        "niyet": "bilgi/sohbet",
        "anahtar_kelimeler": ["kelime1", "kelime2"],
        "arama_sorgulari": ["sorgu1"]
      }`
    },
    { role: 'user', content: soru }
  ], 300, 0.2);

  let strateji = { aramaGerekli: false, anahtar_kelimeler: [], arama_sorgulari: [soru] };
  try {
    const match = niyetAnalizi.match(/\{[\s\S]*\}/);
    if (match) strateji = JSON.parse(match[0]);
  } catch (e) {}

  let webVerisi = "";
  if (strateji.aramaGerekli) {
    const linkler = await googleArama(strateji.arama_sorgulari[0]);
    const siteler = await siteZiyaretcisi(linkler, strateji);
    webVerisi = siteler.map((s, i) => `[VERİ ${i+1}]\n${s.metin}`).join('\n---\n');
  }

  // 2. Yanıt Oluşturma (Edward Elric Kişiliği)
  const systemPrompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. 
  ${webVerisi ? `İnternetten gelen veriler:\n${webVerisi}` : "Bu genel bir sohbet, kendi simya bilginle yanıtla."}
  Kesinlikle kaynak linki verme. Türkçe konuş.`;

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });
  
  const cevap = await groqCall([{ role: 'system', content: systemPrompt }, ...gecmis]);
  const sonCevap = cevap || 'Simya enerjim tükendi...';
  
  gecmis.push({ role: 'assistant', content: sonCevap });
  if (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);

  return sonCevap;
}

/* ══════════════════════════════════════════════════════
   GUARD SİSTEMİ (MEHMET - AYNI KALDI)
   ══════════════════════════════════════════════════════ */
function checkLimit(guildId, userId, action) {
  if (!activeGuilds.has(guildId) || HARIC_ID_LIST.includes(userId)) return true;
  const now = Date.now();
  const key = `${guildId}-${userId}`;
  if (!guardData.has(key)) guardData.set(key, { ban: [], channelDelete: [] });
  const logs = guardData.get(key);
  logs[action] = logs[action].filter(t => now - t < (12 * 60 * 60 * 1000));
  if (logs[action].length >= 2) return false;
  logs[action].push(now);
  return true;
}

async function banIhlalci(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Edward Guard] ${sebep}` }); } catch (e) {}
}

/* ══════════════════════════════════════════════════════
   DISCORD BOT MOTORU
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;

  if (msg.content.toLowerCase() === 'eguard') {
    if (!msg.member.permissions.has('Administrator')) return;
    activeGuilds.add(msg.guild.id);
    saveGuardList();
    return msg.reply('✅ **Guard Aktif!**');
  }

  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return;
    await msg.channel.sendTyping();
    
    const cevap = await anaIsleyici(soru, msg.author.id);
    
    if (cevap.length > 2000) {
      const chunks = cevap.match(/[\s\S]{1,1900}/g);
      for (const chunk of chunks) await msg.channel.send(chunk);
    } else {
      msg.reply(cevap);
    }
  }
});

/* ── GUARD OLAYLARI (MEHMET) ── */
client.on('guildMemberAdd', async (member) => {
  if (!activeGuilds.has(member.guild.id) || !member.user.bot) return;
  if (whiteListedBots.has(member.id)) return;
  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
  const entry = audit?.entries.first();
  if (entry && entry.executor.id !== member.guild.ownerId) {
    await member.ban({ reason: '[Edward Guard] İzinsiz Bot.' }).catch(() => {});
  }
});

client.on('guildBanAdd', async (ban) => {
  if (!activeGuilds.has(ban.guild.id)) return;
  const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;
  if (!checkLimit(ban.guild.id, entry.executor.id, 'ban')) {
    await ban.guild.members.unban(ban.user).catch(() => {});
    await banIhlalci(ban.guild, entry.executor.id, 'Ban limiti.');
  }
});

client.on('channelDelete', async (channel) => {
  if (!activeGuilds.has(channel.guild.id)) return;
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;
  if (!checkLimit(channel.guild.id, entry.executor.id, 'channelDelete')) {
    await channel.clone().catch(() => {});
    await banIhlalci(channel.guild, entry.executor.id, 'Kanal silme limiti.');
  }
});

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} hazır! Ahmet'in web gezgini entegre edildi.`);
});

client.login(DISCORD_TOKEN);