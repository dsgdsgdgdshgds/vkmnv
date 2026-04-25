const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios   = require('axios');
const cheerio = require('cheerio');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

/* ─── SETUP ─── */
const dataDir    = '/var/data';
const GUARD_FILE = path.join(dataDir, 'guardlist.json');
const WHITE_FILE = path.join(dataDir, 'whitelist.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

http.createServer((_, r) => { r.writeHead(200); r.end('OK'); }).listen(process.env.PORT || 8080);

const GROQ_KEYS = [
  process.env.groq,  process.env.groq1, process.env.groq2,
  process.env.groq3, process.env.groq4,
].filter(Boolean);

const DISCORD_TOKEN = process.env.token;
const MODEL = 'llama-3.3-70b-versatile';
let gIdx = 0;

let activeGuilds    = new Set();
let whiteListedBots = new Set();
const guardData     = new Map();
const mem           = new Map();

try { activeGuilds    = new Set(JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8'))); } catch {}
try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(WHITE_FILE, 'utf8'))); } catch {}
const saveGuards = () => fs.writeFileSync(GUARD_FILE, JSON.stringify([...activeGuilds]));
const saveWhite  = () => fs.writeFileSync(WHITE_FILE, JSON.stringify([...whiteListedBots]));

/* ═══════════════════════════════════════════
   GOOGLE SCRAPING
═══════════════════════════════════════════ */
const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

async function webAra(query) {
  try {
    const url = 'https://www.google.com/search?' + new URLSearchParams({
      q: query, hl: 'tr', gl: 'tr', num: '8', ie: 'UTF-8',
    });

    const { data: html, status } = await axios.get(url, {
      headers: {
        'User-Agent'      : UA_LIST[Math.floor(Math.random() * UA_LIST.length)],
        'Accept'          : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language' : 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding' : 'gzip, deflate, br',
        'Sec-Fetch-Dest'  : 'document',
        'Sec-Fetch-Mode'  : 'navigate',
        'Sec-Fetch-Site'  : 'none',
        'Sec-Fetch-User'  : '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control'   : 'max-age=0',
      },
      timeout: 10000,
      decompress: true,
      validateStatus: s => s < 500,
    });

    if (status === 429) { console.warn('[Google] Rate limit'); return null; }
    if (status !== 200) { console.warn('[Google] HTTP', status); return null; }

    const $       = cheerio.load(html);
    const satirlar = [];

    // 1) Döviz / anlık bilgi kutusu
    const doviz = $('div.BNeawe.iBp4i.AP7Wnd').first().text().trim();
    if (doviz) satirlar.push(`📌 ${doviz}`);

    // 2) Hava durumu
    const sicaklik  = $('span#wob_tm').first().text().trim();
    const havaDurum = $('div.VQF4g').first().text().trim();
    if (sicaklik) satirlar.push(`🌤️ ${sicaklik}°C — ${havaDurum}`);

    // 3) Featured snippet
    const snippet = $('div.IZ6rdc').first().text().trim()
                 || $('span.hgKElc').first().text().trim()
                 || $('div.LGOjhe').first().text().trim();
    if (snippet && snippet.length > 15) satirlar.push(`💡 ${snippet.substring(0, 400)}`);

    // 4) Organik arama sonuçları
    $('div.g').each((_, el) => {
      if (satirlar.filter(s => s.startsWith('🔹')).length >= 4) return false;
      const baslik = $(el).find('h3').first().text().trim();
      const ozet   = $(el).find('div.VwiC3b').first().text().trim()
                  || $(el).find('span.aCOpRe').first().text().trim();
      const href   = $(el).find('a').first().attr('href') || '';
      let domain   = '';
      try { domain = new URL(href).hostname.replace('www.', ''); } catch {}
      if (baslik && ozet) {
        satirlar.push(`🔹 **${baslik}**${domain ? ` (${domain})` : ''}\n${ozet.substring(0, 220)}`);
      }
    });

    // 5) Haber kutusu
    $('div.SoaBEf, g-card').each((_, el) => {
      if (satirlar.filter(s => s.startsWith('📰')).length >= 2) return false;
      const baslik = $(el).find('div.mCBkyc, div.n0jPhd').first().text().trim();
      const kaynak = $(el).find('div.CEMjEf span').first().text().trim();
      if (baslik) satirlar.push(`📰 **${baslik}**${kaynak ? ` — ${kaynak}` : ''}`);
    });

    if (satirlar.length === 0) { console.warn('[Google] Parse sonucu boş'); return null; }

    console.log(`[Google] ${satirlar.length} sonuç ✅`);
    return satirlar.join('\n\n');
  } catch (e) {
    console.error('[Google] Hata:', e.message);
    return null;
  }
}

/* ═══════════════════════════════════════════
   GROQ
═══════════════════════════════════════════ */
async function groq(messages, max_tokens = 1024) {
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const idx = (gIdx + i) % GROQ_KEYS.length;
    try {
      const { data } = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: MODEL, messages, max_tokens, temperature: 0.75 },
        {
          headers: { Authorization: `Bearer ${GROQ_KEYS[idx]}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );
      gIdx = idx;
      return data.choices[0].message.content.trim();
    } catch (e) {
      if (e.response?.status === 400) throw e;
      console.warn(`[Groq key${idx}] ${e.response?.status ?? e.message}`);
      await new Promise(r => setTimeout(r, 700));
    }
  }
  return null;
}

/* ═══════════════════════════════════════════
   ANA İŞLEYİCİ
═══════════════════════════════════════════ */
async function cevapla(soru, userId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  if (!mem.has(userId)) mem.set(userId, []);
  const history = mem.get(userId);

  // Groq'a "web araması gerekiyor mu?" diye sor
  const karar = await groq([
    {
      role: 'system',
      content: 'Kullanıcı sorusu güncel internet verisi gerektiriyor mu? (haber, döviz, kripto, hava, maç sonucu, yeni ürün vb.) Sadece EVET veya HAYIR yaz.',
    },
    { role: 'user', content: soru },
  ], 5);

  let webBlok = '';
  if (karar?.toUpperCase().includes('EVET')) {
    // Arama sorgusunu Groq üretsin
    const sorgu = await groq([
      {
        role: 'system',
        content: 'Bu soru için Google\'da aramak üzere en kısa Türkçe arama sorgusunu yaz. Sadece sorguyu yaz.',
      },
      { role: 'user', content: soru },
    ], 25) ?? soru;

    console.log(`[Arama] "${sorgu}"`);
    const webSonuc = await webAra(sorgu);
    webBlok = webSonuc
      ? `\n\n[WEB - ${new Date().toLocaleTimeString('tr-TR')}]\n${webSonuc}\n[/WEB]`
      : '\n\n[Web araması sonuç vermedi, kendi bilginle cevapla.]';
  }

  const system = `Sen Edward Elric'sin. Geliştiricin Batuhan. Şu an: ${suAn}.
Kişilik: Fullmetal Alchemist karakteri. Zeki, bazen sinirli, yardımsever. Türkçe konuş. "Ben kısa değilim!" gibi replikleri doğal kullan.
Yetenekler: Kod, matematik, bilim, tarih, güncel haber/fiyat/hava, yaratıcı yazı. Hiçbir soruyu geçiştirme.
Format: Discord markdown kullan. Web verisi geldiyse onu kullan, kaynağı belirt.${webBlok}`;

  const cevap = await groq([
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: soru },
  ]) ?? 'Simya enerjim tükendi, tekrar dene.';

  history.push({ role: 'user',      content: soru  });
  history.push({ role: 'assistant', content: cevap });
  if (history.length > 14) history.splice(0, 2);

  return cevap;
}

/* ═══════════════════════════════════════════
   GUARD
═══════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════
   DISCORD
═══════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
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
      try { await m.edit('❌ Hata oluştu, tekrar dene.'); } catch {}
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
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);