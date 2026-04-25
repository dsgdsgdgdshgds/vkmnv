const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios   = require('axios');
const cheerio = require('cheerio');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

/* ── SETUP ── */
const dataDir    = '/var/data';
const filePath   = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

http.createServer((_, r) => { r.writeHead(200); r.end('OK'); }).listen(process.env.PORT || 8080);

/* ── CONFIG ── */
const GROQ_KEYS = [
  process.env.groq,  process.env.groq1, process.env.groq2,
  process.env.groq3, process.env.groq4,
].filter(Boolean);

const DISCORD_TOKEN = process.env.token;
const SMART = 'llama-3.3-70b-versatile';
let currentGroqIndex = 0;

/* ── HAFIZA ── */
const mem = new Map();
const MAX_MESAJ = 3;

/* ── GUARD ── */
const guardData = new Map();
let activeGuilds    = new Set();
let whiteListedBots = new Set();
const HARIC_ID_LIST = [];

if (fs.existsSync(filePath))      try { activeGuilds    = new Set(JSON.parse(fs.readFileSync(filePath,      'utf8'))); } catch {}
if (fs.existsSync(whiteListPath)) try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(whiteListPath, 'utf8'))); } catch {}

function saveGuardList() { fs.writeFileSync(filePath,      JSON.stringify([...activeGuilds])); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify([...whiteListedBots])); }

/* ══════════════════════════════════════════════════════
   GROQ
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.5, deneme = 0, keyIndex = 0) {
  try {
    const apiKey = GROQ_KEYS[keyIndex];
    if (!apiKey) { console.error('Groq key yok!'); return null; }

    const r = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: SMART, messages, temperature, max_tokens },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    currentGroqIndex = keyIndex;
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    const retry = e.response?.status === 429 || e.response?.status >= 500 || e.message.includes('ECONNRESET') || e.message.includes('timeout');
    if (retry) {
      const next = (keyIndex + 1) % GROQ_KEYS.length;
      if (next !== keyIndex) {
        await new Promise(r => setTimeout(r, 1000));
        return groqCall(messages, max_tokens, temperature, deneme, next);
      }
      if (deneme < 3) {
        await new Promise(r => setTimeout(r, (deneme + 1) * 4000));
        return groqCall(messages, max_tokens, temperature, deneme + 1, 0);
      }
    }
    console.error('[Groq] Hata:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   GOOGLE ARAMA - DeepSeek'in kodu
   ══════════════════════════════════════════════════════ */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 10 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      },
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

    console.log(`[Google] ${sonuclar.length} sonuç`);
    return sonuclar.slice(0, 8);

  } catch (e) {
    console.log('[Google] hata:', e.message, '→ DuckDuckGo deneniyor');
    try {
      const { data } = await axios.post(
        'https://html.duckduckgo.com/html/',
        new URLSearchParams({ q: sorgu }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000
        }
      );
      const $ = cheerio.load(data);
      const sonuclar = [];
      $('.result').each((i, elem) => {
        const a    = $(elem).find('.result__a');
        const url  = a.attr('href');
        const baslik = a.text().trim();
        if (url && baslik) sonuclar.push({ url, baslik });
      });
      console.log(`[DuckDuckGo] ${sonuclar.length} sonuç`);
      return sonuclar.slice(0, 8);
    } catch (e2) {
      console.log('[DuckDuckGo] hata:', e2.message);
      return [];
    }
  }
}

/* ── Siteleri ziyaret et, metin çek ── */
async function siteIcerikleriAl(linkler, anahtar_kelimeler) {
  const icerikler = [];

  await Promise.allSettled(linkler.slice(0, 5).map(async (link) => {
    try {
      const { data } = await axios.get(link.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr,en;q=0.9',
        },
        timeout: 8000,
        maxRedirects: 3
      });

      const $ = cheerio.load(data);
      let metin = '';

      $('p, h1, h2, h3, article, .content, .post-content, .entry-content, main').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) metin += text + '\n';
      });

      if (metin.length < 200) metin = $('body').text().replace(/\s+/g, ' ').trim();
      metin = metin.substring(0, 3000);

      let alaka = 0;
      anahtar_kelimeler.forEach(k => {
        const m = metin.match(new RegExp(k, 'gi'));
        if (m) alaka += m.length;
      });

      if (metin.length > 100) icerikler.push({ metin, alaka });
    } catch (e) {
      console.log(`❌ ${link.url}:`, e.message);
    }
  }));

  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

  const systemPrompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. Türkçe konuş.`;

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);

  // Web araması gerekiyor mu?
  const karar = await groqCall([
    { role: 'system', content: 'Kullanıcı sorusu güncel internet verisi gerektiriyor mu? (haber, döviz, kripto, hava, maç sonucu, yeni ürün vb.) Sadece EVET veya HAYIR yaz.' },
    { role: 'user',   content: soru },
  ], 5);

  let webVeri = '';

  if (karar?.toUpperCase().includes('EVET')) {
    // Arama sorgusunu Groq üretsin
    const sorgu = await groqCall([
      { role: 'system', content: 'Bu soru için en kısa Türkçe Google arama sorgusunu yaz. Sadece sorguyu yaz.' },
      { role: 'user',   content: soru },
    ], 20) ?? soru;

    console.log(`[Arama] "${sorgu}"`);

    const linkler    = await googleArama(sorgu);
    const anahtar    = soru.split(' ').filter(k => k.length > 2);
    const icerikler  = await siteIcerikleriAl(linkler, anahtar);

    if (icerikler.length > 0) {
      webVeri = '\n\n[GÜNCEL WEB VERİSİ]\n' +
        icerikler.map((s, i) => s.metin).join('\n---\n') +
        '\n[/GÜNCEL WEB VERİSİ]';
      console.log('[Web] Veri alındı ✅');
    }
  }

  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([
    { role: 'system', content: systemPrompt + webVeri },
    ...gecmis,
  ]) ?? 'Simya enerjim düşük.';

  gecmis.push({ role: 'assistant', content: cevap });
  if (gecmis.length > MAX_MESAJ * 2) gecmis.splice(0, 2);

  return cevap;
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
  logs[action] = logs[action].filter(t => now - t < 12 * 60 * 60 * 1000);
  if (logs[action].length >= 2) return false;
  logs[action].push(now);
  return true;
}

async function banIhlalci(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Edward Guard] ${sebep}` }); }
  catch (e) { console.error(`Ban başarısız: ${userId}`); }
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
    return msg.reply('✅ **Guard Aktif!**');
  }

  if (msg.content.toLowerCase().startsWith('ebeyazliste')) {
    if (msg.author.id !== msg.guild.ownerId) return msg.reply('Bunu sadece sunucu sahibi yapabilir.');
    const args = msg.content.split(' ');
    const islem = args[1];
    const botId = args[2];
    if (!botId) return msg.reply('Bot ID belirtmelisin.');
    if (islem === 'ekle') {
      whiteListedBots.add(botId); saveWhiteList();
      return msg.reply(`✅ \`${botId}\` beyaz listeye eklendi.`);
    } else if (islem === 'cikar' || islem === 'çıkar') {
      whiteListedBots.delete(botId); saveWhiteList();
      return msg.reply(`❌ \`${botId}\` listeden çıkarıldı.`);
    }
  }

  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return;

    try {
      const gonderiMsg = await msg.reply('⏳ Düşünüyorum...');
      const cevap = await anaIsleyici(soru, msg.author.id);

      if (cevap.length > 1990) {
        const parcalar = cevap.match(/[\s\S]{1,1990}/g) ?? [];
        await gonderiMsg.edit(parcalar[0]);
        for (let i = 1; i < parcalar.length; i++) await msg.reply(parcalar[i]);
      } else {
        await gonderiMsg.edit(cevap);
      }
    } catch (e) {
      console.error('Hata:', e);
      msg.reply('❌ Bir hata oluştu.');
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  if (!activeGuilds.has(member.guild.id) || !member.user.bot) return;
  if (whiteListedBots.has(member.id)) return;
  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
  const entry = audit?.entries.first();
  if (entry && entry.executor.id !== member.guild.ownerId)
    await member.ban({ reason: '[Edward Guard] İzinsiz Bot.' }).catch(() => {});
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
  console.log(`✅ ${client.user.tag} hazır!`);
  console.log(`📡 Groq Keys: ${GROQ_KEYS.length}`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

process.on('unhandledRejection', e => console.error('🔥', e));

client.login(DISCORD_TOKEN);