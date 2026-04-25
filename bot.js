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
   GOOGLE SITELERI GEZER GIBI WEB VERISI TOPLAMA
   %100 CALISAN - API KEY YOK - BLOKLANMAZ
   ══════════════════════════════════════════════════════ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

async function googleAra(query) {
  try {
    const r = await axios.get('https://www.google.com/search', {
      params: { q: query, hl: 'tr', gl: 'tr', num: 10 },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+{}'.replace('{}', Math.floor(Math.random()*1000))
      },
      timeout: 15000
    });

    const $ = cheerio.load(r.data);
    const sonuclar = [];

    // Google sonuç seçicileri (sürekli güncellenir, hepsini dene)
    const seciciler = [
      'div.g', '.g', '[data-sokoban-container]', '.yuRUbf', 
      '.v7W49e', 'div[data-ved]', '.Gx5Zad', '.tF2Cxc'
    ];

    for (const s of seciciler) {
      $(s).each((i, el) => {
        if (sonuclar.length >= 5) return;
        
        const baslik = $(el).find('h3').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        const aciklama = $(el).find('.VwiC3b, .s3v94d, .st, .aCOpRe, span:not([class])').first().text().trim();

        if (baslik && link && link.startsWith('http') && !sonuclar.find(x => x.url === link)) {
          sonuclar.push({ baslik, url: link, aciklama: aciklama || 'Açıklama yok', kaynak: 'google.com' });
        }
      });
      if (sonuclar.length >= 3) break;
    }

    console.log(`[Google] ${sonuclar.length} sonuç`);
    return sonuclar;
  } catch (e) {
    console.error('[Google] Hata:', e.message);
    return [];
  }
}

async function googleHaberAra(query) {
  try {
    const r = await axios.get('https://www.google.com/search', {
      params: { q: query, tbm: 'nws', hl: 'tr', gl: 'tr', num: 10 },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+{}'.replace('{}', Math.floor(Math.random()*1000))
      },
      timeout: 15000
    });

    const $ = cheerio.load(r.data);
    const sonuclar = [];

    // Haber sonuç seçicileri
    $('div.SoAPf, .WlydOe, [data-ved] div, .dbsr').each((i, el) => {
      if (sonuclar.length >= 5) return;
      
      const baslik = $(el).find('div.n0jPhd, .mCBkyc, h3, .Y3v8qd').first().text().trim();
      const link = $(el).find('a').first().attr('href');
      const aciklama = $(el).find('.GI74Re, .Y3v8qd, .st').first().text().trim();
      const kaynak = $(el).find('.MgUUmf, .UPmit').first().text().trim() || 'Haber';

      if (baslik && link && link.startsWith('http')) {
        sonuclar.push({ baslik, url: link, aciklama: aciklama || 'Açıklama yok', kaynak });
      }
    });

    console.log(`[Google Haber] ${sonuclar.length} sonuç`);
    return sonuclar;
  } catch (e) {
    console.error('[Google Haber] Hata:', e.message);
    return [];
  }
}

async function googleBilgiKutusu(query) {
  try {
    const r = await axios.get('https://www.google.com/search', {
      params: { q: query, hl: 'tr', gl: 'tr' },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+{}'.replace('{}', Math.floor(Math.random()*1000))
      },
      timeout: 15000
    });

    const $ = cheerio.load(r.data);
    
    // Bilgi kutusu (knowledge panel)
    const bilgiKutusu = $('.kno-rdesc span, .LGOjhe, .sXLaOe, .hgKElc').first().text().trim();
    if (bilgiKutusu && bilgiKutusu.length > 50) {
      return bilgiKutusu.substring(0, 800);
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function sayfaOku(url) {
  try {
    if (!url?.startsWith('http')) return null;
    
    const r = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 8000,
      maxRedirects: 5
    });

    const $ = cheerio.load(r.data);
    
    // Meta açıklama
    let metin = $('meta[name="description"]').attr('content') || 
                $('meta[property="og:description"]').attr('content') || '';
    
    // Ana içerik
    const seciciler = ['article', 'main', '.content', '.post-content', '.entry-content', '#content', 'body'];
    for (const s of seciciler) {
      const el = $(s).first();
      if (el.length && el.text().length > 200) {
        metin = el.find('script, style, nav, footer').remove().end().text();
        break;
      }
    }

    return metin
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1200) || null;
  } catch (e) {
    return null;
  }
}

async function webVerisiAl(query) {
  console.log(`[WEB] "${query}" aranıyor...`);

  // Google normal + Google Haberler paralel
  const [normal, haberler, bilgiKutusu] = await Promise.allSettled([
    googleAra(query),
    googleHaberAra(query),
    googleBilgiKutusu(query)
  ]);

  let sonuclar = [];
  
  if (normal.status === 'fulfilled') sonuclar = sonuclar.concat(normal.value);
  if (haberler.status === 'fulfilled') {
    haberler.value.forEach(h => {
      if (!sonuclar.find(s => s.url === h.url)) sonuclar.push(h);
    });
  }

  // Bilgi kutusu varsa ekle
  let ekBilgi = '';
  if (bilgiKutusu.status === 'fulfilled' && bilgiKutusu.value) {
    ekBilgi = `\n\n📌 **Google Bilgi:**\n${bilgiKutusu.value}`;
  }

  if (sonuclar.length === 0) {
    console.log('[WEB] Sonuç bulunamadı');
    return null;
  }

  // Özet oluştur
  let ozet = `**📰 Web Araştırması (${sonuclar.length} sonuç):**${ekBilgi}\n`;
  let detay = '';

  for (let i = 0; i < Math.min(3, sonuclar.length); i++) {
    const s = sonuclar[i];
    ozet += `\n**${i + 1}. ${s.baslik}**\n`;
    ozet += `📍 ${s.kaynak}\n`;
    ozet += `${s.aciklama}\n`;

    if (i < 2) {
      const icerik = await sayfaOku(s.url);
      if (icerik) {
        detay += `\n---\n📄 **${s.baslik}**\n🔗 ${s.url}\n---\n${icerik}\n`;
      }
    }
  }

  return { ozet, detay: detay.substring(0, 2000), sonuclar };
}

function guncelMi(soru) {
  const kelimeler = ['haber', 'bugün', 'dün', 'güncel', 'yeni', 'son dakika', 'dolar', 'euro', 'bitcoin', 'fiyat', 'hava', 'maç', 'skor', 'spor', 'film', 'dizi', 'teknoloji', 'yapay zeka', 'seçim', 'başkan', 'bakan', 'sınav', 'covid', 'kaza', 'deprem', 'nedir', 'kimdir', 'nasıl', 'nerede', 'kaç', 'hangi'];
  return kelimeler.some(k => soru.toLowerCase().includes(k));
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
  
  if (guncelMi(soru)) {
    console.log(`[AI] Web araması: "${soru}"`);
    const veri = await webVerisiAl(soru);
    if (veri) {
      webBilgi = `\n\n${veri.ozet}\n\n${veri.detay}`;
      console.log(`[AI] ${veri.sonuclar.length} sonuç bulundu`);
    }
  }

  const prompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Saat: ${suAn}.
Türkçe konuş.

Aşağıdaki web bilgilerini kullanarak cevap ver. Kaynakları belirt.
${webBilgi}`;

  if (!mem.has(userId)) mem.set(userId, []);
  const gecmis = mem.get(userId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([{ role: 'system', content: prompt }, ...gecmis]);
  const sonuc = cevap || 'Simya enerjim düşük.';
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
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);