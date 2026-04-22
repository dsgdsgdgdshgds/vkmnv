const { Client, GatewayIntentBits, Partials, ActivityType, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

/* ── DOSYA YOLU VE DİZİN KONTROLÜ ── */
const dataDir = '/var/data';
const filePath = path.join(dataDir, 'guardlist.json');
const whiteListPath = path.join(dataDir, 'whitelist.json'); // Yeni: Beyaz liste dosyası

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
const MAX_MESAJ = 3;

/* ── GUARD CONFIG ── */
const guardData = new Map();
let activeGuilds = new Set();
let whiteListedBots = new Set(); // Yeni: Beyaz listedeki botlar
const HARIC_ID_LIST = [];

// Dosyalardan verileri yükle
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

// Kaydetme fonksiyonları
function saveGuardList() {
  fs.writeFileSync(filePath, JSON.stringify(Array.from(activeGuilds)), 'utf8');
}
function saveWhiteList() {
  fs.writeFileSync(whiteListPath, JSON.stringify(Array.from(whiteListedBots)), 'utf8');
}

/* ══════════════════════════════════════════════════════
   GROQ API & ARAMA FONKSİYONLARI (Değişmedi)
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.5, deneme = 0) {
  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: SMART, messages, temperature, max_tokens },
      { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 }
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

function niyetBelirle(soru) {
  const s = soru.toLowerCase();
  const aramaKelimeler = ['bugün', 'güncel', 'fiyat', 'dolar', 'haber', 'hava durumu', 'maç', 'nedir', 'kimdir'];
  return aramaKelimeler.some(k => s.includes(k)) ? 'ARAMA' : 'SOHBET';
}

async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 5 },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const sonuclar = [];
    $('div.g').each((i, el) => {
      const baslik = $(el).find('h3').first().text().trim();
      const snippet = $(el).find('.VwiC3b').text().trim() || $(el).find('.s3v9rd').text().trim();
      if (baslik) sonuclar.push({ baslik, snippet: snippet?.slice(0, 200) });
    });
    return sonuclar.slice(0, 4);
  } catch (e) { return []; }
}

async function anaIsleyici(soru, kullaniciId) {
  const suAn = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const karar = niyetBelirle(soru);
  const systemPrompt = `Sen Edward Elric'sin. Geliştiricin Batuhan. Güncel Tarih: ${suAn}. Türkçe konuş.`;

  if (karar === 'ARAMA') {
    const linkler = await googleArama(soru);
    const kaynakMetni = linkler.length > 0 ? linkler.map((l, i) => `[${i + 1}] ${l.baslik}: ${l.snippet}`).join('\n') : 'Arama sonucu bulunamadı.';
    return await groqCall([{ role: 'system', content: systemPrompt }, { role: 'user', content: `Soru: ${soru}\nBilgiler:\n${kaynakMetni}` }], 800);
  }

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

  // Eguard Aktifleştirme
  if (msg.content.toLowerCase() === 'eguard') {
    if (!msg.member.permissions.has('Administrator')) return msg.reply('Buna yetkin yok ufaklık.');
    activeGuilds.add(msg.guild.id);
    saveGuardList();
    return msg.reply('✅ **Edward Guard Aktif!**');
  }

  // Beyaz Liste Komutları (Sadece Sunucu Sahibi)
  if (msg.content.toLowerCase().startsWith('ebeyazliste')) {
    if (msg.author.id !== msg.guild.ownerId) return msg.reply('Bu komutu sadece sunucu sahibi kullanabilir.');
    const args = msg.content.split(' ');
    const islem = args[1]; // ekle / cikar
    const botId = args[2];

    if (!botId || isNaN(botId)) return msg.reply('Lütfen geçerli bir Bot ID gir.');

    if (islem === 'ekle') {
      whiteListedBots.add(botId);
      saveWhiteList();
      return msg.reply(`✅ \`${botId}\` ID'li bot beyaz listeye eklendi.`);
    } else if (islem === 'cikar' || islem === 'çıkar') {
      whiteListedBots.delete(botId);
      saveWhiteList();
      return msg.reply(`❌ \`${botId}\` ID'li bot beyaz listeden çıkarıldı.`);
    }
  }

  // AI Yanıtı
  if (msg.mentions.has(client.user) && !msg.mentions.everyone) {
    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru) return;
    await msg.channel.sendTyping();
    const cevap = await anaIsleyici(soru, msg.author.id);
    msg.reply(cevap);
  }
});

/* ── ANTI-BOT KORUMASI ── */
client.on('guildMemberAdd', async (member) => {
  if (!activeGuilds.has(member.guild.id)) return;
  if (!member.user.bot) return; // Katılan bot değilse çık

  // Eğer bot beyaz listedeyse izin ver
  if (whiteListedBots.has(member.id)) {
    console.log(`[Guard] Beyaz listedeki bot giriş yaptı: ${member.user.tag}`);
    return;
  }

  // Denetim kaydından botu kimin eklediğini bul (Action Type 28 = BOT_ADD)
  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 28 }).catch(() => null);
  const entry = audit?.entries.first();
  
  if (entry) {
    const executorId = entry.executor.id;
    const ownerId = member.guild.ownerId;

    // Ekleyen kişi sahibi değilse VE bot beyaz listede değilse
    if (executorId !== ownerId) {
      // 1. Eklenen Botu Banla
      await member.ban({ reason: '[Edward Guard] İzinsiz Bot Girişi.' }).catch(() => {});
      
      // 2. Ekleyen Yetkiliyi Banla
      await banIhlalci(member.guild, executorId, 'Sunucu sahibi dışındayken bot ekledi.');
      
      console.log(`[Guard] İzinsiz bot engellendi. Bot: ${member.user.tag}, Ekleyen: ${executorId}`);
    }
  }
});

/* ── DİĞER GUARD OLAYLARI (Ban, Kick, Kanal Silme) ── */
client.on('guildBanAdd', async (ban) => {
  if (!activeGuilds.has(ban.guild.id)) return;
  const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;
  if (!checkLimit(ban.guild.id, entry.executor.id, 'ban')) {
    await ban.guild.members.unban(ban.user).catch(() => {});
    await banIhlalci(ban.guild, entry.executor.id, 'Ban limitini aştı.');
  }
});

client.on('guildMemberRemove', async (member) => {
  if (!activeGuilds.has(member.guild.id)) return;
  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: 20 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id || entry.target?.id !== member.id) return;
  if (!checkLimit(member.guild.id, entry.executor.id, 'ban')) {
    await banIhlalci(member.guild, entry.executor.id, 'Kick limitini aştı.');
  }
});

client.on('channelDelete', async (channel) => {
  if (!activeGuilds.has(channel.guild.id)) return;
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 12 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.executor.id === client.user.id) return;
  if (!checkLimit(channel.guild.id, entry.executor.id, 'channelDelete')) {
    await channel.clone().catch(() => {});
    await banIhlalci(channel.guild, entry.executor.id, 'Kanal silme limitini aştı.');
  }
});

client.once('ready', () => {
  console.log(`✅ Edward Elric Göreve Hazır!`);
  client.user.setActivity('Firuze ile Fmab izliyor', { type: ActivityType.Watching });
});

client.login(DISCORD_TOKEN);