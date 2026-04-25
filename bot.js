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

/* ── HAFIZA (MEHMET) ── */
const mem = new Map();
const MAX_MESAJ = 3;

/* ── GUARD CONFIG (MEHMET) ── */
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
   GROQ API FONKSIYONLARI (MEHMET'İN ÇOKLU KEY SİSTEMİ)
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
   🌐 AHMET'İN WEB GEZGİNİ ARAÇLARI
   ══════════════════════════════════════════════════════ */

async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 5 },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 8000
    });
    const $ = cheerio.load(data);
    const sonuclar = [];
    $('a').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.startsWith('/url?q=')) {
        const url = href.replace('/url?q=', '').split('&')[0];
        if (url.startsWith('http') && !url.includes('google.com')) sonuclar.push(url);
      }
    });
    return sonuclar.slice(0, 3);
  } catch (e) { return []; }
}

async function siteZiyaretcisi(linkler) {
  const icerikler = [];
  const promises = linkler.map(async (url) => {
    try {
      const { data } = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const $ = cheerio.load(data);
      let metin = '';
      $('p').each((i, el) => { if (i < 5) metin += $(el).text() + ' '; });
      if (metin.length > 50) icerikler.push(metin.substring(0, 1500));
    } catch (e) {}
  });
  await Promise.allSettled(promises);
  return icerikler.join('\n\n');
}

/* ══════════════════════════════════════════════════════
   🧠 AKILLI KARAR MEKANİZMASI VE ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */

async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  
  // 1. ADIM: Arama Gerekli mi Karar Ver
  const kararPrompt = [
    { role: 'system', content: 'Kullanıcının sorusu güncel bilgi (haber, hava durumu, fiyat, 2025/2026 olayları) gerektiriyor mu? Sadece "EVET" veya "HAYIR" yaz.' },
    { role: 'user', content: soru }
  ];
  const karar = await groqCall(kararPrompt, 10, 0.1);
  const aramaGerekli = karar?.includes('EVET');

  let webBilgisi = "";
  if (aramaGerekli) {
    console.log(`🔍 Güncel bilgi aranıyor: ${soru}`);
    const linkler = await googleArama(soru);
    webBilgisi = await siteZiyaretcisi(linkler);
  }

  // 2. ADIM: Edward Elric Kişiliği ile Yanıtla
  const systemPrompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. 
  ${webBilgisi ? `İnternetten bulduğum güncel bilgiler: ${webBilgisi}` : "Bu genel bir sohbet, simya bilginle yanıt ver."}
  Kesinlikle kaynak linki paylaşma. Türkçe konuş.`;

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });
  
  const cevap = await groqCall([{ role: 'system', content: systemPrompt }, ...gecmis]);
  const sonCevap = cevap || 'Transmutasyon başarısız oldu...';
  
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
   DISCORD BAĞLANTISI (MEHMET - AYNI KALDI)
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
    if (!msg.member.permissions.has('Administrator')) return msg.reply('Yetkin yok.');
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
  console.log(`✅ ${client.user.tag} hazır! Akıllı Karar Mekanizması aktif.`);
  client.user.setActivity('Simya ve Web arasında', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);