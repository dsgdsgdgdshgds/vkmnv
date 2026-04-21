const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');
const cheerio = require('cheerio');

/* ── SERVER ── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG ── */
const GROQ_KEY = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const SMART = 'llama-3.3-70b-versatile';
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';

/* ── HAFIZA ── */
const mem = new Map();
const MAX_MESAJ = 10; 

/* ── GUARD CONFIG ── */
const guardData = new Map();
const activeGuilds = new Set();
const HARIC_ID_LIST = ['914407026036199425','760895784153251841','1149679692597702666','1297139606114009203','1489907517726396458','1382683855886090260','1459867553949290693'];

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
    const status = e.response?.status;
    console.error(`Groq Hatası (deneme ${deneme + 1}):`, e.response?.data || e.message);

    if ((status === 429 || status >= 500) && deneme < 3) {
      const bekle = (deneme + 1) * 4000;
      await new Promise(res => setTimeout(res, bekle));
      return groqCall(messages, max_tokens, temperature, deneme + 1);
    }
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   NİYET ANALİZİ
   ══════════════════════════════════════════════════════ */
function niyetBelirle(soru) {
  const s = soru.toLowerCase();
  const aramaKelimeler = [
    'bugün', 'bu gün', 'şu an', 'şu anda', 'şimdi', 'son dakika', 'güncel',
    'bu hafta', 'bu ay', 'bu yıl', 'dün', 'yarın',
    'kaç lira', 'kaç tl', 'kaç dolar', 'fiyat', 'kur', 'döviz', 'dolar', 'euro',
    'borsa', 'bitcoin', 'kripto', 'altın', 'faiz',
    'haber', 'son haber', 'gelişme', 'deprem', 'seçim', 'maç', 'skor',
    'kim kazandı', 'sonuç', 'fikstür', 'transfer',
    'hava durumu', 'hava nasıl', 'yağmur', 'sıcaklık', 'derece',
    'nerede', 'nasıl gidilir', 'açık mı', 'ne zaman', 'kaçta',
  ];
  return aramaKelimeler.some(k => s.includes(k)) ? 'ARAMA' : 'SOHBET';
}

/* ══════════════════════════════════════════════════════
   GOOGLE ARAMA
   ══════════════════════════════════════════════════════ */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 10 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000,
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
    return sonuclar.slice(0, 8);
  } catch { return []; }
}

async function siteZiyaretcisi(linkler, anahtar_kelimeler) {
  const icerikler = [];
  const promises = linkler.slice(0, 5).map(async (link) => {
    try {
      const { data } = await axios.get(link.url, { timeout: 6000 });
      const $ = cheerio.load(data);
      $('script, style, nav, footer, header').remove();
      let metin = '';
      $('p, h1, h2, h3, article, .content').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) metin += text + '\n';
      });
      if (metin.length < 200) metin = $('body').text().replace(/\s+/g, ' ').trim();
      metin = metin.substring(0, 1200);
      let alaka = 0;
      anahtar_kelimeler.forEach(k => { if (metin.includes(k)) alaka++; });
      if (metin.length > 100) icerikler.push({ metin, alaka });
    } catch { }
  });
  await Promise.allSettled(promises);
  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { 
    timeZone: 'Europe/Istanbul', 
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' 
  });

  const karar = niyetBelirle(soru);
  
  if (karar === 'ARAMA') {
    const linkler = await googleArama(soru);
    const anahtar = soru.split(' ').filter(k => k.length > 2).slice(0, 5);
    const icerikler = await siteZiyaretcisi(linkler, anahtar);
    const kaynakMetni = icerikler.map(s => s.metin).join('\n---\n');

    return await groqCall([
      {
        role: 'system',
        content: `Sen yardımsever bir asistansın. Adın Edward Elric. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. Verilen bilgileri kullanarak soruyu doğal Türkçe ile cevapla.`,
      },
      {
        role: 'user',
        content: `Soru: ${soru}\n\nBulunan Bilgiler:\n${kaynakMetni || '(Bilgi yok, kendi bilginle cevapla)'}`,
      },
    ]);
  }

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([
    { 
      role: 'system', 
      content: `Sen samimi bir asistansın. Adın Edward Elric. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. Türkçe ve doğal konuş.` 
    },
    ...gecmis,
  ]);

  const sonCevap = cevap || 'Şu an cevap veremiyorum.';
  gecmis.push({ role: 'assistant', content: sonCevap });
  while (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);

  return sonCevap;
}

/* ══════════════════════════════════════════════════════
   GUARD MANTIĞI
   ══════════════════════════════════════════════════════ */
function checkLimit(guildId, userId, action) {
  if (!activeGuilds.has(guildId)) return true;
  if (HARIC_ID_LIST.includes(userId)) return true;

  const now = Date.now();
  const timeframe = 12 * 60 * 60 * 1000; 
  const key = `${guildId}-${userId}`;
  
  if (!guardData.has(key)) {
    guardData.set(key, { ban: [], kick: [], channelDelete: [] });
  }

  const userLogs = guardData.get(key);
  userLogs[action] = userLogs[action].filter(time => now - time < timeframe);

  if (userLogs[action].length >= 2) return false;

  userLogs[action].push(now);
  return true;
}

/* ══════════════════════════════════════════════════════
   DISCORD CLIENT & EVENTS
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot) return;

  // eguard Komutu
  if (msg.content.toLowerCase() === 'eguard' && msg.guild) {
    if (!msg.member.permissions.has('Administrator')) return msg.reply('❌ Yetkiniz yetersiz.');
    activeGuilds.add(msg.guild.id);
    return msg.reply('✅ **Guard Sistemi Aktif!** (12 saatte: 2 Ban/Kick/Kanal Silme sınırı)');
  }

  // Yapay Zeka Yanıt Sistemi
  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return msg.reply('Efendim?');

    await msg.channel.sendTyping();
    try {
      const cevap = await anaIsleyici(soru, msg.author.id);
      if (cevap.length > 2000) {
        const parcalar = cevap.match(/[\s\S]{1,1900}/g);
        for (const p of parcalar) await msg.reply(p);
      } else {
        await msg.reply(cevap);
      }
    } catch (e) {
      msg.reply('Şu an yanıt veremiyorum.');
    }
  }
});

// Guard Eventleri
client.on('guildBanAdd', async (ban) => {
  const logs = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
  const log = logs?.entries.first();
  if (!log || log.executor.id === client.user.id) return;

  if (!checkLimit(ban.guild.id, log.executor.id, 'ban')) {
    await ban.guild.members.unban(ban.user).catch(() => {});
    const exec = await ban.guild.members.fetch(log.executor.id).catch(() => null);
    if (exec) await exec.roles.set([]).catch(() => {});
  }
});

client.on('guildMemberRemove', async (member) => {
  const logs = await member.guild.fetchAuditLogs({ limit: 1, type: 20 }).catch(() => null);
  const log = logs?.entries.first();
  if (!log || log.target.id !== member.id || log.executor.id === client.user.id) return;

  if (!checkLimit(member.guild.id, log.executor.id, 'kick')) {
    const exec = await member.guild.members.fetch(log.executor.id).catch(() => null);
    if (exec) await exec.roles.set([]).catch(() => {});
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
  const log = logs?.entries.first();
  if (!log || log.executor.id === client.user.id) return;

  if (!checkLimit(channel.guild.id, log.executor.id, 'channelDelete')) {
    await channel.clone().catch(() => {});
    const exec = await channel.guild.members.fetch(log.executor.id).catch(() => null);
    if (exec) await exec.roles.set([]).catch(() => {});
  }
});

client.once('ready', c => {
  console.log(`✅ Edward Elric hazır! (${c.user.tag})`);
});

client.login(DISCORD_TOKEN);