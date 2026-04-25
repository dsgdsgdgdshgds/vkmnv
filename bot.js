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
   GÜNCEL BİLGİ - API KEY YOK - %100 ÇALIŞAN
   ══════════════════════════════════════════════════════ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

// 1. ACTUALLY RELEVANT - Key yok, ücretsiz haber API [^2^]
async function actuallyRelevant(query) {
  try {
    const r = await axios.get('https://actually-relevant-api.onrender.com/api/stories', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      timeout: 15000
    });

    const stories = r.data?.stories || [];
    if (stories.length === 0) return [];

    // Query ile ilgili olanları bul
    const q = query.toLowerCase();
    const keywords = q.split(' ').filter(w => w.length > 2);
    
    let filtered = stories.filter(s => {
      const text = `${s.title} ${s.summary} ${s.blurb || ''}`.toLowerCase();
      return keywords.some(k => text.includes(k));
    });

    // İlgili yoksa hepsini göster
    const final = filtered.length > 0 ? filtered : stories;

    return final.slice(0, 3).map(s => ({
      title: s.title,
      url: s.url || s.link,
      snippet: s.summary || s.blurb || s.description,
      source: s.source || 'actuallyrelevant.news',
      date: s.publishedAt || s.date,
      type: 'haber'
    }));
  } catch (e) {
    console.log('[AR] Hata:', e.message);
    return [];
  }
}

// 2. WIKIPEDIA - Resmi API, key yok, her zaman açık [^24^]
async function wikipedia(query) {
  try {
    // Türkçe dene
    let r = await axios.get('https://tr.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        srlimit: 5,
        utf8: 1,
        origin: '*'
      },
      headers: { 'User-Agent': 'EdwardBot/1.0', 'Accept': 'application/json' },
      timeout: 10000
    });

    let results = r.data.query?.search || [];
    
    // Türkçe yoksa İngilizce
    if (results.length === 0) {
      r = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          format: 'json',
          srlimit: 5,
          utf8: 1,
          origin: '*'
        },
        headers: { 'User-Agent': 'EdwardBot/1.0', 'Accept': 'application/json' },
        timeout: 10000
      });
      results = r.data.query?.search || [];
    }

    return results.map(x => ({
      title: x.title,
      url: `https://tr.wikipedia.org/wiki/${encodeURIComponent(x.title)}`,
      snippet: x.snippet?.replace(/<[^>]*>/g, '') || 'Açıklama yok',
      source: 'wikipedia.org',
      type: 'bilgi'
    }));
  } catch (e) {
    console.log('[Wiki] Hata:', e.message);
    return [];
  }
}

// 3. GOOGLE TRENDS - Google'ın kendi sitesi, bloklanmaz
async function googleTrends(query) {
  try {
    const r = await axios.get('https://trends.google.com/trends/trendingsearches/daily/rss', {
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml' },
      timeout: 10000
    });

    const $ = cheerio.load(r.data, { xmlMode: true });
    const items = [];

    $('item').each((i, el) => {
      if (i >= 5) return;
      const title = $(el).find('title').text().trim();
      const traffic = $(el).find('ht\\:approx_traffic').text().trim();
      
      if (title) {
        items.push({
          title: `${title} ${traffic ? `(${traffic} arama)` : ''}`,
          url: $(el).find('link').text().trim(),
          snippet: 'Gündemdeki konu',
          source: 'Google Trends',
          type: 'trend'
        });
      }
    });

    // Query ile ilgili trend varsa filtrele
    const q = query.toLowerCase();
    const filtered = items.filter(i => i.title.toLowerCase().includes(q));
    return filtered.length > 0 ? filtered : items.slice(0, 3);
  } catch (e) {
    console.log('[Trends] Hata:', e.message);
    return [];
  }
}

// 4. SAYFA OKU
async function sayfaOku(url) {
  try {
    if (!url?.startsWith('http')) return null;
    
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9' },
      timeout: 8000,
      maxRedirects: 5
    });

    const $ = cheerio.load(r.data);
    const meta = $('meta[name="description"]').attr('content') || 
                 $('meta[property="og:description"]').attr('content') || '';
    
    let text = '';
    for (const s of ['article', 'main', '.content', '.post-content', 'body']) {
      const el = $(s).first();
      if (el.length && el.text().length > 200) {
        text = el.find('script, style, nav, footer').remove().end().text();
        break;
      }
    }

    const clean = (meta + ' ' + text).replace(/\s+/g, ' ').trim().substring(0, 1000);
    return clean.length > 100 ? clean : null;
  } catch (e) {
    return null;
  }
}

// ANA ARAMA
async function aramaYap(query) {
  console.log(`[ARA] "${query}" aranıyor...`);

  // Hepsini paralel çalıştır
  const [haberler, bilgiler, trendler] = await Promise.allSettled([
    actuallyRelevant(query),
    wikipedia(query),
    googleTrends(query)
  ]);

  let sonuclar = [];
  
  if (haberler.status === 'fulfilled') sonuclar = sonuclar.concat(haberler.value);
  if (bilgiler.status === 'fulfilled') {
    bilgiler.value.forEach(b => {
      if (!sonuclar.find(s => s.url === b.url)) sonuclar.push(b);
    });
  }
  if (trendler.status === 'fulfilled') {
    trendler.value.forEach(t => {
      if (!sonuclar.find(s => s.title === t.title)) sonuclar.push(t);
    });
  }

  if (sonuclar.length === 0) {
    console.log('[ARA] Sonuç yok');
    return null;
  }

  console.log(`[ARA] ${sonuclar.length} sonuç`);

  let ozet = `**📰 Bulunan Bilgiler (${sonuclar.length}):**\n`;
  let detay = '';

  for (let i = 0; i < Math.min(3, sonuclar.length); i++) {
    const s = sonuclar[i];
    ozet += `\n**${i + 1}. ${s.title}**\n`;
    ozet += `📍 ${s.source}${s.date ? ` | ${s.date}` : ''}\n`;
    ozet += `${s.snippet}\n`;

    if (i < 2 && s.type !== 'trend') {
      const icerik = await sayfaOku(s.url);
      if (icerik) {
        detay += `\n---\n📄 ${s.title}\n🔗 ${s.url}\n---\n${icerik}\n`;
      }
    }
  }

  return { ozet, detay: detay.substring(0, 2000), sonuclar };
}

// SORU ANALİZİ - Her soruda araştırma yap
function aramaGerekli(soru) {
  // HER SORU güncel olabilir, her zaman ara
  // Ama bazıları kesinlikle güncel
  const kesin = ['haber', 'bugün', 'dün', 'güncel', 'son dakika', 'dolar', 'euro', 'bitcoin', 'fiyat', 'hava', 'maç', 'skor', 'deprem', 'kaza', 'yangın', 'seçim', 'bakan', 'başkan', 'covid', 'savaş'];
  const muhtemel = ['nedir', 'kimdir', 'nasıl', 'nerede', 'kaç', 'hangi', 'ne zaman', 'neden'];
  
  const s = soru.toLowerCase();
  return kesin.some(k => s.includes(k)) || muhtemel.some(k => s.includes(k)) || soru.length > 5;
}

/* ══════════════════════════════════════════════════════
   GROQ
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.5, deneme = 0, keyIndex = 0) {
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
  
  let webBilgi = '';
  
  // HER SORUDA ARAŞTIRMA YAP
  if (aramaGerekli(soru)) {
    console.log(`[AI] Araştırma: "${soru}"`);
    const veri = await aramaYap(soru);
    if (veri) {
      webBilgi = `\n\n${veri.ozet}\n\n${veri.detay}`;
      console.log(`[AI] ${veri.sonuclar.length} sonuç`);
    }
  }

  const prompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Saat: ${suAn}.
Türkçe konuş, kısa ve net cevaplar ver.

Aşağıdaki web bilgilerini kullan. Kaynakları belirt.
${webBilgi}`;

  if (!mem.has(userId)) mem.set(userId, []);
  const gecmis = mem.get(userId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([{ role: 'system', content: prompt }, ...gecmis]);
  const sonuc = cevap || 'Bilgiye ulaşamadım, tekrar dene.';
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
      const bekleyen = await msg.reply('🔍 Araştırılıyor...');
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
  console.log(`🌐 Web: ActuallyRelevant + Wikipedia + Google Trends`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);