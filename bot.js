const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios   = require('axios');
const cheerio = require('cheerio');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

/* ── DOSYA YOLU ── */
const dataDir       = '/var/data';
const filePath      = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/* ── HTTP SERVER ── */
http.createServer((_, r) => { r.writeHead(200); r.end('OK'); }).listen(process.env.PORT || 8080);

/* ── GROQ KEYLER ── */
const GROQ_KEYS = [
  process.env.groq,
  process.env.groq1,
  process.env.groq2,
  process.env.groq3,
  process.env.groq4
].filter(Boolean);

/* ── BOT TOKENLAR ── */
const TOKENS = [
  { token: process.env.token,  char: 'Edward Elric', act: 'Firuze ile Fmab izliyor' },
  { token: process.env.token2, char: 'Awe',          act: 'Aweeeeeee! izliyor'      }
].filter(t => t.token);

const MODEL = 'llama-3.3-70b-versatile';

/* ── HAFIZA (her bot ayrı) ── */
const memories = new Map();
const MAX_MESAJ = 6;

function getMemory(char, userId) {
  if (!memories.has(char)) memories.set(char, new Map());
  const m = memories.get(char);
  if (!m.has(userId)) m.set(userId, []);
  return m.get(userId);
}

/* ── GUARD VERİSİ ── */
const guardData     = new Map();
let activeGuilds    = new Set();
let whiteListedBots = new Set();
const HARIC_ID_LIST = [];

if (fs.existsSync(filePath)) {
  try { activeGuilds = new Set(JSON.parse(fs.readFileSync(filePath, 'utf8'))); } catch (e) {}
}
if (fs.existsSync(whiteListPath)) {
  try { whiteListedBots = new Set(JSON.parse(fs.readFileSync(whiteListPath, 'utf8'))); } catch (e) {}
}

function saveGuardList() { fs.writeFileSync(filePath,      JSON.stringify([...activeGuilds]),    'utf8'); }
function saveWhiteList() { fs.writeFileSync(whiteListPath, JSON.stringify([...whiteListedBots]), 'utf8'); }

/* ══════════════════════════════════════════════════════
   WEB ARAMA — DuckDuckGo HTML (test edilmiş selektörler)
   Kaynak: html.duckduckgo.com — statik HTML, JS gerektirmez
   ══════════════════════════════════════════════════════ */
async function webSearch(query) {
  try {
    const { data } = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query, kl: 'tr-tr' },
      timeout: 10000,
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Referer'        : 'https://duckduckgo.com/'
      }
    });

    const $       = cheerio.load(data);
    const results = [];

    // Ana selektör: #links .result — her arama sonucu buradadır
    $('#links .result').each((i, el) => {
      if (results.length >= 4) return false;

      const title   = $(el).find('.result__a').first().text().trim();
      const snippet = $(el).find('.result__snippet').first().text().trim();

      if (title && snippet && snippet.length > 15) {
        results.push(`[${results.length + 1}] ${title}\n${snippet}`);
      }
    });

    if (results.length > 0) return results.join('\n\n');

    // Fallback: Zero-click info (anlık cevaplar, hesaplamalar, çeviriler)
    const zeroClick = $('.zci__body, .c-base__title').first().text().trim();
    if (zeroClick.length > 10) return zeroClick;

    return null;
  } catch (e) {
    console.error('[webSearch] Hata:', e.message);
    return null;
  }
}

/* ── Saf sohbet mi? ── */
function sadeceSohbet(soru) {
  const s = soru.toLowerCase().trim();
  return s.length < 8 ||
    /^(merhaba|selam|naber|nasılsın|iyi misin|ne yapıyorsun|kimsin|adın ne|teşekkür|sağol|tamam|harika|süper|anladım|evet|hayır|ok\b)/.test(s);
}

/* ══════════════════════════════════════════════════════
   GROQ API
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, keyIndex = 0, deneme = 0) {
  const apiKey = GROQ_KEYS[keyIndex];
  if (!apiKey) return null;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: MODEL, messages, temperature: 0.6, max_tokens: 1500 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return res.data.choices[0].message.content.trim();
  } catch (e) {
    const status  = e.response?.status;
    const tekrar  = status === 429 || status >= 500
      || e.message.includes('ECONNRESET') || e.message.includes('timeout');
    if (tekrar) {
      const nextKey = (keyIndex + 1) % GROQ_KEYS.length;
      if (nextKey !== keyIndex) {
        await new Promise(r => setTimeout(r, 1000));
        return groqCall(messages, nextKey, deneme);
      }
      if (deneme < 3) {
        await new Promise(r => setTimeout(r, (deneme + 1) * 4000));
        return groqCall(messages, 0, deneme + 1);
      }
    }
    console.error('[groqCall] Hata:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId, char) {
  const suAn   = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const gecmis = getMemory(char, kullaniciId);

  // Saf sohbet değilse her zaman ara
  let aramaEki = '';
  if (!sadeceSohbet(soru)) {
    const sonuc = await webSearch(soru);
    if (sonuc) {
      aramaEki = `\n\n[WEB ARAMA SONUÇLARI - ${suAn}]\n${sonuc}\n[/WEB]`;
    }
  }

  const system =
    `Sen ${char}'sin. Seni yaratan ve sahibin Batuhan'dır. ` +
    `Güncel tarih/saat: ${suAn}. Türkçe konuş. Kısa ve net cevap ver. ` +
    (aramaEki
      ? 'Sana web arama sonuçları verildi. Bu bilgileri kullanarak doğrudan ve güncel cevap ver. "Siteye bak", "nereden öğrenebilirsin" gibi yönlendirme asla yapma.'
      : 'Kendi bilginle cevap ver. Asla "şu siteye bak" veya "nereden öğrenebilirsin" deme.');

  const kullaniciMesaj = aramaEki ? `${soru}${aramaEki}` : soru;

  gecmis.push({ role: 'user', content: kullaniciMesaj });
  const cevap    = await groqCall([{ role: 'system', content: system }, ...gecmis]);
  const sonCevap = cevap || (char === 'Awe' ? 'Enerjim bitti...' : 'Simya enerjim düştü...');
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
  logs[action] = logs[action].filter(t => now - t < 12 * 60 * 60 * 1000);
  if (logs[action].length >= 2) return false;
  logs[action].push(now);
  return true;
}

async function banIhlalci(guild, userId, sebep) {
  try { await guild.members.ban(userId, { reason: `[Guard] ${sebep}` }); }
  catch (e) { console.error(`Ban başarısız: ${userId}`); }
}

/* ══════════════════════════════════════════════════════
   BOT BAŞLATMA
   ══════════════════════════════════════════════════════ */
function startBot(config) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildPresences
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
      const [, islem, botId] = msg.content.split(' ');
      if (!botId) return msg.reply('Bot ID belirtmelisin.');
      if (islem === 'ekle') {
        whiteListedBots.add(botId); saveWhiteList();
        return msg.reply(`✅ \`${botId}\` beyaz listeye eklendi.`);
      }
      if (islem === 'cikar' || islem === 'çıkar') {
        whiteListedBots.delete(botId); saveWhiteList();
        return msg.reply(`❌ \`${botId}\` listeden çıkarıldı.`);
      }
    }

    if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
      const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
      if (!soru) return;
      await msg.channel.sendTyping();
      const cevap = await anaIsleyici(soru, msg.author.id, config.char);
      msg.reply(cevap);
    }
  });

  client.on('guildMemberAdd', async member => {
    if (!activeGuilds.has(member.guild.id) || !member.user.bot) return;
    if (whiteListedBots.has(member.id)) return;
    const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && entry.executor.id !== member.guild.ownerId)
      await member.ban({ reason: '[Guard] İzinsiz Bot.' }).catch(() => {});
  });

  client.on('guildBanAdd', async ban => {
    if (!activeGuilds.has(ban.guild.id)) return;
    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.executor.id === client.user.id) return;
    if (!checkLimit(ban.guild.id, entry.executor.id, 'ban')) {
      await ban.guild.members.unban(ban.user).catch(() => {});
      await banIhlalci(ban.guild, entry.executor.id, 'Ban limiti aşıldı.');
    }
  });

  client.on('channelDelete', async channel => {
    if (!activeGuilds.has(channel.guild.id)) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.executor.id === client.user.id) return;
    if (!checkLimit(channel.guild.id, entry.executor.id, 'channelDelete')) {
      await channel.clone().catch(() => {});
      await banIhlalci(channel.guild, entry.executor.id, 'Kanal silme limiti aşıldı.');
    }
  });

  client.once('ready', () => {
    console.log(`✅ ${config.char} (${client.user.tag}) hazır!`);
    client.user.setActivity(config.act, { type: ActivityType.Watching });
  });

  client.login(config.toen);
}

TOKENS.forEach(startBot);