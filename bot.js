const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ── DOSYA YOLU VE DİZİN KONTROLÜ ── */
const dataDir = '/var/data';
const filePath = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/* ── SERVER ── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG ── */
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

/* ── HAFIZA ── */
const mem = new Map();
const MAX_MESAJ = 3;

/* ── GUARD CONFIG ── */
const guardData = new Map();
let activeGuilds = new Set();
let whiteListedBots = new Set();
const HARIC_ID_LIST = [];

// Verileri yükle
if (fs.existsSync(filePath)) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    activeGuilds = new Set(data);
  } catch (e) { console.error("Guard listesi okuma hatası:", e); }
}

if (fs.existsSync(whiteListPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(whiteListPath, 'utf8'));
    whiteListedBots = new Set(data);
  } catch (e) { console.error("Beyaz liste okuma hatası:", e); }
}

function saveGuardList() {
  fs.writeFileSync(filePath, JSON.stringify(Array.from(activeGuilds)), 'utf8');
}
function saveWhiteList() {
  fs.writeFileSync(whiteListPath, JSON.stringify(Array.from(whiteListedBots)), 'utf8');
}

/* ══════════════════════════════════════════════════════
   GÜNCEL BİLGİ SİSTEMİ - API KEY GEREKTİRMEZ
   Çoklu kaynak + yedekleme + hata toleransı
   ══════════════════════════════════════════════════════ */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15'
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Cache sistemi
const searchCache = new Map();
const CACHE_SURE = 5 * 60 * 1000; // 5 dakika

/* ── 1. WIKIPEDIA API (En güvenilir, resmi API) ── */
async function wikipediaArama(query) {
  try {
    console.log(`[Wikipedia] "${query}" aranıyor...`);
    
    // Önce Türkçe dene
    let response = await axios.get('https://tr.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        srlimit: 5,
        utf8: 1
      },
      headers: { 
        'User-Agent': randomUserAgent(),
        'Accept': 'application/json'
      },
      timeout: 8000
    });

    let results = response.data.query?.search || [];
    
    // Türkçe sonuç yoksa İngilizce dene
    if (results.length === 0) {
      response = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          format: 'json',
          srlimit: 5,
          utf8: 1
        },
        headers: { 
          'User-Agent': randomUserAgent(),
          'Accept': 'application/json'
        },
        timeout: 8000
      });
      results = response.data.query?.search || [];
    }

    if (results.length === 0) return [];

    return results.map(r => ({
      title: r.title,
      url: `https://tr.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
      snippet: r.snippet.replace(/<\/?[^>]+(>|$)/g, ''),
      source: 'wikipedia.org',
      type: 'wiki'
    }));
  } catch (e) {
    console.error("[Wikipedia] Hata:", e.message);
    return [];
  }
}

/* ── 2. DUCKDUCKGO HTML SCRAPING (JSON API yerine HTML) ── */
async function duckduckgoScrape(query) {
  try {
    console.log(`[DuckDuckGo HTML] "${query}" aranıyor...`);
    
    const response = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('.result').each((i, elem) => {
      if (i >= 5) return;
      
      const title = $(elem).find('.result__title').text().trim();
      const url = $(elem).find('.result__url').text().trim() || $(elem).find('.result__a').attr('href');
      const snippet = $(elem).find('.result__snippet').text().trim();

      if (title && url) {
        results.push({
          title,
          url: url.startsWith('http') ? url : `https://${url}`,
          snippet: snippet || 'Açıklama yok',
          source: 'duckduckgo.com',
          type: 'web'
        });
      }
    });

    console.log(`[DuckDuckGo HTML] ${results.length} sonuç`);
    return results;
  } catch (e) {
    console.error("[DuckDuckGo HTML] Hata:", e.message);
    return [];
  }
}

/* ── 3. BİNG HTML SCRAPING ── */
async function bingScrape(query) {
  try {
    console.log(`[Bing] "${query}" aranıyor...`);
    
    const response = await axios.get('https://www.bing.com/search', {
      params: { q: query, setmkt: 'tr-TR', setlang: 'tr' },
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Referer': 'https://www.bing.com/'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Bing'in farklı layout'ları için çoklu seçici
    const selectors = [
      'li.b_algo',
      '.b_algo',
      '[data-bm]'
    ];

    for (const selector of selectors) {
      $(selector).each((i, elem) => {
        if (results.length >= 5) return;
        
        const title = $(elem).find('h2 a, .b_title a').first().text().trim();
        const url = $(elem).find('h2 a, .b_title a').first().attr('href');
        const snippet = $(elem).find('.b_caption p, .b_snippet').first().text().trim();

        if (title && url && !results.find(r => r.url === url)) {
          results.push({
            title,
            url,
            snippet: snippet || 'Açıklama yok',
            source: 'bing.com',
            type: 'web'
          });
        }
      });
    }

    console.log(`[Bing] ${results.length} sonuç`);
    return results;
  } catch (e) {
    console.error("[Bing] Hata:", e.message);
    return [];
  }
}

/* ── 4. GOOGLE NEWS RSS (API key yok, RSS feed) ── */
async function googleNewsRSS(query) {
  try {
    console.log(`[Google News RSS] "${query}" aranıyor...`);
    
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=tr&gl=TR&ceid=TR:tr`;
    
    const response = await axios.get(rssUrl, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'application/rss+xml,application/xml,text/xml'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const results = [];

    $('item').each((i, elem) => {
      if (i >= 5) return;
      
      const title = $(elem).find('title').text().trim();
      const url = $(elem).find('link').text().trim();
      const snippet = $(elem).find('description').text().trim();
      const pubDate = $(elem).find('pubDate').text().trim();

      if (title && url) {
        results.push({
          title,
          url,
          snippet: snippet.replace(/<[^>]*>/g, '').substring(0, 200),
          source: 'news.google.com',
          date: pubDate,
          type: 'news'
        });
      }
    });

    console.log(`[Google News RSS] ${results.length} sonuç`);
    return results;
  } catch (e) {
    console.error("[Google News RSS] Hata:", e.message);
    return [];
  }
}

/* ── 5. ACTUALLY RELEVANT API (Key yok, ücretsiz) ── */
async function actuallyRelevantAPI(query) {
  try {
    console.log(`[ActuallyRelevant] "${query}" aranıyor...`);
    
    // Konuyu İngilizce'ye çevirmeye çalış (basit)
    const issueMap = {
      'iklim': 'planet-climate',
      'climate': 'planet-climate',
      'teknoloji': 'science-technology',
      'technology': 'science-technology',
      'bilim': 'science-technology',
      'science': 'science-technology',
      'insan': 'human-development',
      'human': 'human-development',
      'gelişme': 'human-development',
      'tehdit': 'existential-threats',
      'threat': 'existential-threats'
    };
    
    let issueSlug = null;
    const lowerQuery = query.toLowerCase();
    for (const [key, value] of Object.entries(issueMap)) {
      if (lowerQuery.includes(key)) {
        issueSlug = value;
        break;
      }
    }

    const url = issueSlug 
      ? `https://actually-relevant-api.onrender.com/api/stories?issueSlug=${issueSlug}`
      : 'https://actually-relevant-api.onrender.com/api/stories';

    const response = await axios.get(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    const stories = response.data?.stories || response.data || [];
    
    return stories.slice(0, 3).map(s => ({
      title: s.title || 'Başlık Yok',
      url: s.url || s.link || '',
      snippet: s.summary || s.blurb || s.description || 'Özet yok',
      source: s.source || 'actuallyrelevant.news',
      type: 'news'
    }));
  } catch (e) {
    console.error("[ActuallyRelevant] Hata:", e.message);
    return [];
  }
}

/* ── SAYFA İÇERİĞİ ÇEK (Geliştirilmiş) ── */
async function sayfaIcekGeter(url) {
  try {
    if (!url || !url.startsWith('http')) return null;

    console.log(`[OKUMA] ${url} okunuyor...`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/'
      },
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    const $ = cheerio.load(response.data);
    
    // Meta description
    let metaDesc = $('meta[name="description"]').attr('content') || 
                   $('meta[property="og:description"]').attr('content') || '';
    
    // Ana içerik seçicileri (genişletilmiş)
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.entry-content',
      '.article-body',
      '.news-content',
      '.story-content',
      '#content',
      '.main-content'
    ];

    let content = '';
    for (const selector of selectors) {
      const elem = $(selector).first();
      if (elem.length > 0 && elem.text().length > 200) {
        content = elem.text();
        break;
      }
    }

    // Fallback
    if (!content || content.length < 200) {
      const body = $('body');
      body.find('script, style, nav, footer, header, .ad, .advertisement, .sidebar, .menu, .comments').remove();
      content = body.text();
    }

    let cleanContent = content
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .substring(0, 1500);

    if (metaDesc && metaDesc.length > 50) {
      cleanContent = metaDesc + '\n\n' + cleanContent;
    }

    return cleanContent.length > 100 ? cleanContent : null;
  } catch (e) {
    console.error("[OKUMA] Hata:", e.message);
    return null;
  }
}

/* ── ANA ARAMA FONKSİYONU (Yedekli + Cache) ── */
async function guncelBilgiAl(query) {
  try {
    // Cache kontrolü
    const cacheKey = query.toLowerCase().trim();
    if (searchCache.has(cacheKey)) {
      const cached = searchCache.get(cacheKey);
      if (Date.now() - cached.time < CACHE_SURE) {
        console.log(`[CACHE] Cache'den döndürülüyor: "${query}"`);
        return cached.data;
      }
    }

    console.log(`[ARAMA] "${query}" için başlatılıyor...`);
    
    let allResults = [];
    const errors = [];

    // Kaynakları paralel çalıştır (hepsini aynı anda dene)
    const promises = [
      wikipediaArama(query).catch(e => { errors.push(`Wiki: ${e.message}`); return []; }),
      duckduckgoScrape(query).catch(e => { errors.push(`DDG: ${e.message}`); return []; }),
      bingScrape(query).catch(e => { errors.push(`Bing: ${e.message}`); return []; }),
      googleNewsRSS(query).catch(e => { errors.push(`GNews: ${e.message}`); return []; }),
      actuallyRelevantAPI(query).catch(e => { errors.push(`AR: ${e.message}`); return []; })
    ];

    const results = await Promise.allSettled(promises);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allResults = allResults.concat(result.value);
      }
    });

    if (errors.length > 0) {
      console.log(`[ARAMA] Bazı kaynaklar hata verdi:`, errors);
    }

    // Duplikatları kaldır
    const seenUrls = new Set();
    const uniqueResults = [];
    
    for (const result of allResults) {
      if (result.url && !seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        uniqueResults.push(result);
      }
    }

    if (uniqueResults.length === 0) {
      console.log(`[ARAMA] Hiçbir sonuç bulunamadı`);
      return null;
    }

    console.log(`[ARAMA] Toplam ${uniqueResults.length} benzersiz sonuç`);

    // Sonuçları özetle
    let ozet = `**📰 Güncel Bilgi Kaynakları (${uniqueResults.length} sonuç):**\n`;
    let detay = '';

    // İlk 3 sonucun içeriğini çek
    for (let i = 0; i < Math.min(3, uniqueResults.length); i++) {
      const result = uniqueResults[i];
      ozet += `\n**${i + 1}. ${result.title}**\n`;
      ozet += `📍 ${result.source}${result.date ? ` | ${result.date}` : ''}\n`;
      ozet += `${result.snippet}\n`;

      if (i < 2) {
        const icerik = await sayfaIcekGeter(result.url);
        if (icerik) {
          detay += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          detay += `📄 Kaynak ${i + 1}: ${result.title}\n`;
          detay += `🔗 ${result.url}\n`;
          detay += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          detay += icerik + '\n';
        }
      }
    }

    const finalData = {
      ozet: ozet,
      detay: detay.substring(0, 2500),
      results: uniqueResults,
      timestamp: Date.now()
    };

    // Cache'e kaydet
    searchCache.set(cacheKey, { data: finalData, time: Date.now() });
    
    // Cache boyutunu sınırla (max 50)
    if (searchCache.size > 50) {
      const firstKey = searchCache.keys().next().value;
      searchCache.delete(firstKey);
    }

    return finalData;
  } catch (e) {
    console.error("[ARAMA] Genel hata:", e.message);
    return null;
  }
}

// Güncel konu kontrolü (genişletilmiş)
function konuGuncelMi(konu) {
  const guncelKonular = [
    'haber', 'bugün', 'bu hafta', 'bu ay', 'son dakika', 'güncel', 'yeni', 'dün',
    'dolar', 'euro', 'borsa', 'bitcoin', 'fiyat', 'kur', 'tl', 'altın', ' petrol',
    'hava durumu', 'sıcaklık', 'yağmur', 'kar',
    'maç', 'sonuç', 'gol', 'lig', 'skor', 'spor', 'futbol', 'basketbol',
    'film', 'dizi', 'konser', 'etkinlik', 'müzik',
    'teknoloji', 'yazılım', 'telefon', 'yapay zeka', 'ai', 'chatgpt',
    'seçim', 'başkan', 'bakan', 'meclis', 'hükümet',
    'sınav', 'ösym', 'yks', 'tyt', 'ayt',
    'covid', 'korona', 'aşı', 'salgın',
    'kaza', 'yangın', 'deprem', 'felaket',
    'savaş', 'barış', 'anlaşma', 'görüşme',
    'nedir', 'kimdir', 'nasıl', 'nerede', 'ne zaman'
  ];

  return guncelKonular.some(anahtar => konu.toLowerCase().includes(anahtar));
}

/* ══════════════════════════════════════════════════════
   GROQ API FONKSİYONLARI (Geliştirilmiş)
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.5, deneme = 0, keyIndex = 0) {
  try {
    const apiKey = GROQ_KEYS[keyIndex];
    if (!apiKey) {
      console.error("Hiçbir Groq API key mevcut değil!");
      return null;
    }

    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: SMART, messages, temperature, max_tokens },
      { 
        headers: { 
          Authorization: `Bearer ${apiKey}`, 
          'Content-Type': 'application/json' 
        }, 
        timeout: 60000 
      }
    );

    currentGroqIndex = keyIndex;
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    const status = e.response?.status;
    const isRateLimit = status === 429;
    const isServerError = status >= 500;
    const isTimeout = e.message.includes('timeout') || e.code === 'ECONNRESET';

    if (isRateLimit || isServerError || isTimeout) {
      console.warn(`[Groq ${keyIndex}] Hata: ${status || e.message}`);

      const nextKeyIndex = (keyIndex + 1) % GROQ_KEYS.length;
      if (nextKeyIndex !== keyIndex) {
        await new Promise(res => setTimeout(res, 1000));
        return groqCall(messages, max_tokens, temperature, deneme, nextKeyIndex);
      }

      if (deneme < 3) {
        await new Promise(res => setTimeout(res, (deneme + 1) * 4000));
        return groqCall(messages, max_tokens, temperature, deneme + 1, 0);
      }
    }

    console.error(`[Groq] Hata:`, e.message);
    return null;
  }
}

async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  
  let guncelBilgiEklentisi = '';
  let guncelBilgiDetay = '';
  
  // Her soruda güncel bilgi ara (daha agresif)
  const aramaGerekli = konuGuncelMi(soru) || soru.length > 10;
  
  if (aramaGerekli) {
    console.log(`[AI] Web araştırması başlatılıyor: "${soru.substring(0, 50)}..."`);
    const guncelBilgi = await guncelBilgiAl(soru);
    
    if (guncelBilgi) {
      guncelBilgiEklentisi = `\n\n${guncelBilgi.ozet}`;
      if (guncelBilgi.detay) {
        guncelBilgiDetay = `\n\n${guncelBilgi.detay}`;
      }
      console.log(`[AI] Web araştırması tamamlandı`);
    } else {
      console.log(`[AI] Web araştırması sonuçsuz`);
    }
  }

  const systemPrompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. 
Güncel Tarih ve Saat: ${suAn}.
Türkçe konuş ve yakın cevaplar ver.

Aşağıdaki web araştırması bilgilerini kullanarak cevap ver. 
Eğer web bilgisi varsa kesinlikle ona göre cevapla.
Kaynakları belirt.
${guncelBilgiEklentisi}${guncelBilgiDetay}`;

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([{ role: 'system', content: systemPrompt }, ...gecmis]);
  const sonCevap = cevap || 'Simya enerjim düşük. Tekrar dene.';
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
  logs[action] = logs[action].filter(t => now - t < (12 * 60 * 60 * 1000));
  if (logs[action].length >= 2) return false;
  logs[action].push(now);
  return true;
}

async function banIhlalci(guild, userId, sebep) {
  try {
    await guild.members.ban(userId, { reason: `[Edward Guard] ${sebep}` });
  } catch (e) { console.error(`Ban başarısız: ${userId}`); }
}

/* ══════════════════════════════════════════════════════
   DISCORD BOT
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
    return msg.reply('✅ **Guard Aktif!**');
  }

  if (msg.content.toLowerCase().startsWith('ebeyazliste')) {
    if (msg.author.id !== msg.guild.ownerId) return msg.reply('Bunu sadece sunucu sahibi yapabilir.');
    const args = msg.content.split(' ');
    const islem = args[1];
    const botId = args[2];
    if (!botId) return msg.reply('Bot ID belirtmelisin.');

    if (islem === 'ekle') {
      whiteListedBots.add(botId);
      saveWhiteList();
      return msg.reply(`✅ \`${botId}\` beyaz listeye eklendi.`);
    } else if (islem === 'cikar' || islem === 'çıkar') {
      whiteListedBots.delete(botId);
      saveWhiteList();
      return msg.reply(`❌ \`${botId}\` listeden çıkarıldı.`);
    }
  }

  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return;
    
    try {
      const gonderiMsg = await msg.reply('🔍 Araştırılıyor...');
      
      const cevap = await anaIsleyici(soru, msg.author.id);
      
      // Mesaj bölme (Discord 2000 karakter limiti)
      if (cevap.length > 1990) {
        const chunks = [];
        let currentChunk = '';
        const lines = cevap.split('\n');
        
        for (const line of lines) {
          if ((currentChunk + line + '\n').length > 1990) {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = line + '\n';
          } else {
            currentChunk += line + '\n';
          }
        }
        if (currentChunk) chunks.push(currentChunk);

        await gonderiMsg.edit(chunks[0] || 'Cevap alınamadı');
        
        for (let i = 1; i < chunks.length; i++) {
          await msg.reply(chunks[i]);
        }
      } else {
        await gonderiMsg.edit(cevap);
      }
    } catch (e) {
      console.error("Hata:", e);
      msg.reply('❌ Hata: ' + e.message);
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  if (!activeGuilds.has(member.guild.id) || !member.user.bot) return;
  if (whiteListedBots.has(member.id)) return;

  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
  const entry = audit?.entries.first();

  if (entry) {
    const executorId = entry.executor.id;
    if (executorId !== member.guild.ownerId) {
      await member.ban({ reason: '[Edward Guard] İzinsiz Bot.' }).catch(() => {});
      console.log(`[Guard] Bot engellendi: ${member.user.tag}`);
    }
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
  console.log(`✅ Edward Bot Hazır!`);
  console.log(`📡 Groq Keys: ${GROQ_KEYS.length}`);
  console.log(`🌐 Web Arama: Wikipedia + DuckDuckGo + Bing + Google News + ActuallyRelevant`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);