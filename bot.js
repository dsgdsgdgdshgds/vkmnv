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
      params: { q: sorgu, hl: 'tr', num: 5 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(data);
    const sonuclar = [];

    // Snippet (özet metin) + başlık çek — token israfını önlemek için yalnızca snippet alınır
    $('div.g').each((i, el) => {
      const baslik = $(el).find('h3').first().text().trim();
      // Google snippet sınıfları: .VwiC3b, .s3v9rd, .IsZvec
      const snippet =
        $(el).find('.VwiC3b').text().trim() ||
        $(el).find('.s3v9rd').text().trim() ||
        $(el).find('span[data-ved]').text().trim() ||
        '';
      const urlEl = $(el).find('a[href]').first().attr('href') || '';
      const url = urlEl.startsWith('/url?q=')
        ? urlEl.replace('/url?q=', '').split('&')[0]
        : urlEl;

      if (baslik) {
        // Her snippet en fazla 200 karakter — token tasarrufu
        sonuclar.push({
          baslik,
          snippet: snippet.slice(0, 200),
          url,
        });
      }
    });

    return sonuclar.slice(0, 4);
  } catch (e) {
    console.error('Google arama hatası:', e.message);
    return [];
  }
}

async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const karar = niyetBelirle(soru);

  const systemPrompt = `Sen Edward Elric'sin (Fullmetal Alchemist). Samimi, biraz fevri ama çok zeki birisin. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. Türkçe konuş. Kendinden bahsederken bir devlet simyacısı olduğunu unutma.`;

  if (karar === 'ARAMA') {
    const linkler = await googleArama(soru);

    // Bulunan snippet'leri tek bir özet metin olarak hazırla
    const kaynakMetni = linkler.length > 0
      ? linkler.map((l, i) => `[${i + 1}] ${l.baslik}${l.snippet ? ': ' + l.snippet : ''}`).join('\n')
      : 'Arama sonucu bulunamadı.';

    return await groqCall(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Soru: ${soru}\n\nGoogle'dan çekilen güncel bilgiler:\n${kaynakMetni}\n\nBu bilgilere dayanarak kısa ve net cevap ver.`,
        },
      ],
      800  // arama yanıtları için daha kısa token limiti
    );
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
   ══════════════════════════════════════════════════════
   Kurallar:
   - Her kullanıcı / bot 12 saatte en fazla 2 ban/kick yapabilir
   - Her kullanıcı / bot 12 saatte en fazla 2 kanal silebilir
   - Bu limitlerden herhangi birini aştığı AN sunucudan ban yer
   ══════════════════════════════════════════════════════ */

/**
 * Limiti kontrol eder.
 * @returns {boolean} true → işlem izinli, false → limit aşıldı, kullanıcıyı ban at
 */
function checkLimit(guildId, userId, action) {
  // Guard aktif değilse veya muaf listesindeyse geç
  if (!activeGuilds.has(guildId) || HARIC_ID_LIST.includes(userId)) return true;

  const now = Date.now();
  const WINDOW = 12 * 60 * 60 * 1000; // 12 saat
  const key = `${guildId}-${userId}`;

  if (!guardData.has(key)) {
    guardData.set(key, { ban: [], channelDelete: [] });
  }

  const logs = guardData.get(key);

  // Süresi dolmuş kayıtları temizle
  logs[action] = logs[action].filter(t => now - t < WINDOW);

  // 2. işlemde (yani logs zaten 2 kayıt içeriyorsa) limit aşıldı → BAN
  if (logs[action].length >= 2) return false;

  // Henüz limitin altında → işlemi kaydet ve izin ver
  logs[action].push(now);
  return true;
}

/**
 * Limit aşan kullanıcıyı sunucudan banlar.
 */
async function banIhlalci(guild, userId, sebep) {
  try {
    await guild.members.ban(userId, { reason: `[Edward Guard] ${sebep}` });
    console.log(`[Guard] ${userId} banlandı — ${sebep}`);
  } catch (e) {
    console.error(`[Guard] Ban başarısız (${userId}):`, e.message);
  }
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
    saveGuardList();
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

/* ── BAN olayı ── */
client.on('guildBanAdd', async (ban) => {
  if (!activeGuilds.has(ban.guild.id)) return;

  const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;

  const executorId = entry.executor.id;

  if (!checkLimit(ban.guild.id, executorId, 'ban')) {
    // Önce yasak kaldır, sonra ihlalciyi ban
    await ban.guild.members.unban(ban.user).catch(() => {});
    await banIhlalci(ban.guild, executorId, '12 saatte 2 ban limitini aştı');
  }
});

/* ── KICK olayı — ban limiti ile aynı sayaca dahil ── */
client.on('guildMemberRemove', async (member) => {
  if (!activeGuilds.has(member.guild.id)) return;

  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 20 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;
  // Sadece gerçekten kick ise işle (hedef eşleşmeli ve son 3 sn içinde olmalı)
  if (entry.target?.id !== member.id) return;
  if (Date.now() - entry.createdTimestamp > 3000) return;

  const executorId = entry.executor.id;

  if (!checkLimit(member.guild.id, executorId, 'ban')) {
    await banIhlalci(member.guild, executorId, '12 saatte 2 ban/kick limitini aştı');
  }
});

/* ── KANAL SİLME olayı ── */
client.on('channelDelete', async (channel) => {
  if (!activeGuilds.has(channel.guild.id)) return;

  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;

  const executorId = entry.executor.id;

  if (!checkLimit(channel.guild.id, executorId, 'channelDelete')) {
    // Kanalı geri al
    await channel.clone().catch(() => {});
    // İhlalciyi ban
    await banIhlalci(channel.guild, executorId, '12 saatte 2 kanal silme limitini aştı');
  }
});

client.once('ready', () => {
  console.log(`✅ Edward Elric Göreve Hazır!`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);