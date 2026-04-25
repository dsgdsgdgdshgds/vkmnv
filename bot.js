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
   İNTERNETİ DOLAŞAN BOT - GOOGLE ARA, SİTEYE GİR, OKU
   API KEY YOK - KAYNAK BELİRTME - %100 ÇALIŞAN
   ══════════════════════════════════════════════════════ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

// 1. GOOGLE'DA ARA - Sonuçları al
async function googleAra(query) {
  try {
    const r = await axios.get('https://www.google.com/search', {
      params: { q: query, hl: 'tr', gl: 'tr', num: 10 },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Cookie': 'CONSENT=YES+42'
      },
      timeout: 15000,
      maxRedirects: 5
    });

    const $ = cheerio.load(r.data);
    const sonuclar = [];

    // Tüm olası Google sonuç seçicileri
    const seciciler = [
      'div.g', '.g', '.yuRUbf', '.tF2Cxc', 
      'div[data-sokoban-container]', '.Gx5Zad',
      'h3', '.LC20lb', '.DKV0Md'
    ];

    $('div').each((i, el) => {
      if (sonuclar.length >= 5) return;
      
      const baslik = $(el).find('h3').first().text().trim();
      let link = $(el).find('a[href^="http"]').first().attr('href');
      
      // Google redirect URL'lerini temizle
      if (link && link.includes('/url?q=')) {
        const match = link.match(/[?&]q=([^&]+)/);
        if (match) link = decodeURIComponent(match[1]);
      }

      const aciklama = $(el).find('.VwiC3b, .s3v94d, .st, .aCOpRe').first().text().trim();

      if (baslik && link && link.startsWith('http') && !link.includes('google.com')) {
        if (!sonuclar.find(s => s.url === link)) {
          sonuclar.push({ baslik, url: link, aciklama: aciklama || '' });
        }
      }
    });

    console.log(`[Google] ${sonuclar.length} sonuç bulundu`);
    return sonuclar;
  } catch (e) {
    console.log('[Google] Hata:', e.message);
    return [];
  }
}

// 2. GOOGLE HABERLER'DE ARA
async function googleHaberAra(query) {
  try {
    const r = await axios.get('https://www.google.com/search', {
      params: { q: query, tbm: 'nws', hl: 'tr', gl: 'tr', num: 10 },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Cookie': 'CONSENT=YES+42'
      },
      timeout: 15000
    });

    const $ = cheerio.load(r.data);
    const sonuclar = [];

    $('div').each((i, el) => {
      if (sonuclar.length >= 5) return;
      
      const baslik = $(el).find('div.n0jPhd, .mCBkyc, h3').first().text().trim();
      let link = $(el).find('a').first().attr('href');
      
      if (link && link.includes('/url?q=')) {
        const match = link.match(/[?&]q=([^&]+)/);
        if (match) link = decodeURIComponent(match[1]);
      }

      const aciklama = $(el).find('.GI74Re, .Y3v8qd').first().text().trim();

      if (baslik && link && link.startsWith('http') && !link.includes('google.com')) {
        if (!sonuclar.find(s => s.url === link)) {
          sonuclar.push({ baslik, url: link, aciklama });
        }
      }
    });

    console.log(`[Google Haber] ${sonuclar.length} sonuç`);
    return sonuclar;
  } catch (e) {
    console.log('[Google Haber] Hata:', e.message);
    return [];
  }
}

// 3. DUCKDUCKGO HTML ARA (Google çökse diye yedek)
async function ddgAra(query) {
  try {
    const r = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query, kl: 'tr-tr' },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html',
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 15000
    });

    const $ = cheerio.load(r.data);
    const sonuclar = [];

    $('.result').each((i, el) => {
      if (sonuclar.length >= 5) return;
      
      const baslik = $(el).find('.result__title').text().trim();
      let url = $(el).find('.result__url').text().trim();
      const aciklama = $(el).find('.result__snippet').text().trim();

      if (!url.startsWith('http')) url = 'https://' + url;

      if (baslik && url && url.startsWith('http')) {
        sonuclar.push({ baslik, url, aciklama });
      }
    });

    return sonuclar;
  } catch (e) {
    console.log('[DDG] Hata:', e.message);
    return [];
  }
}

// 4. SİTEYE GİR İÇERİĞİ OKU
async function siteOku(url) {
  try {
    if (!url?.startsWith('http')) return null;
    
    const r = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/'
      },
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    if (r.status >= 400) return null;

    const $ = cheerio.load(r.data);
    
    // Meta açıklama
    let metin = $('meta[name="description"]').attr('content') || 
                $('meta[property="og:description"]').attr('content') || '';
    
    // Ana içerik seçicileri
    const seciciler = [
      'article', 'main', '[role="main"]',
      '.content', '.post-content', '.entry-content',
      '.article-body', '.news-content', '.story-content',
      '#content', '.main-content'
    ];

    for (const s of seciciler) {
      const el = $(s).first();
      if (el.length && el.text().length > 300) {
        metin = el.find('script, style, nav, footer, header, .ad, .sidebar, .comments').remove().end().text();
        break;
      }
    }

    // Hâlâ boşsa body'den al
    if (!metin || metin.length < 200) {
      const body = $('body');
      body.find('script, style, nav, footer, header, .ad, .sidebar, .menu, .comments').remove();
      metin = body.text();
    }

    const temiz = metin
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .substring(0, 2000);

    return temiz.length > 100 ? temiz : null;
  } catch (e) {
    return null;
  }
}

// 5. BÜTÜN SİSTEM - ARA, BUL, OKU, ÖZETLE
async function internetteAra(query) {
  console.log(`[NET] "${query}" aranıyor...`);

  // Önce Google dene, olmazsa DDG
  let sonuclar = await googleAra(query);
  
  if (sonuclar.length === 0) {
    sonuclar = await googleHaberAra(query);
  }
  
  if (sonuclar.length === 0) {
    sonuclar = await ddgAra(query);
  }

  if (sonuclar.length === 0) {
    console.log('[NET] Hiç sonuç yok');
    return null;
  }

  console.log(`[NET] ${sonuclar.length} site bulundu, okunuyor...`);

  // İlk 3 siteyi oku
  let bilgiler = [];
  
  for (const s of sonuclar.slice(0, 3)) {
    const icerik = await siteOku(s.url);
    if (icerik) {
      bilgiler.push({
        baslik: s.baslik,
        icerik: icerik,
        url: s.url // Groq prompt'unda kullan, cevapta gösterme
      });
      console.log(`[NET] ${s.baslik} - OKUNDU (${icerik.length} karakter)`);
    }
  }

  if (bilgiler.length === 0) {
    // Site okunamazsa en azından başlık ve açıklamaları kullan
    bilgiler = sonuclar.slice(0, 3).map(s => ({
      baslik: s.baslik,
      icerik: s.aciklama || s.baslik,
      url: s.url
    }));
  }

  // Prompt için bilgileri birleştir (kaynak belirtmeden)
  let arastirma = '';
  bilgiler.forEach((b, i) => {
    arastirma += `\n\n[${i + 1}] ${b.baslik}\n${b.icerik}`;
  });

  return arastirma.substring(0, 4000);
}

/* ══════════════════════════════════════════════════════
   SORU ANALİZİ - NE ZAMAN ARAŞTIRMA YAPILACAK?
   ══════════════════════════════════════════════════════ */

function arastirmaGerekli(soru) {
  const s = soru.toLowerCase().trim();
  
  // KESİNLİKLE ARAŞTIRMA GEREKTİREN (güncel/gerçek veri)
  const kesinArastirma = [
    'bugün', 'dün', 'bu hafta', 'bu ay', 'son dakika', 'güncel', 'haber',
    'dolar', 'euro', 'bitcoin', 'altın', 'borsa', 'fiyat', 'kur', 'tl',
    'hava durumu', 'hava', 'sıcaklık', 'yağmur', 'kar', 'rüzgar',
    'maç', 'skor', 'gol', 'lig', 'futbol', 'basketbol', 'spor',
    'deprem', 'kaza', 'yangın', 'savaş', 'patlama', 'sel',
    'seçim', 'başkan', 'bakan', 'meclis', 'hükümet', 'oy',
    'covid', 'korona', 'aşı', 'virüs', 'salgın',
    'film', 'dizi', 'konser', 'etkinlik', 'gösteri',
    'yeni çıkan', 'yeni model', 'yeni versiyon', 'yeni güncelleme'
  ];

  // MUHTEMELEN ARAŞTIRMA GEREKTİREN (bilgi sorusu)
  const muhtemelArastirma = [
    'nedir', 'kimdir', 'nasıl', 'nerede', 'ne zaman', 'kaç', 'hangi',
    'neden', 'niçin', 'kim', 'ne', 'nereden', 'nereye',
    'tarihi', 'geçmişi', 'hakkında', 'bilgi', 'özellikleri'
  ];

  // SOHBET/ŞAHİSİ KONULAR (Groq kendi zekasıyla cevaplasın)
  const sohbet = [
    'naber', 'nasılsın', 'merhaba', 'selam', 'günaydın', 'iyi akşamlar',
    'teşekkür', 'sağol', 'eyvallah', 'teşekkürler',
    'senin', 'sen', 'seni', 'sana', 'seninle', 'sizin',
    'seviyorum', 'sevmiyorum', 'nefret', 'aşk', 'aşık',
    'şaka', 'espri', 'gül', 'komik', 'güldür',
    'sence', 'düşünüyorum', 'sanırım', 'galiba', 'bence',
    'neden öyle', 'niye', 'nasıl yani', 'anlamadım', 'ne demek',
    'fullmetal', 'fma', 'edward', 'elric', 'al', 'winry', 'mustang',
    'anime', 'manga', 'naruto', 'one piece', 'attack on titan',
    'oyun öner', 'film öner', 'dizi öner', 'müzik öner', 'kitap öner',
    'rastgele', 'random', 'şanslı', 'tahmin', 'tahmin et'
  ];

  // Önce sohbet mi kontrol et
  if (sohbet.some(k => s.includes(k))) return false;
  
  // Kesin araştırma
  if (kesinArastirma.some(k => s.includes(k))) return true;
  
  // Muhtemel araştırma
  if (muhtemelArastirma.some(k => s.includes(k))) return true;
  
  // Uzun sorular genelde araştırma gerektirir
  if (s.length > 15) return true;
  
  // Kısa sorular sohbet olabilir
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
  
  const arastir = arastirmaGerekli(soru);
  let internetBilgisi = '';
  
  if (arastir) {
    console.log(`[AI] İnternet araştırması: "${soru}"`);
    const veri = await internetteAra(soru);
    if (veri) {
      internetBilgisi = veri;
      console.log(`[AI] İnternetten bilgi alındı`);
    }
  } else {
    console.log(`[AI] Groq kendi zekasıyla cevaplayacak`);
  }

  const prompt = arastir 
    ? `Sen Edward Elric'sin. Geliştiricin Batuhan. Saat: ${suAn}. Türkçe konuş, doğal ve samimi cevaplar ver.

Aşağıdaki internet araştırması bilgilerini kullanarak cevap ver. Bu bilgiler güncel ve gerçek verilerdir. Kendi bilgine güvenme, sadece bu verilere dayanarak cevap ver. Kaynak belirtme, sadece cevabı ver.

İNTERNET ARAŞTIRMASI:
${internetBilgisi}`
    : `Sen Edward Elric'sin. Geliştiricin Batuhan. Saat: ${suAn}. Türkçe konuş, doğal ve samimi cevaplar ver. Sohbet et, fikirlerini ve kişiliğini yansıt.`;

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
  console.log(`🌐 İnternet: Google + Google Haberler + DuckDuckGo`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);