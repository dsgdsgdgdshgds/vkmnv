const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ─── SETUP ─── */
const dataDir = '/var/data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const GUARD_FILE = path.join(dataDir, 'guardlist.json');
const WHITE_FILE = path.join(dataDir, 'whitelist.json');

http.createServer((_, r) => { r.writeHead(200); r.end('OK'); }).listen(process.env.PORT || 8080);

/* ─── ENV ─── */
const GROQ_KEYS = [
  process.env.groq,  process.env.groq1, process.env.groq2,
  process.env.groq3, process.env.groq4
].filter(Boolean);
const DISCORD_TOKEN = process.env.token;
const GROQ_MODEL    = 'llama-3.3-70b-versatile';
let gIdx = 0;

/* ─── STATE ─── */
let activeGuilds    = new Set();
let whiteListedBots = new Set();
const guardData     = new Map();
const mem           = new Map();

try { activeGuilds    = new Set(JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8'))); } catch {}
try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(WHITE_FILE, 'utf8'))); } catch {}
const saveGuards = () => fs.writeFileSync(GUARD_FILE, JSON.stringify([...activeGuilds]));
const saveWhite  = () => fs.writeFileSync(WHITE_FILE, JSON.stringify([...whiteListedBots]));

/* ═══════════════════════════════════════════════════
   WEB SEARCH — GOOGLE HTML PARSE
   Google'ın yanıt HTML'ini çekip cheerio ile parse et.
   API key gerekmez, tamamen ücretsiz.
═══════════════════════════════════════════════════ */

// Farklı User-Agent'lar — Google'ın bot tespitini atlatmak için
const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
const ua = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

async function googleSearch(query) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=tr&gl=tr&num=8`;
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': ua(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-Mode': 'navigate',
      },
      timeout: 10000,
      decompress: true,
    });

    const $ = cheerio.load(html);
    const sonuclar = [];

    // ── 1. Answer box (anlık cevap: döviz, hava, skor vb.) ──
    const answerSelectors = [
      'div.LGOjhe',   // döviz kurusu
      'div.BNeawe',   // genel özet
      'div[data-attrid]', // structured data
      'span.hgKElc',  // featured snippet
      'div.kCrYT',
    ];
    for (const sel of answerSelectors) {
      const txt = $(sel).first().text().trim();
      if (txt && txt.length > 5 && txt.length < 400) {
        sonuclar.push({ type: 'answer', text: txt });
        break;
      }
    }

    // ── 2. Featured snippet ──
    const featured = $('div.xpdopen, div.ifM9O, block-component').first().text().trim();
    if (featured && featured.length > 20 && featured.length < 600) {
      sonuclar.push({ type: 'featured', text: featured });
    }

    // ── 3. Organik sonuçlar ──
    $('div.g, div[data-hveid]').each((_, el) => {
      if (sonuclar.filter(s => s.type === 'organic').length >= 4) return;
      const title   = $(el).find('h3').first().text().trim();
      const snippet = $(el).find('div.VwiC3b, div.yXK7lf, span.aCOpRe').first().text().trim();
      const link    = $(el).find('a').first().attr('href') ?? '';
      if (title && snippet && title.length > 3) {
        sonuclar.push({ type: 'organic', title, snippet, link });
      }
    });

    if (sonuclar.length === 0) return null;

    // Metne çevir
    const lines = [];
    for (const s of sonuclar) {
      if (s.type === 'answer')   lines.push(`📌 ${s.text}`);
      if (s.type === 'featured') lines.push(`💡 ${s.text}`);
      if (s.type === 'organic')  lines.push(`🔹 **${s.title}**\n${s.snippet}`);
    }
    return lines.join('\n\n');

  } catch (e) {
    console.error('[Google] Hata:', e.message);
    return null;
  }
}

/* ═══════════════════════════════════════════════════
   GROQ
═══════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1024) {
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const idx = (gIdx + i) % GROQ_KEYS.length;
    try {
      const { data } = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: GROQ_MODEL, messages, max_tokens, temperature: 0.75 },
        { headers: { Authorization: `Bearer ${GROQ_KEYS[idx]}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      gIdx = idx;
      return data.choices[0].message.content.trim();
    } catch (e) {
      const s = e.response?.status;
      if (s === 400) throw e;
      console.warn(`[Groq key${idx}] ${s ?? e.message}`);
      await new Promise(r => setTimeout(r, 600));
    }
  }
  return null;
}

/* ═══════════════════════════════════════════════════
   ANA İŞLEYİCİ
═══════════════════════════════════════════════════ */
async function cevapla(soru, userId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  if (!mem.has(userId)) mem.set(userId, []);
  const history = mem.get(userId);

  /* Adım 1: Groq'a "web araması gerekiyor mu?" diye sor */
  const kararMesaj = [
    {
      role: 'system',
      content: 'Kullanıcının sorusu güncel internet verisi gerektiriyor mu? (haberler, döviz, kripto, hava, maç sonucu, yeni çıkan ürün/film vb.) Sadece EVET ya da HAYIR yaz.'
    },
    { role: 'user', content: soru }
  ];
  const karar = (await groqCall(kararMesaj, 5)) ?? 'HAYIR';
  const aramaYap = karar.toUpperCase().includes('EVET');

  /* Adım 2: Gerekiyorsa Google'da ara */
  let webBlok = '';
  if (aramaYap) {
    // Arama sorgusunu da Groq üretsin — daha iyi sonuç verir
    const sorguMesaj = [
      { role: 'system', content: 'Kullanıcının sorusunu Google\'da aramak için en iyi Türkçe arama sorgusunu tek satır olarak yaz. Başka hiçbir şey ekleme.' },
      { role: 'user', content: soru }
    ];
    const sorgu = (await groqCall(sorguMesaj, 30)) ?? soru;
    console.log(`[Arama] "${sorgu}"`);

    const webSonuc = await googleSearch(sorgu);
    if (webSonuc) {
      webBlok = `\n\n[GÜNCEL WEB VERİSİ]\n${webSonuc}\n[/GÜNCEL WEB VERİSİ]`;
      console.log('[Web] Veri alındı ✅');
    } else {
      console.warn('[Web] Sonuç alınamadı');
    }
  }

  /* Adım 3: Gerçek cevap */
  const system = `Sen Edward Elric'sin. Geliştiricin Batuhan. Şu an: ${suAn}.
Kişilik: Fullmetal Alchemist karakteri, zeki, bazen sinirli, yardımsever. "Ben kısa değilim!" gibi replikleri doğal kullan. Türkçe konuş.
Yetenek: Her konuyu derin ve doğru açıkla — kod, bilim, tarih, güncel haber, fiyat, hava, yaratıcı yazı. Hiçbir şeyi geçiştirme.
Format: Discord markdown kullan. Kaynak varsa sadece site adını belirt.${webBlok}`;

  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: soru }
  ];

  const cevap = await groqCall(messages) ?? 'Simya enerjim tükendi, tekrar dene.';

  history.push({ role: 'user',      content: soru  });
  history.push({ role: 'assistant', content: cevap });
  if (history.length > 12) history.splice(0, 2);

  return cevap;
}

/* ═══════════════════════════════════════════════════
   GUARD
═══════════════════════════════════════════════════ */
function checkLimit(guildId, userId, action) {
  if (!activeGuilds.has(guildId)) return true;
  const now = Date.now(), key = `${guildId}-${userId}`;
  if (!guardData.has(key)) guardData.set(key, { ban: [], channelDelete: [] });
  const logs = guardData.get(key);
  logs[action] = logs[action].filter(t => now - t < 43200000);
  if (logs[action].length >= 2) return false;
  logs[action].push(now);
  return true;
}
async function banIhlalci(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Guard] ${sebep}` }); } catch {}
}

/* ═══════════════════════════════════════════════════
   DISCORD
═══════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;

  if (msg.content.toLowerCase() === 'eguard') {
    if (!msg.member.permissions.has('Administrator')) return msg.reply('Yetkin yok.');
    activeGuilds.add(msg.guild.id); saveGuards();
    return msg.reply('✅ Guard aktif!');
  }

  if (msg.content.toLowerCase().startsWith('ebeyazliste')) {
    if (msg.author.id !== msg.guild.ownerId) return msg.reply('Sadece sunucu sahibi yapabilir.');
    const [, islem, botId] = msg.content.split(' ');
    if (!botId) return msg.reply('Bot ID belirt.');
    if (islem === 'ekle')                       { whiteListedBots.add(botId);    saveWhite(); return msg.reply(`✅ \`${botId}\` eklendi.`);    }
    if (islem === 'cikar' || islem === 'çıkar') { whiteListedBots.delete(botId); saveWhite(); return msg.reply(`❌ \`${botId}\` çıkarıldı.`); }
  }

  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return;
    let m;
    try {
      m = await msg.reply('⏳ Düşünüyorum...');
      const cevap = await cevapla(soru, msg.author.id);
      if (cevap.length <= 1990) {
        await m.edit(cevap);
      } else {
        const parcalar = cevap.match(/[\s\S]{1,1990}/g) ?? [];
        await m.edit(parcalar[0]);
        for (let i = 1; i < parcalar.length; i++) await msg.reply(parcalar[i]);
      }
    } catch (e) {
      console.error(e);
      (m ? m.edit('❌ Hata oluştu.') : msg.reply('❌ Hata oluştu.'));
    }
  }
});

client.on('guildMemberAdd', async member => {
  if (!activeGuilds.has(member.guild.id) || !member.user.bot || whiteListedBots.has(member.id)) return;
  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
  const entry = audit?.entries.first();
  if (entry && entry.executor.id !== member.guild.ownerId)
    await member.ban({ reason: '[Guard] İzinsiz bot.' }).catch(() => {});
});

client.on('guildBanAdd', async ban => {
  if (!activeGuilds.has(ban.guild.id)) return;
  const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;
  if (!checkLimit(ban.guild.id, entry.executor.id, 'ban')) {
    await ban.guild.members.unban(ban.user).catch(() => {});
    await banIhlalci(ban.guild, entry.executor.id, 'Ban limiti.');
  }
});

client.on('channelDelete', async channel => {
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
  console.log(`✅ ${client.user.tag} hazır!`);
  console.log(`📡 Groq keys: ${GROQ_KEYS.length}`);
  console.log(`🔍 Web arama: Google HTML scraping (ücretsiz, API key yok)`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);