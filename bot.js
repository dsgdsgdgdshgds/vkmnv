const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const axios = require('axios');
const http = require('http');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

/* ── DOSYA YOLU VE DİZİN KONTROLÜ ── */
const dataDir = '/var/data';
const filePath = path.join(dataDir, 'guardlist.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/* ── SERVER ── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG ── */
const GROQ_KEY = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const SMART = 'llama-3.3-70b-versatile';

/* ── HAFIZA ── */
const mem = new Map();
const MAX_MESAJ = 10; 

/* ── GUARD CONFIG ── */
const guardData = new Map();
let activeGuilds = new Set();
const HARIC_ID_LIST = [];

// Dosyadan verileri yükle
if (fs.existsSync(filePath)) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    activeGuilds = new Set(data);
  } catch (e) {
    console.error("Dosya okuma hatası:", e);
  }
}

// Dosyaya kaydetme fonksiyonu
function saveGuardList() {
  fs.writeFileSync(filePath, JSON.stringify(Array.from(activeGuilds)), 'utf8');
}

/* ══════════════════════════════════════════════════════
   GROQ API
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.5, deneme = 0) {
  try {
    const r = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: SMART, messages, temperature, max_tokens },
      {
        headers: {
          Authorization: `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    if ((e.response?.status === 429 || e.response?.status >= 500) && deneme < 3) {
      await new Promise(res => setTimeout(res, (deneme + 1) * 4000));
      return groqCall(messages, max_tokens, temperature, deneme + 1);
    }
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   ARAMA VE ANALİZ
   ══════════════════════════════════════════════════════ */
function niyetBelirle(soru) {
  const s = soru.toLowerCase();
  const aramaKelimeler = ['bugün', 'güncel', 'fiyat', 'dolar', 'haber', 'hava durumu', 'maç', 'nedir', 'kimdir'];
  return aramaKelimeler.some(k => s.includes(k)) ? 'ARAMA' : 'SOHBET';
}

async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const sonuclar = [];
    $('a h3').each((i, el) => {
      const url = $(el).parent().attr('href');
      if (url) sonuclar.push({ url: url.replace('/url?q=', '').split('&')[0], baslik: $(el).text() });
    });
    return sonuclar.slice(0, 5);
  } catch { return []; }
}

async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const karar = niyetBelirle(soru);

  const systemPrompt = `Sen Edward Elric'sin (Fullmetal Alchemist). Samimi, biraz fevri ama çok zeki birisin. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. Türkçe konuş. Kendinden bahsederken bir devlet simyacısı olduğunu unutma.`;

  if (karar === 'ARAMA') {
    const linkler = await googleArama(soru);
    return await groqCall([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Soru: ${soru}\nBilgi Kaynakları: ${linkler.map(l => l.baslik).join(', ')}` },
    ]);
  }

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([{ role: 'system', content: systemPrompt }, ...gecmis]);
  const sonCevap = cevap || 'Simya enerjim şu an düşük, sonra dene.';

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
  if (!guardData.has(key)) guardData.set(key, { ban: [], kick: [], channelDelete: [] });

  const userLogs = guardData.get(key);
  userLogs[action] = userLogs[action].filter(time => now - time < 12 * 60 * 60 * 1000);

  if (userLogs[action].length >= 2) return false;
  userLogs[action].push(now);
  return true;
}

/* ══════════════════════════════════════════════════════
   DISCORD BAĞLANTISI
   ══════════════════════════════════════════════════════ */
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
    if (!msg.member.permissions.has('Administrator')) return msg.reply('Buna yetkin yok ufaklık.');
    activeGuilds.add(msg.guild.id);
    saveGuardList(); // Kayıt et
    return msg.reply('✅ **Edward Guard Aktif!**');
  }

  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return msg.reply('Ne var? Bir şey mi soracaksın?');

    await msg.channel.sendTyping();
    const cevap = await anaIsleyici(soru, msg.author.id);
    msg.reply(cevap);
  }
});

client.on('guildBanAdd', async (ban) => {
  const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
  const entry = audit?.entries.first();
  if (entry && entry.executor.id !== client.user.id && !checkLimit(ban.guild.id, entry.executor.id, 'ban')) {
    await ban.guild.members.unban(ban.user).catch(() => {});
    const exec = await ban.guild.members.fetch(entry.executor.id).catch(() => null);
    if (exec) await exec.roles.set([]).catch(() => {});
  }
});

client.on('channelDelete', async (channel) => {
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
  const entry = audit?.entries.first();
  if (entry && entry.executor.id !== client.user.id && !checkLimit(channel.guild.id, entry.executor.id, 'channelDelete')) {
    await channel.clone().catch(() => {});
    const exec = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
    if (exec) await exec.roles.set([]).catch(() => {});
  }
});

client.once('ready', () => {
  console.log(`✅ Edward Elric Göreve Hazır!`);
  // İzliyor Durumu
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);