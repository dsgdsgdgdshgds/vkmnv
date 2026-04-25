const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

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
   WEB ARAMA VE SCRAPING FONKSIYONLARI
   ══════════════════════════════════════════════════════ */

async function googleSearch(query) {
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('div.g').each((index, element) => {
      if (results.length >= 3) return;
      
      const titleElement = $(element).find('h3');
      const linkElement = $(element).find('a');
      const snippetElement = $(element).find('div[style*="line-height"]').first();

      const title = titleElement.text();
      const link = linkElement.attr('href');
      const snippet = snippetElement.text();

      if (title && link && snippet) {
        results.push({
          title: title.substring(0, 100),
          link: link,
          snippet: snippet.substring(0, 200)
        });
      }
    });

    return results;
  } catch (e) {
    console.error("Google arama hatası:", e.message);
    return [];
  }
}

async function fetchPageContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });

    const $ = cheerio.load(response.data);
    let content = '';

    // Yaygın içerik seçicileri
    $('article, main, [role="main"], .content, .post, .entry').each((_, el) => {
      const text = $(el).text();
      if (text.length > content.length) {
        content = text;
      }
    });

    if (!content) {
      content = $('body').text();
    }

    return content
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000);
  } catch (e) {
    console.error("Sayfa okuma hatası:", e.message);
    return '';
  }
}

async function getGuncelBilgi(konu) {
  try {
    console.log(`[Web] "${konu}" için arama yapılıyor...`);
    
    const searchResults = await googleSearch(konu);
    
    if (searchResults.length === 0) {
      return null;
    }

    let guncelBilgi = `**Güncel Bilgi Kaynakları:**\n`;
    let detayliIcerik = '';

    for (let i = 0; i < Math.min(2, searchResults.length); i++) {
      const result = searchResults[i];
      guncelBilgi += `\n**${i + 1}. ${result.title}**\n${result.snippet}\n`;

      // İlk iki kaynaktan detaylı içerik çek
      if (i < 2) {
        const pageContent = await fetchPageContent(result.link);
        if (pageContent) {
          detayliIcerik += `\n${pageContent}`;
        }
      }
    }

    return {
      ozet: guncelBilgi,
      detay: detayliIcerik.substring(0, 2000)
    };
  } catch (e) {
    console.error("Güncel bilgi hatası:", e.message);
    return null;
  }
}

function konuGuncelMi(konu) {
  const guncelKonular = [
    'haber', 'haberler', 'bugün', 'bu hafta', 'bu ay', 'son dakika',
    'güncel', 'geçen', 'yeni', 'dün', 'öğlen', 'sabah',
    'dolar', 'euro', 'borsa', 'piyasa', 'bitcoin', 'kripto',
    'hava durumu', 'iklim', 'sıcaklık', 'yağmur', 'kar', 'rüzgar',
    'covid', 'koronavirus', 'aşı', 'salgın',
    'futbol', 'maç', 'sonuç', 'gol', 'lig', 'turnuva',
    'müzik', 'konser', 'etkinlik', 'festival', 'film',
    'teknoloji', 'yazılım', 'oyun', 'telefon', 'bilgisayar',
    'politika', 'seçim', 'başkan', 'cumhuriyet',
    'eğitim', 'okul', 'üniversite', 'sınav', 'sonuçlar'
  ];

  return guncelKonular.some(konu_anahtar => konu.toLowerCase().includes(konu_anahtar));
}

/* ══════════════════════════════════════════════════════
   GROQ API FONKSIYONLARI - MULTIPLE KEY DESTEĞI
   ══════════════════════════════════════════════════════ */
function nextGroqKey() {
  currentGroqIndex = (currentGroqIndex + 1) % GROQ_KEYS.length;
  return GROQ_KEYS[currentGroqIndex];
}

function getCurrentGroqKey() {
  return GROQ_KEYS[currentGroqIndex];
}

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

    // Başarılıysa şu anki keyi güncelle
    currentGroqIndex = keyIndex;
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    const isRateLimitOrServerError = e.response?.status === 429 || e.response?.status >= 500;

    if (isRateLimitOrServerError || e.message.includes('ECONNRESET') || e.message.includes('timeout')) {
      console.warn(`[Groq ${keyIndex}] Hata: ${e.response?.status || e.message}. Diğer key deneniyor...`);

      // Sonraki keyi dene
      const nextKeyIndex = (keyIndex + 1) % GROQ_KEYS.length;
      if (nextKeyIndex !== keyIndex) { // Döngü tamamlanmadıysa
        await new Promise(res => setTimeout(res, 1000));
        return groqCall(messages, max_tokens, temperature, deneme, nextKeyIndex);
      }

      // Tüm keyler denenmiş, retry et
      if (deneme < 3) {
        console.warn(`Tüm keyler denendi, ${deneme + 1}. deneme bekleniyor...`);
        await new Promise(res => setTimeout(res, (deneme + 1) * 4000));
        return groqCall(messages, max_tokens, temperature, deneme + 1, 0);
      }
    }

    console.error(`[Groq] API Hatası:`, e.message);
    return null;
  }
}

async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  
  // Konu güncel mi kontrol et
  let guncelBilgiEklentisi = '';
  let guncelBilgiDetay = '';
  
  if (konuGuncelMi(soru)) {
    console.log(`[${kullaniciId}] Güncel konuda soru algılandı: "${soru}"`);
    const guncelBilgi = await getGuncelBilgi(soru);
    
    if (guncelBilgi) {
      guncelBilgiEklentisi = `\n\nGüncel Web Araştırması Sonuçları:\n${guncelBilgi.ozet}`;
      guncelBilgiDetay = `\n\nDetaylı Kaynak İçeriği:\n${guncelBilgi.detay}`;
    }
  }

  const systemPrompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. Türkçe konuş.
${guncelBilgiEklentisi}${guncelBilgiDetay}

Eğer web araştırması yapıldıysa, bu bilgiye dayanarak cevap ver. Kaynakları göz önünde tut.`;

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
   DISCORD BAĞLANTISI
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

  // Beyaz Liste (Sadece Sahip)
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
      await msg.channel.sendTyping();
      const cevap = await anaIsleyici(soru, msg.author.id);
      
      // Discord mesaj limiti (2000 karakter)
      if (cevap.length > 2000) {
        const chunks = cevap.match(/[\s\S]{1,2000}/g) || [];
        for (const chunk of chunks) {
          await msg.reply(chunk);
        }
      } else {
        await msg.reply(cevap);
      }
    } catch (e) {
      console.error("Mesaj işleme hatası:", e);
      msg.reply('❌ Bir hata oluştu, lütfen tekrar dene.');
    }
  }
});

/* ── GÜNCELLENEN BOT KORUMASI ── */
client.on('guildMemberAdd', async (member) => {
  if (!activeGuilds.has(member.guild.id) || !member.user.bot) return;
  if (whiteListedBots.has(member.id)) return; // Beyaz listedeyse dokunma

  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
  const entry = audit?.entries.first();

  if (entry) {
    const executorId = entry.executor.id;
    if (executorId !== member.guild.ownerId) {
      // Sadece botu banla, ekleyen kişiye dokunma
      await member.ban({ reason: '[Edward Guard] İzinsiz Bot.' }).catch(() => {});
      console.log(`[Guard] Bot engellendi: ${member.user.tag}. Ekleyen: ${executorId}`);
    }
  }
});

/* ── DİĞER GUARD OLAYLARI ── */
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
  console.log(`✅ Hazır!`);
  console.log(`📡 Aktif Groq API Keyler: ${GROQ_KEYS.length}`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);