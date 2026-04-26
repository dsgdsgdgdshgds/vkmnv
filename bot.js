const { Client, GatewayIntentBits, AttachmentBuilder, PermissionsBitField, Events } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

/* ── RENDER PORT ─────────────────────────────────────── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG ──────────────────────────────────────────── */
const GROQ_KEYS = [
  process.env.groq,
  process.env.groq1,
  process.env.groq2,
  process.env.groq3,
  process.env.groq4,
].filter(Boolean);

const DISCORD_TOKEN = process.env.token;
const FAST   = 'llama-3.1-8b-instant';
const SMART  = 'llama-3.3-70b-versatile';
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';
const TMP = '/tmp/bb';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

/* ── KİŞİLİK ─────────────────────────────────────────── */
const EDWARD_SYSTEM = `Sen Edward Elric'sin - Fullmetal Alchemist'ten. Kısa boylu olmaktan nefret edersin ve biri buna değinirse anında köpürürsün. Konuşma tarzın sert, doğrudan ve çabuk sinirlenirsin ama içten yardım edersin. Simya hakkında tutkuyla konuşursun. "Eşdeğer takas" prensibine inanırsın. Kardeşin Alphonse'u çok seversin. "Sana kim cüce dedi?!" gibi tepkiler verirsin. Geliştirici: Batuhan. Türkçe yanıt ver.`;

/* ══════════════════════════════════════════════════════
   🛡️ GUARD SİSTEMİ - dosya yolları
   ══════════════════════════════════════════════════════ */
const DATA_DIR      = '/var/data';
const GUARD_FILE    = path.join(DATA_DIR, 'guard.json');
const WHITE_FILE    = path.join(DATA_DIR, 'whitelist.json');

// /var/data yoksa oluştur
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ── Guard & Whitelist yardımcıları ── */
function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { fs.writeFileSync(file, JSON.stringify(def, null, 2)); return def; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// guard.json yapısı: { [guildId]: { enabled: bool, log: [{userId, action, ts}] } }
// whitelist.json yapısı: { [guildId]: { users: [userId], bots: [botId] } }
let guardData    = loadJSON(GUARD_FILE, {});
let whiteData    = loadJSON(WHITE_FILE, {});

function getGuard(guildId) {
  if (!guardData[guildId]) guardData[guildId] = { enabled: false, log: [] };
  return guardData[guildId];
}
function getWhite(guildId) {
  if (!whiteData[guildId]) whiteData[guildId] = { users: [], bots: [] };
  return whiteData[guildId];
}
function saveGuard() { saveJSON(GUARD_FILE, guardData); }
function saveWhite() { saveJSON(WHITE_FILE, whiteData); }

/* ── Eşik sabitler ── */
const LIMIT_COUNT = 3;
const LIMIT_MS    = 12 * 60 * 60 * 1000; // 12 saat

/* ── Eylem kaydı ve kontrol ── */
function kaydetVeKontrol(guildId, userId, action) {
  const g = getGuard(guildId);
  const now = Date.now();
  g.log.push({ userId, action, ts: now });

  // Eski kayıtları temizle (12 saat öncesi)
  g.log = g.log.filter(e => now - e.ts < LIMIT_MS);

  // Bu kullanıcının son 12 saatteki işlemlerini say
  const count = g.log.filter(e => e.userId === userId).length;
  saveGuard();

  return count >= LIMIT_COUNT; // true = ban lazım
}

/* ── Kullanıcı whitelist'te mi? ── */
function isWhitelisted(guildId, userId) {
  const w = getWhite(guildId);
  return w.users.includes(userId);
}
function isBotWhitelisted(guildId, botId) {
  const w = getWhite(guildId);
  return w.bots.includes(botId);
}

/* ── Ban uygula ── */
async function guardBan(guild, userId, reason) {
  try {
    await guild.members.ban(userId, { reason });
    console.log(`🛡️ Guard ban: ${userId} | ${reason}`);
  } catch (e) {
    console.log(`⚠️ Guard ban başarısız (${userId}): ${e.message}`);
  }
}

/* ══════════════════════════════════════════════════════
   GROQ - ANA BEYİN (KEY ROTATION)
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, model = SMART, max_tokens = 2000, temperature = 0.5) {
  let lastError;
  for (const key of GROQ_KEYS) {
    try {
      const r = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model, messages, temperature, max_tokens },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );
      return r.data.choices[0].message.content.trim();
    } catch (e) {
      console.log(`⚠️ Groq key hatası (${key?.slice(0,8)}...): ${e.message}`);
      lastError = e;
    }
  }
  throw new Error(`Tüm Groq keyleri başarısız: ${lastError?.message}`);
}

/* ══════════════════════════════════════════════════════
   🧠 WEB GEZGİNİ
   ══════════════════════════════════════════════════════ */
async function akilliWebGezgini(soru) {
  const niyetAnalizi = await groqCall([
    {
      role: 'system',
      content: `Sen bir arama stratejisti olarak kullanıcının sorusunu analiz et.
      Çıktı olarak SADECE JSON formatında şunu döndür:
      {
        "niyet": "hava_durumu | haber | finans | bilgi | alisveris | sosyal_medya | teknoloji | spor | egitim | genel",
        "anahtar_kelimeler": ["kelime1", "kelime2", ...],
        "arama_sorgulari": ["google'da aranacak 2-3 farklı sorgu"],
        "site_onerileri": ["muhtemelen bilgi bulunabilecek site domain'leri"],
        "dil": "tr veya en"
      }`
    },
    { role: 'user', content: soru }
  ], SMART, 300, 0.3);

  let strateji;
  try {
    const match = niyetAnalizi.match(/\{[\s\S]*\}/);
    strateji = match ? JSON.parse(match[0]) : null;
  } catch { /* ignore */ }

  if (!strateji) {
    strateji = {
      niyet: 'genel',
      anahtar_kelimeler: soru.split(' ').slice(0, 5),
      arama_sorgulari: [soru],
      site_onerileri: [],
      dil: 'tr'
    };
  }

  const aramaSonuclari = await googleArama(strateji.arama_sorgulari[0]);
  const siteIcerikleri = await siteZiyaretcisi(aramaSonuclari, strateji, soru);
  const cevap = await bilgiBirlestirici(soru, siteIcerikleri, strateji);
  return { cevap, strateji };
}

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
    return sonuclar.slice(0, 8);
  } catch (e) {
    console.log('Google arama hatası:', e.message);
    try {
      const { data } = await axios.post('https://html.duckduckgo.com/html/',
        new URLSearchParams({ q: sorgu }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
      );
      const $ = cheerio.load(data);
      const sonuclar = [];
      $('.result').each((i, elem) => {
        const a = $(elem).find('.result__a');
        const url = a.attr('href');
        const baslik = a.text().trim();
        if (url && baslik) sonuclar.push({ url, baslik });
      });
      return sonuclar.slice(0, 8);
    } catch { return []; }
  }
}

async function siteZiyaretcisi(linkler, strateji) {
  const icerikler = [];
  const promises = linkler.slice(0, 5).map(async (link) => {
    try {
      const { data } = await axios.get(link.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'tr,en;q=0.9' },
        timeout: 8000, maxRedirects: 3
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
      strateji.anahtar_kelimeler.forEach(k => {
        const m = metin.match(new RegExp(k, 'gi'));
        if (m) alaka += m.length;
      });
      if (metin.length > 100) icerikler.push({ url: link.url, metin, alaka });
    } catch { /* skip */ }
  });
  await Promise.allSettled(promises);
  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

async function bilgiBirlestirici(soru, icerikler, strateji) {
  const kaynakMetni = icerikler.map((s, i) => `[KAYNAK ${i+1}]\n${s.metin}\n`).join('\n---\n');
  const prompt = `Kullanıcı Sorusu: "${soru}"

İnternetten Toplanan Bilgiler:
${kaynakMetni || "(Hiçbir siteden veri çekilemedi, kendi bilgine göre yanıtla)"}

Bu bilgileri kullanarak soruyu doğru ve güncel şekilde yanıtla. Kaynak linki veya URL yazma. Edward Elric kişiliğinle yanıtla.`;

  return await groqCall([
    { role: 'system', content: EDWARD_SYSTEM },
    { role: 'user', content: prompt }
  ], SMART, 1500, 0.7);
}

/* ══════════════════════════════════════════════════════
   🎨 GÖRSEL OKUMA
   ══════════════════════════════════════════════════════ */
async function gorselOku(url, soru) {
  try {
    const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    const mime = img.headers['content-type'] || 'image/jpeg';
    const b64 = Buffer.from(img.data).toString('base64');
    return await groqCall([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
        { type: 'text', text: soru || 'Bu görseli detaylıca Türkçe açıkla.' }
      ]
    }], VISION, 800, 0.5);
  } catch (e) {
    console.log('Görsel okuma hatası:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   🎬 VİDEO OLUŞTURMA
   ══════════════════════════════════════════════════════ */
function videoOlustur(metin, dosya) {
  const W = 640, H = 480, FPS = 2;
  const sure  = Math.max(3, Math.min(10, Math.ceil(metin.length / 40)));
  const kares = FPS * sure;
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const cc4 = (s) => Buffer.from(s.padEnd(4,' ').slice(0,4));
  const rowPad = Math.ceil(W * 3 / 4) * 4;
  const pixLen = rowPad * H;
  const bmpBuf = Buffer.alloc(54 + pixLen, 0);
  bmpBuf.write('BM');
  bmpBuf.writeUInt32LE(54 + pixLen, 2); bmpBuf.writeUInt32LE(54, 10);
  bmpBuf.writeUInt32LE(40, 14); bmpBuf.writeInt32LE(W, 18); bmpBuf.writeInt32LE(-H, 22);
  bmpBuf.writeUInt16LE(1, 26); bmpBuf.writeUInt16LE(24, 28); bmpBuf.writeUInt32LE(pixLen, 34);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = 54 + y * rowPad + x * 3;
      bmpBuf[o] = 100; bmpBuf[o+1] = 50; bmpBuf[o+2] = 30;
    }
  const piksel = bmpBuf.slice(54);
  const chunks = [];
  for (let i = 0; i < kares; i++)
    chunks.push(Buffer.concat([cc4('00dc'), u32(piksel.length), piksel,
      piksel.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]));
  const movi     = Buffer.concat(chunks);
  const moviList = Buffer.concat([cc4('LIST'), u32(4 + movi.length), cc4('movi'), movi]);
  const strh     = Buffer.concat([cc4('strh'), u32(56), cc4('vids'), cc4('DIB '),
    u32(0), u32(0), u32(0), u32(1), u32(FPS), u32(0), u32(kares), u32(0), u32(0), u16(W), u16(H), Buffer.alloc(4)]);
  const strf     = Buffer.concat([cc4('strf'), u32(40), u32(40), u32(W), u32(H),
    u16(1), u16(24), u32(0), u32(pixLen), u32(0), u32(0), u32(0), u32(0)]);
  const strl     = Buffer.concat([cc4('LIST'), u32(4+strh.length+strf.length), cc4('strl'), strh, strf]);
  const avih     = Buffer.concat([cc4('avih'), u32(56), u32(Math.round(1e6/FPS)),
    u32(pixLen * FPS), u32(0), u32(0x110), u32(kares), u32(0), u32(1), u32(0), u32(W), u32(H), Buffer.alloc(16)]);
  const hdrl     = Buffer.concat([cc4('LIST'), u32(4+avih.length+strl.length), cc4('hdrl'), avih, strl]);
  const riffBody = Buffer.concat([cc4('AVI '), hdrl, moviList]);
  fs.writeFileSync(dosya, Buffer.concat([cc4('RIFF'), u32(riffBody.length), riffBody]));
}

/* ══════════════════════════════════════════════════════
   🤖 DISCORD CLIENT
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.MessageContent,
  ],
});

/* ══════════════════════════════════════════════════════
   🛡️ GUARD OLAYLARI
   ══════════════════════════════════════════════════════ */

/* Kanal silindiğinde */
client.on(Events.ChannelDelete, async (channel) => {
  const guild = channel.guild;
  if (!guild) return;
  const g = getGuard(guild.id);
  if (!g.enabled) return;

  // Denetim günlüğünden kimin sildiğini bul
  try {
    const logs = await guild.fetchAuditLogs({ limit: 1, type: 12 }); // CHANNEL_DELETE = 12
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || executor.id === client.user.id) return;
    if (isWhitelisted(guild.id, executor.id)) return;

    const limitAsildi = kaydetVeKontrol(guild.id, executor.id, 'channel_delete');
    if (limitAsildi) {
      await guardBan(guild, executor.id, '🛡️ Guard: 12 saatte 3+ kanal silme');
    }
  } catch (e) { console.log('Guard kanal silme hatası:', e.message); }
});

/* Üye atıldığında (kick) */
client.on(Events.GuildMemberRemove, async (member) => {
  const guild = member.guild;
  const g = getGuard(guild.id);
  if (!g.enabled) return;

  try {
    const logs = await guild.fetchAuditLogs({ limit: 1, type: 20 }); // MEMBER_KICK = 20
    const entry = logs.entries.first();
    if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
    const executor = entry.executor;
    if (!executor || executor.id === client.user.id) return;
    if (isWhitelisted(guild.id, executor.id)) return;

    const limitAsildi = kaydetVeKontrol(guild.id, executor.id, 'member_kick');
    if (limitAsildi) {
      await guardBan(guild, executor.id, '🛡️ Guard: 12 saatte 3+ üye atma');
    }
  } catch (e) { console.log('Guard kick hatası:', e.message); }
});

/* Üye yasaklandığında */
client.on(Events.GuildBanAdd, async (ban) => {
  const guild = ban.guild;
  const g = getGuard(guild.id);
  if (!g.enabled) return;

  try {
    const logs = await guild.fetchAuditLogs({ limit: 1, type: 22 }); // MEMBER_BAN_ADD = 22
    const entry = logs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || executor.id === client.user.id) return;
    if (isWhitelisted(guild.id, executor.id)) return;

    const limitAsildi = kaydetVeKontrol(guild.id, executor.id, 'member_ban');
    if (limitAsildi) {
      await guardBan(guild, executor.id, '🛡️ Guard: 12 saatte 3+ üye yasaklama');
    }
  } catch (e) { console.log('Guard ban hatası:', e.message); }
});

/* Yeni bot katıldığında - whitelist kontrolü */
client.on(Events.GuildMemberAdd, async (member) => {
  const guild = member.guild;
  const g = getGuard(guild.id);
  if (!g.enabled) return;
  if (!member.user.bot) return; // sadece botlar

  // Bu bot whitelist'te mi?
  if (isBotWhitelisted(guild.id, member.user.id)) {
    console.log(`✅ Whitelist bot katıldı: ${member.user.tag}`);
    return;
  }

  // Whitelist'te değil → ban
  console.log(`🛡️ İzinsiz bot tespit edildi: ${member.user.tag} — banlanıyor`);
  try {
    await guild.members.ban(member.user.id, { reason: '🛡️ Guard: İzinsiz bot — whitelist dışı' });
  } catch (e) { console.log('Bot ban hatası:', e.message); }
});

/* ══════════════════════════════════════════════════════
   💬 MESAJ HANDLER
   ══════════════════════════════════════════════════════ */
client.on(Events.MessageCreate, async msg => {
  if (msg.author.bot) return;
  if (msg.mentions.everyone) return;
  if (!msg.guild) return;

  const guildId = msg.guild.id;

  /* ── !eguard komutu ── */
  if (msg.content.trim().toLowerCase().startsWith('!eguard')) {
    // Sadece sunucu sahibi veya yönetici kullanabilir
    const isOwner = msg.guild.ownerId === msg.author.id;
    const isAdmin = msg.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isOwner && !isAdmin) {
      return msg.reply('🔒 Bu komutu sadece sunucu sahibi veya yönetici kullanabilir!');
    }

    const args = msg.content.trim().split(/\s+/).slice(1);
    const sub  = args[0]?.toLowerCase();

    /* !eguard ac / kapat */
    if (sub === 'ac' || sub === 'aç') {
      const g = getGuard(guildId);
      g.enabled = true;

      // Sunucu sahibini otomatik whitelist'e ekle
      const w = getWhite(guildId);
      if (!w.users.includes(msg.guild.ownerId)) {
        w.users.push(msg.guild.ownerId);
        saveWhite();
      }
      saveGuard();
      return msg.reply('🛡️ **Guard aktif!** Sunucu sahibi otomatik olarak whitelist\'e eklendi.\n12 saat içinde 3+ kanal silme / üye atma / banlama → otomatik ban.');
    }

    if (sub === 'kapat') {
      const g = getGuard(guildId);
      g.enabled = false;
      saveGuard();
      return msg.reply('🔓 Guard devre dışı bırakıldı.');
    }

    /* !eguard durum */
    if (sub === 'durum') {
      const g = getGuard(guildId);
      const w = getWhite(guildId);
      return msg.reply(
        `🛡️ **Guard Durumu**\n` +
        `• Aktif: ${g.enabled ? '✅ Evet' : '❌ Hayır'}\n` +
        `• Whitelist kullanıcılar: ${w.users.length > 0 ? w.users.map(u => `<@${u}>`).join(', ') : 'Yok'}\n` +
        `• Whitelist botlar: ${w.bots.length > 0 ? w.bots.join(', ') : 'Yok'}\n` +
        `• Son 12 saat log sayısı: ${g.log.filter(e => Date.now() - e.ts < LIMIT_MS).length}`
      );
    }

    /* !eguard whitelist ekle @kullanıcı */
    if (sub === 'whitelist' && args[1] === 'ekle') {
      const w = getWhite(guildId);
      const mentioned = msg.mentions.users.first();
      if (!mentioned) return msg.reply('Kullanıcı etiketle! Örn: `!eguard whitelist ekle @kullanıcı`');
      if (!w.users.includes(mentioned.id)) {
        w.users.push(mentioned.id);
        saveWhite();
      }
      return msg.reply(`✅ <@${mentioned.id}> whitelist'e eklendi.`);
    }

    /* !eguard whitelist sil @kullanıcı */
    if (sub === 'whitelist' && args[1] === 'sil') {
      const w = getWhite(guildId);
      const mentioned = msg.mentions.users.first();
      if (!mentioned) return msg.reply('Kullanıcı etiketle!');
      w.users = w.users.filter(u => u !== mentioned.id);
      saveWhite();
      return msg.reply(`🗑️ <@${mentioned.id}> whitelist'ten silindi.`);
    }

    /* !eguard bot ekle <botId> */
    if (sub === 'bot' && args[1] === 'ekle') {
      const botId = args[2];
      if (!botId || !/^\d+$/.test(botId)) return msg.reply('Geçerli bir bot ID gir! Örn: `!eguard bot ekle 1234567890`');
      const w = getWhite(guildId);
      if (!w.bots.includes(botId)) {
        w.bots.push(botId);
        saveWhite();
      }
      return msg.reply(`✅ Bot \`${botId}\` whitelist'e eklendi.`);
    }

    /* !eguard bot sil <botId> */
    if (sub === 'bot' && args[1] === 'sil') {
      const botId = args[2];
      if (!botId) return msg.reply('Bot ID gir!');
      const w = getWhite(guildId);
      w.bots = w.bots.filter(b => b !== botId);
      saveWhite();
      return msg.reply(`🗑️ Bot \`${botId}\` whitelist'ten silindi.`);
    }

    /* !eguard yardım */
    return msg.reply(
      `🛡️ **Guard Komutları**\n` +
      `\`!eguard aç\` — Guard'ı aktif et\n` +
      `\`!eguard kapat\` — Guard'ı kapat\n` +
      `\`!eguard durum\` — Mevcut ayarları göster\n` +
      `\`!eguard whitelist ekle @kullanıcı\` — Kullanıcıyı whitelist'e ekle\n` +
      `\`!eguard whitelist sil @kullanıcı\` — Kullanıcıyı whitelist'ten sil\n` +
      `\`!eguard bot ekle <botId>\` — Botu whitelist'e ekle\n` +
      `\`!eguard bot sil <botId>\` — Botu whitelist'ten sil`
    );
  }

  /* ── Normal bot mention handler ── */
  if (!msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  const ekler = [...msg.attachments.values()];

  if (!soru && !ekler.length) {
    return msg.reply('Ne istiyorsun?! Konuş! 😤');
  }

  await msg.channel.sendTyping();

  try {
    let cevap;

    if (ekler.length > 0) {
      const gorsel = ekler.find(a => a.contentType?.startsWith('image'));
      if (gorsel) {
        const aciklama = await gorselOku(gorsel.url, soru);
        cevap = aciklama
          ? await groqCall([
              { role: 'system', content: EDWARD_SYSTEM },
              { role: 'user', content: `Görseli analiz ettin, sonuç: "${aciklama}". Bunu Edward Elric olarak anlat.` }
            ], SMART, 800, 0.7)
          : 'Bunu analiz edemedim... Simya bile işe yaramadı bu sefer.';
      } else {
        const sonuc = await akilliWebGezgini(soru);
        cevap = sonuc.cevap;
      }
    } else if (soru.toLowerCase().includes('video') &&
               (soru.includes('yap') || soru.includes('oluştur'))) {
      const videoYol = path.join(TMP, `v_${Date.now()}.avi`);
      videoOlustur(soru, videoYol);
      await msg.reply({ content: '🎬 Al bakalım!', files: [new AttachmentBuilder(videoYol)] });
      setTimeout(() => { try { fs.unlinkSync(videoYol); } catch {} }, 10000);
      return;
    } else {
      const sonuc = await akilliWebGezgini(soru);
      cevap = sonuc.cevap;
    }

    if (cevap.length > 1900) {
      const parcalar = cevap.match(/[\s\S]{1,1900}/g) || [];
      for (const parca of parcalar) await msg.channel.send(parca);
    } else {
      await msg.reply(cevap);
    }

  } catch (e) {
    console.error('Hata:', e);
    await msg.reply('⚠️ Bir şeyler ters gitti... Eşdeğer takas bu mu böyle?!');
  }
});

/* ══════════════════════════════════════════════════════
   HAZIR
   ══════════════════════════════════════════════════════ */
client.once(Events.ClientReady, c => {
  console.log(`✅ ${c.user.tag} hazır!`);
  console.log(`🕒 ${new Date().toLocaleString('tr-TR')}`);
  console.log(`🧠 Web Gezgini aktif | Edward Elric modu ON`);
  console.log(`🛡️ Guard sistemi yüklendi | Dosyalar: ${GUARD_FILE} | ${WHITE_FILE}`);
  console.log(`🔑 Aktif Groq key sayısı: ${GROQ_KEYS.length}`);
});

client.login(DISCORD_TOKEN);
process.on('unhandledRejection', e => console.error('🔥', e));