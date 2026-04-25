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
   WEB ARAMA - API KEY GEREKTIRMIYOR
   ══════════════════════════════════════════════════════ */

// User-Agent listesi (bot algılanmayı önlemek için)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.2 Safari/605.1.15'
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// DuckDuckGo arama (en güvenilir - API key yok)
async function duckduckgoArama(query) {
  try {
    console.log(`[DuckDuckGo] "${query}" araması yapılıyor...`);
    
    const response = await axios.get('https://api.duckduckgo.com/', {
      params: {
        q: query,
        format: 'json',
        no_html: 1,
        t: 'Edward Bot',
        kl: 'tr-tr'
      },
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 10000
    });

    if (!response.data.Results || response.data.Results.length === 0) {
      console.log(`[DuckDuckGo] Sonuç bulunamadı`);
      return [];
    }

    const results = response.data.Results.slice(0, 5).map(r => ({
      title: r.Title || 'Başlık Yok',
      url: r.FirstURL || r.URL || '',
      snippet: r.Text || '',
      source: r.FirstURL ? new URL(r.FirstURL).hostname : 'unknown'
    })).filter(r => r.url && r.snippet);

    console.log(`[DuckDuckGo] ${results.length} sonuç bulundu`);
    return results;
  } catch (e) {
    console.error("[DuckDuckGo] Hata:", e.message);
    return [];
  }
}

// Wikipedia arama (çok güvenilir)
async function wikipediaArama(query) {
  try {
    console.log(`[Wikipedia] "${query}" araması yapılıyor...`);
    
    const response = await axios.get('https://tr.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        srlimit: 5
      },
      headers: {
        'User-Agent': randomUserAgent()
      },
      timeout: 10000
    });

    if (!response.data.query?.search || response.data.query.search.length === 0) {
      console.log(`[Wikipedia] Sonuç bulunamadı`);
      return [];
    }

    const results = response.data.query.search.map(r => ({
      title: r.title,
      url: `https://tr.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
      snippet: r.snippet.replace(/<\/?[^>]+(>|$)/g, ''),
      source: 'wikipedia.org'
    }));

    console.log(`[Wikipedia] ${results.length} sonuç bulundu`);
    return results;
  } catch (e) {
    console.error("[Wikipedia] Hata:", e.message);
    return [];
  }
}

// Bing arama (alternatif)
async function bingArama(query) {
  try {
    console.log(`[Bing] "${query}" araması yapılıyor...`);
    
    const response = await axios.get('https://www.bing.com/search', {
      params: { q: query },
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('li.b_algo').each((i, elem) => {
      if (results.length >= 5) return;
      
      const title = $(elem).find('h2 a').text().trim();
      const url = $(elem).find('h2 a').attr('href');
      const snippet = $(elem).find('.b_caption p').text().trim();

      if (title && url && snippet) {
        results.push({
          title,
          url,
          snippet: snippet.substring(0, 200),
          source: new URL(url).hostname
        });
      }
    });

    console.log(`[Bing] ${results.length} sonuç bulundu`);
    return results;
  } catch (e) {
    console.error("[Bing] Hata:", e.message);
    return [];
  }
}

// Google arama (en son çare - Cheerio ile parse)
async function googleArama(query) {
  try {
    console.log(`[Google] "${query}" araması yapılıyor...`);
    
    const response = await axios.get('https://www.google.com/search', {
      params: { q: query },
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('div.g').each((i, elem) => {
      if (results.length >= 5) return;
      
      const titleElem = $(elem).find('h3').first();
      const title = titleElem.text().trim();
      
      const linkElem = $(elem).find('a').first();
      const url = linkElem.attr('href');
      
      const snippetElem = $(elem).find('div').filter((i, el) => {
        const text = $(el).text();
        return text.length > 50 && text.length < 300;
      }).first();
      const snippet = snippetElem.text().trim();

      if (title && url && snippet) {
        results.push({
          title,
          url,
          snippet: snippet.substring(0, 200),
          source: url ? new URL(url).hostname : 'google'
        });
      }
    });

    console.log(`[Google] ${results.length} sonuç bulundu`);
    return results;
  } catch (e) {
    console.error("[Google] Hata:", e.message);
    return [];
  }
}

// Sayfa içeriği çek (Cheerio ile)
async function sayfaIcekGeter(url) {
  try {
    if (!url || !url.startsWith('http')) {
      return null;
    }

    console.log(`[OKUMA] ${url} okunuyor...`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 8000,
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    
    // Meta description'ı al
    let metaDesc = $('meta[name="description"]').attr('content') || '';
    
    // Ana içeriği bul
    let content = '';
    
    // Yaygın content seçicileri
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.entry-content',
      '.article-body',
      '.news-content'
    ];

    for (const selector of selectors) {
      const elem = $(selector).first();
      if (elem.length > 0) {
        content = elem.text();
        break;
      }
    }

    // Eğer bulunmazsa body'den al
    if (!content) {
      const body = $('body');
      body.find('script, style, nav, footer, .ad, .advertisement').remove();
      content = body.text();
    }

    // Temizle
    let cleanContent = content
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .substring(0, 1500);

    // Meta desc'ten başla
    if (metaDesc) {
      cleanContent = metaDesc + '\n\n' + cleanContent;
    }

    return cleanContent.length > 100 ? cleanContent : null;
  } catch (e) {
    console.error("[OKUMA] Hata:", e.message);
    return null;
  }
}

// Ana arama fonksiyonu - hepsini dene
async function guncelBilgiAl(query) {
  try {
    console.log(`[ARAMA] "${query}" için başlatılıyor...`);
    
    let allResults = [];

    // 1. DuckDuckGo dene (en güvenilir)
    let results = await duckduckgoArama(query);
    allResults = allResults.concat(results);

    // 2. Eğer yeterli sonuç yoksa Wikipedia dene
    if (allResults.length < 3) {
      results = await wikipediaArama(query);
      allResults = allResults.concat(results);
    }

    // 3. Hala yoksa Bing dene
    if (allResults.length < 3) {
      results = await bingArama(query);
      allResults = allResults.concat(results);
    }

    // 4. Son çare: Google
    if (allResults.length < 3) {
      results = await googleArama(query);
      allResults = allResults.concat(results);
    }

    // Duplikatları kaldır
    const uniqueResults = [];
    const seenUrls = new Set();
    
    for (const result of allResults) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        uniqueResults.push(result);
      }
    }

    if (uniqueResults.length === 0) {
      console.log(`[ARAMA] Hiçbir sonuç bulunamadı`);
      return null;
    }

    console.log(`[ARAMA] Toplam ${uniqueResults.length} sonuç bulundu`);

    // Sayfa içeriği çek
    let ozet = `**📰 Güncel Bilgi Kaynakları (${uniqueResults.length} sonuç):**\n`;
    let detay = '';

    for (let i = 0; i < Math.min(3, uniqueResults.length); i++) {
      const result = uniqueResults[i];
      ozet += `\n**${i + 1}. ${result.title}**\n`;
      ozet += `📍 ${result.source}\n`;
      ozet += `${result.snippet}\n`;

      // İçerik çek
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

    return {
      ozet: ozet,
      detay: detay.substring(0, 2500),
      results: uniqueResults
    };
  } catch (e) {
    console.error("[ARAMA] Genel hata:", e.message);
    return null;
  }
}

// Güncel konuları kontrol et
function konuGuncelMi(konu) {
  const guncelKonular = [
    'haber', 'haberler', 'bugün', 'bu hafta', 'bu ay', 'son dakika', 'öğlen', 'sabah', 'akşam',
    'güncel', 'geçen', 'yeni', 'dün', 'yetkili', 'açıkladı', 'derya',
    'dolar', 'euro', 'borsa', 'piyasa', 'bitcoin', 'kripto', 'coin', 'fiyat', 'kur', 'tl',
    'hava durumu', 'iklim', 'sıcaklık', 'yağmur', 'kar', 'rüzgar', 'hava', 'mevsim',
    'covid', 'koronavirus', 'aşı', 'salgın', 'pandemi', 'hastalık', 'grip',
    'futbol', 'maç', 'sonuç', 'gol', 'lig', 'turnuva', 'skor', 'oyun', 'spor', 'basketbol', 'voleybol',
    'müzik', 'konser', 'etkinlik', 'festival', 'film', 'dizi', 'oyuncu', 'yönetmen', 'tiyatro',
    'teknoloji', 'yazılım', 'oyun', 'telefon', 'bilgisayar', 'uygulama', 'yapay zeka', 'ai',
    'politika', 'seçim', 'başkan', 'cumhuriyet', 'bakanlik', 'vali', 'kaymakam', 'belediye',
    'eğitim', 'okul', 'üniversite', 'sınav', 'sonuçlar', 'öss', 'yks', 'tyt', 'ayt', 'kpss',
    'sağlık', 'doktor', 'hastane', 'tedavi', 'ilaç', 'aşı', 'eczane',
    'ulaştırma', 'yol', 'trafik', 'kazası', 'metro', 'otobüs', 'ucak',
    'hukuk', 'davası', 'mahkeme', 'gözaltı', 'tutuklu', 'ceza', 'kanun'
  ];

  return guncelKonular.some(anahtar => konu.toLowerCase().includes(anahtar));
}

/* ══════════════════════════════════════════════════════
   GROQ API FONKSIYONLARI
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
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );

    currentGroqIndex = keyIndex;
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    const isRateLimitOrServerError = e.response?.status === 429 || e.response?.status >= 500;

    if (isRateLimitOrServerError || e.message.includes('ECONNRESET') || e.message.includes('timeout')) {
      console.warn(`[Groq ${keyIndex}] Hata: ${e.response?.status || e.message}`);

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
  
  // Konu güncel mi kontrol et
  if (konuGuncelMi(soru)) {
    console.log(`[AI] Güncel konuda soru: "${soru.substring(0, 50)}..."`);
    const guncelBilgi = await guncelBilgiAl(soru);
    
    if (guncelBilgi) {
      guncelBilgiEklentisi = `\n\n${guncelBilgi.ozet}`;
      if (guncelBilgi.detay) {
        guncelBilgiDetay = `\n\n${guncelBilgi.detay}`;
      }
      console.log(`[AI] Web araştırması tamamlandı`);
    }
  }

  const systemPrompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Güncel Tarih ve Saat: ${suAn}. 
Türkçe konuş ve yakın cevaplar ver.

Aşağıda web araştırması yapıldıysa, bu bilgileri kullanarak cevap ver.
${guncelBilgiEklentisi}`;

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([{ role: 'system', content: systemPrompt }, ...gecmis]);
  const sonCevap = cevap || 'Simya enerjim düşük.';
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
      const gonderiMsg = await msg.reply('⏳ Araştırılıyor...');
      
      const cevap = await anaIsleyici(soru, msg.author.id);
      
      // Mesaj bölme
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
  console.log(`🌐 Web Arama: DuckDuckGo + Wikipedia + Bing + Google (API KEY YOK!)`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);