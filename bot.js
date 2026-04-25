const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const fs = require('fs');
const path = require('path');

const dataDir = '/var/data';
const filePath = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

http.createServer((_, r) => { r.writeHead(200); r.end('OK'); }).listen(process.env.PORT || 8080);

const GROQ_KEYS = [process.env.groq, process.env.groq1, process.env.groq2, process.env.groq3, process.env.groq4].filter(Boolean);
const DISCORD_TOKEN = process.env.token;
const SMART = 'llama-3.3-70b-versatile';
let currentGroqIndex = 0;

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

function saveGuardList() { fs.writeFileSync(filePath, JSON.stringify([...activeGuilds]), 'utf8'); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify([...whiteListedBots]), 'utf8'); }

/* ══════════════════════════════════════════════════════
   GERÇEK ÇALIŞAN SİSTEM
   DuckDuckGo Lite → URL bul → Jina AI ile oku → Groq özetle
   Jina AI = API key yok, ücretsiz, stabil
   ══════════════════════════════════════════════════════ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

// 1. DuckDuckGo Lite'dan URL bul
async function ddgBul(query) {
  try {
    const r = await axios.get('https://lite.duckduckgo.com/lite/', {
      params: { q: query, kl: 'tr-tr' },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html',
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const $ = cheerio.load(r.data);
    const urls = [];

    $('a.result-link').each((i, el) => {
      if (urls.length >= 5) return;
      const href = $(el).attr('href');
      if (href && href.startsWith('http') && !href.includes('duckduckgo.com')) {
        urls.push(href);
      }
    });

    if (urls.length === 0) {
      $('a[href^="http"]').each((i, el) => {
        if (urls.length >= 5) return;
        const href = $(el).attr('href');
        if (href && !href.includes('duckduckgo.com') && !urls.includes(href)) {
          urls.push(href);
        }
      });
    }

    return urls.slice(0, 3);
  } catch (e) {
    console.log('[DDG] Hata:', e.message);
    return [];
  }
}

// 2. Jina AI ile URL'den içerik çek (API key yok, stabil)
async function jinaOku(url) {
  try {
    if (!url?.startsWith('http')) return null;
    
    const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
    
    const r = await axios.get(jinaUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/plain'
      },
      timeout: 15000
    });

    let text = r.data;
    if (!text || text.length < 50) return null;

    // Jina metadata satırlarını temizle
    const lines = text.split('\n');
    const clean = [];
    for (const line of lines) {
      if (line.startsWith('Title:') || line.startsWith('URL Source:') || line.startsWith('Markdown Content:')) continue;
      clean.push(line);
    }
    
    return clean.join('\n')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 2500);
  } catch (e) {
    console.log('[Jina] Hata:', e.message);
    return null;
  }
}

// 3. Wikipedia yedek
async function wikiBul(query) {
  try {
    const r = await axios.get('https://tr.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        srlimit: 3,
        utf8: 1,
        origin: '*'
      },
      headers: { 'User-Agent': 'EdwardBot/1.0' },
      timeout: 10000
    });

    const results = r.data.query?.search || [];
    return results.map(x => ({
      title: x.title,
      url: `https://tr.wikipedia.org/wiki/${encodeURIComponent(x.title)}`,
      snippet: x.snippet?.replace(/<[^>]*>/g, '') || ''
    }));
  } catch (e) {
    return [];
  }
}

// 4. ANA ARAMA
async function internetAra(query) {
  console.log(`[NET] "${query}" aranıyor...`);
  
  let urls = await ddgBul(query);
  
  if (urls.length === 0) {
    const wiki = await wikiBul(query);
    if (wiki.length > 0) {
      urls = wiki.map(w => w.url);
    }
  }

  if (urls.length === 0) {
    console.log('[NET] Hiç kaynak bulunamadı');
    return null;
  }

  let icerikler = [];
  for (const url of urls) {
    const text = await jinaOku(url);
    if (text) {
      icerikler.push(text);
      console.log(`[NET] Okundu: ${url.substring(0, 40)}...`);
    }
  }

  if (icerikler.length === 0) return null;
  return icerikler.join('\n\n---\n\n').substring(0, 6000);
}

// SORU ANALİZİ
function bilgiSorusuMu(soru) {
  const s = soru.toLowerCase().trim();
  const guncel = ['bugün', 'dün', 'son dakika', 'güncel', 'haber', 'dolar', 'euro', 'bitcoin', 'fiyat', 'hava', 'maç', 'skor', 'deprem', 'kaza', 'seçim', 'yangın', 'savaş', 'bakan', 'başkan'];
  if (guncel.some(k => s.includes(k))) return true;
  
  const bilgi = ['nedir', 'kimdir', 'nasıl', 'nerede', 'ne zaman', 'kaç', 'hangi', 'neden', 'niçin', 'tarihi', 'hakkında', 'bilgi', 'özellikleri', 'farkı', 'karşılaştırma'];
  if (bilgi.some(k => s.includes(k))) return true;
  
  if (s.length > 20) return true;
  return false;
}

/* ══════════════════════════════════════════════════════
   GROQ
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.7, deneme = 0, keyIndex = 0) {
  try {
    const key = GROQ_KEYS[keyIndex];
    if (!key) return null;

    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: SMART, messages, temperature, max_tokens },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );

    currentGroqIndex = keyIndex;
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    const next = (keyIndex + 1) % GROQ_KEYS.length;
    if (next !== keyIndex) {
      await new Promise(r => setTimeout(r, 1000));
      return groqCall(messages, max_tokens, temperature, deneme, next);
    }
    if (deneme < 3) {
      await new Promise(r => setTimeout(r, (deneme + 1) * 4000));
      return groqCall(messages, max_tokens, temperature, deneme + 1, 0);
    }
    return null;
  }
}

async function cevapla(soru, userId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  
  const arastir = bilgiSorusuMu(soru);
  let internetBilgisi = '';
  
  if (arastir) {
    console.log(`[AI] İnternet araştırması: "${soru}"`);
    const veri = await internetAra(soru);
    if (veri) internetBilgisi = veri;
  } else {
    console.log(`[AI] Groq kendi zekasıyla cevaplıyor`);
  }

  const prompt = arastir 
    ? `Sen Edward Elric'sin. Geliştiricin Batuhan. Saat: ${suAn}. Türkçe konuş.

Aşağıdaki internet araştırması bilgilerine dayanarak cevap ver. Sadece bu bilgileri kullan. Kaynak belirtme, sadece doğal cevap ver.

ARAŞTIRMA:
${internetBilgisi}`
    : `Sen Edward Elric'sin. Geliştiricin Batuhan. Saat: ${suAn}. Türkçe konuş, samimi ve doğal cevaplar ver.`;

  if (!mem.has(userId)) mem.set(userId, []);
  const gecmis = mem.get(userId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([{ role: 'system', content: prompt }, ...gecmis]);
  const sonuc = cevap || 'Bir şeyler ters gitti, tekrar dene.';
  gecmis.push({ role: 'assistant', content: sonuc });

  if (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);
  return sonuc;
}

/* ══════════════════════════════════════════════════════
   GUARD
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

async function banla(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Edward Guard] ${sebep}` }); } catch (e) {}
}

/* ══════════════════════════════════════════════════════
   DISCORD
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;

  if (msg.content.toLowerCase() === 'eguard') {
    if (!msg.member.permissions.has('Administrator')) return msg.reply('Yetkin yok.');
    activeGuilds.add(msg.guild.id);
    saveGuardList();
    return msg.reply('✅ Guard Aktif!');
  }

  if (msg.content.toLowerCase().startsWith('ebeyazliste')) {
    if (msg.author.id !== msg.guild.ownerId) return msg.reply('Sadece sunucu sahibi.');
    const args = msg.content.split(' ');
    const islem = args[1];
    const botId = args[2];
    if (!botId) return msg.reply('Bot ID belirt.');

    if (islem === 'ekle') {
      whiteListedBots.add(botId); saveWhiteList();
      return msg.reply(`✅ \`${botId}\` eklendi.`);
    } else if (islem === 'cikar' || islem === 'çıkar') {
      whiteListedBots.delete(botId); saveWhiteList();
      return msg.reply(`❌ \`${botId}\` çıkarıldı.`);
    }
  }

  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return;
    
    try {
      const bekleyen = await msg.reply('⏳ Düşünüyor...');
      const cevap = await cevapla(soru, msg.author.id);
      
      if (cevap.length > 1990) {
        const parcalar = [];
        let parca = '';
        for (const satir of cevap.split('\n')) {
          if ((parca + satir + '\n').length > 1990) {
            if (parca) parcalar.push(parca);
            parca = satir + '\n';
          } else parca += satir + '\n';
        }
        if (parca) parcalar.push(parca);
        
        await bekleyen.edit(parcalar[0] || 'Cevap alınamadı');
        for (let i = 1; i < parcalar.length; i++) await msg.reply(parcalar[i]);
      } else {
        await bekleyen.edit(cevap);
      }
    } catch (e) {
      msg.reply('❌ Hata: ' + e.message);
    }
  }
});

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
    await banla(ban.guild, entry.executor.id, 'Ban limiti.');
  }
});

client.on('channelDelete', async (channel) => {
  if (!activeGuilds.has(channel.guild.id)) return;
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;
  if (!checkLimit(channel.guild.id, entry.executor.id, 'channelDelete')) {
    await channel.clone().catch(() => {});
    await banla(channel.guild, entry.executor.id, 'Kanal silme limiti.');
  }
});

client.once('ready', () => {
  console.log(`✅ Edward Bot Hazır!`);
  console.log(`📡 Groq Keys: ${GROQ_KEYS.length}`);
  console.log(`🌐 İnternet: DuckDuckGo Lite + Jina AI`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);