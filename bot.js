const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');
const cheerio = require('cheerio');

/* ── SERVER (Uptime için) ── */
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

/* ══════════════════════════════════════════════════════
   GROQ API İŞLEYİCİ
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
    if ((status === 429 || status >= 500) && deneme < 3) {
      const bekle = (deneme + 1) * 4000;
      await new Promise(res => setTimeout(res, bekle));
      return groqCall(messages, max_tokens, temperature, deneme + 1);
    }
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   NİYET ANALİZİ (Regex)
   ══════════════════════════════════════════════════════ */
function niyetBelirle(soru) {
  const s = soru.toLowerCase();
  const aramaKelimeler = [
    'bugün', 'şu an', 'güncel', 'fiyat', 'dolar', 'haber', 'hava durumu', 'son dakika'
  ];
  return aramaKelimeler.some(k => s.includes(k)) ? 'ARAMA' : 'SOHBET';
}

/* ══════════════════════════════════════════════════════
   GOOGLE ARAMA VE SİTE İÇERİĞİ
   ══════════════════════════════════════════════════════ */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
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
    return sonuclar.slice(0, 5);
  } catch { return []; }
}

async function siteZiyaretcisi(linkler) {
  const icerikler = [];
  for (const link of linkler.slice(0, 3)) {
    try {
      const { data } = await axios.get(link.url, { timeout: 5000 });
      const $ = cheerio.load(data);
      $('script, style, nav, footer').remove();
      const metin = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 1000);
      icerikler.push(metin);
    } catch { continue; }
  }
  return icerikler.join('\n---\n');
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ (Mantık)
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId) {
  const karar = niyetBelirle(soru);
  
  if (karar === 'ARAMA') {
    const linkler = await googleArama(soru);
    const kaynakMetni = await siteZiyaretcisi(linkler);
    return await groqCall([
      { role: 'system', content: 'Sen Batuhan tarafından geliştirilen bir asistansın. Bilgileri kullanarak doğal Türkçe ile cevap ver.' },
      { role: 'user', content: `Bilgiler: ${kaynakMetni}\n\nSoru: ${soru}` }
    ]);
  }

  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([
    { role: 'system', content: 'Sen samimi bir asistansın. Geliştiricin Batuhan.' },
    ...gecmis
  ]);

  const sonCevap = cevap || 'Şu an meşgulüm, sonra dener misin?';
  gecmis.push({ role: 'assistant', content: sonCevap });
  if (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);
  
  return sonCevap;
}

/* ══════════════════════════════════════════════════════
   DISCORD BOTU
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ],
});

client.on('messageCreate', async msg => {
  // 1. Botları engelle
  // 2. Mesajda @everyone veya @here etiketi varsa CEVAP VERME
  if (msg.author.bot || msg.mentions.everyone) return;

  // 3. Bot etiketlenmemişse cevap verme
  if (!msg.mentions.has(client.user)) return;

  // Etiketi temizle ve soruyu al
  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!soru) return msg.reply('Efendim?');

  // Özel durum kontrolü (Oylama)
  if (soru.toLowerCase().includes('oylama') && (soru.includes('eşit') || soru.includes('berabere'))) {
    return msg.reply('Oylama berabere bitti, kimse idam edilmedi!');
  }

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
    console.error(e);
    msg.reply('Sistemde küçük bir hata oluştu.');
  }
});

client.once('ready', c => console.log(`✅ ${c.user.tag} aktif!`));
client.login(DISCORD_TOKEN);