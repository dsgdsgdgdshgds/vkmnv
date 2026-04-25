const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios  = require('axios');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { GoogleSearch } = require('googlesearch-results-nodejs');

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

// SerpAPI key - https://serpapi.com - AYDA 100 ARAMA ÜCRETSİZ
const SERP_KEY      = process.env.SERP_KEY;
const DISCORD_TOKEN = process.env.token;
const MODEL         = 'llama-3.3-70b-versatile';
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
   WEB ARAMA
   - SERP_KEY varsa SerpAPI kullan (ayda 100 ücretsiz)
   - Yoksa DuckDuckGo instant answer API dene (ücretsiz ama sınırlı)
═══════════════════════════════════════════ */
async function webAra(query) {

  // 1) SerpAPI — en güvenilir, ayda 100 ücretsiz
  if (SERP_KEY) {
    try {
      const search = new GoogleSearch(SERP_KEY);
      const data = await new Promise((res, rej) =>
        search.json({ q: query, hl: 'tr', gl: 'tr', num: 5 }, d => d.error ? rej(d.error) : res(d))
      );

      const satirlar = [];

      if (data.answer_box?.answer)   satirlar.push(`📌 ${data.answer_box.answer}`);
      if (data.answer_box?.snippet)  satirlar.push(`💡 ${data.answer_box.snippet}`);

      (data.organic_results || []).slice(0, 4).forEach(r => {
        satirlar.push(`🔹 **${r.title}** (${r.displayed_link || ''})\n${r.snippet || ''}`);
      });

      if (satirlar.length) {
        console.log(`[SerpAPI] ${satirlar.length} sonuç ✅`);
        return satirlar.join('\n\n');
      }
    } catch (e) {
      console.error('[SerpAPI] Hata:', e);
    }
  }

  // 2) DuckDuckGo instant answer — ücretsiz, API key yok
  try {
    const { data } = await axios.get('https://api.duckduckgo.com/', {
      params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000,
    });

    const satirlar = [];
    if (data.AbstractText)  satirlar.push(`💡 ${data.AbstractText}`);
    if (data.Answer)        satirlar.push(`📌 ${data.Answer}`);
    (data.RelatedTopics || []).slice(0, 3).forEach(t => {
      if (t.Text) satirlar.push(`🔹 ${t.Text}`);
    });

    if (satirlar.length) {
      console.log(`[DuckDuckGo] ${satirlar.length} sonuç ✅`);
      return satirlar.join('\n\n');
    }
  } catch (e) {
    console.error('[DuckDuckGo] Hata:', e.message);
  }

  console.warn('[webAra] Hiç sonuç yok');
  return null;
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
        { headers: { Authorization: `Bearer ${GROQ_KEYS[idx]}`, 'Content-Type': 'application/json' }, timeout: 30000 }
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

  const karar = await groq([
    { role: 'system', content: 'Kullanıcı sorusu güncel internet verisi gerektiriyor mu? (haber, döviz, kripto, hava, maç, yeni ürün vb.) Sadece EVET veya HAYIR yaz.' },
    { role: 'user',   content: soru },
  ], 5);

  let webBlok = '';
  if (karar?.toUpperCase().includes('EVET')) {
    const sorgu = await groq([
      { role: 'system', content: 'Bu soru için en kısa Türkçe Google arama sorgusunu yaz. Sadece sorguyu yaz.' },
      { role: 'user',   content: soru },
    ], 25) ?? soru;

    console.log(`[Arama] "${sorgu}"`);
    const sonuc = await webAra(sorgu);
    webBlok = sonuc
      ? `\n\n[WEB - ${new Date().toLocaleTimeString('tr-TR')}]\n${sonuc}\n[/WEB]`
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
      try { await m.edit('❌ Hata oluştu.'); } catch {}
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
  console.log(`🔍 Arama: ${SERP_KEY ? 'SerpAPI ✅' : 'DuckDuckGo (SERP_KEY ekle → serpapi.com → 100/ay ücretsiz)'}`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);