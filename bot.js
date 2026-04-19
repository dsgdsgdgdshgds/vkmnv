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
const MAX_MESAJ = 10; // Kaç mesaj tutulsun (user+assistant toplam)

/* ══════════════════════════════════════════════════════
   GROQ API
   - 429 veya sunucu hatası gelince 3 kez retry yapar
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

    if ((status === 429 || status >= 500) && deneme < 10000) {
      const bekle = (deneme + 1) * 4000; // 4s, 8s, 12s
      console.log(`${bekle / 20}s bekleniyor...`);
      await new Promise(res => setTimeout(res, bekle));
      return groqCall(messages, max_tokens, temperature, deneme + 1);
    }

    return null;
  }
}

/* ══════════════════════════════════════════════════════
   NİYET ANALİZİ — Groq token harcamadan regex ile
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
   GOOGLE ARAMA — çalışan versiyon (ikinci dosyadan)
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

    console.log(`Google: ${sonuclar.length} sonuç`);
    return sonuclar.slice(0, 8);
  } catch (e) {
    console.log('Google hatası, DuckDuckGo deneniyor:', e.message);
    try {
      const { data } = await axios.post(
        'https://html.duckduckgo.com/html/',
        new URLSearchParams({ q: sorgu }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 10000,
        }
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
    } catch (e2) {
      console.log('DuckDuckGo da başarısız:', e2.message);
      return [];
    }
  }
}

/* ══════════════════════════════════════════════════════
   SİTE ZİYARETÇİSİ — En alakalı 3 siteyi okur
   ══════════════════════════════════════════════════════ */
async function siteZiyaretcisi(linkler, anahtar_kelimeler) {
  const icerikler = [];

  const promises = linkler.slice(0, 5).map(async (link) => {
    try {
      const { data } = await axios.get(link.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'tr,en;q=0.9',
        },
        timeout: 6000,
        maxRedirects: 3,
      });

      const $ = cheerio.load(data);
      $('script, style, nav, footer, header').remove();
      let metin = '';

      $('p, h1, h2, h3, article, .content, .post-content, main').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) metin += text + '\n';
      });

      if (metin.length < 200) metin = $('body').text().replace(/\s+/g, ' ').trim();

      metin = metin.substring(0, 1200); // Token tasarrufu için kısa tut

      let alaka = 0;
      anahtar_kelimeler.forEach(k => {
        const m = metin.match(new RegExp(k, 'gi'));
        if (m) alaka += m.length;
      });

      if (metin.length > 100) icerikler.push({ metin, alaka });
    } catch { /* erişilemeyen siteyi atla */ }
  });

  await Promise.allSettled(promises);
  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId) {
  const karar = niyetBelirle(soru);
  console.log(`[${kullaniciId}] Karar: ${karar} | Soru: ${soru}`);

  // ── ARAMA YOLU ──
  if (karar === 'ARAMA') {
    const linkler = await googleArama(soru);

    if (linkler.length === 0) {
      // Google/DDG çalışmadıysa kendi bilgiyle cevapla
      return await groqCall([
        { role: 'system', content: 'Sen yardımsever bir asistansın. Geliştiricin Batuhan. Türkçe konuş, yabancı kelime kullanma.' },
        { role: 'user', content: soru },
      ]);
    }

    const anahtar = soru.split(' ').filter(k => k.length > 2).slice(0, 5);
    const icerikler = await siteZiyaretcisi(linkler, anahtar);
    const kaynakMetni = icerikler.map(s => s.metin).join('\n---\n');

    const cevap = await groqCall([
      {
        role: 'system',
        content: 'Sen yardımsever bir asistansın. Geliştiricin Batuhan. Verilen bilgileri kullanarak soruyu doğal Türkçe ile cevapla. Yabancı kelime ve kaynak/link belirtme.',
      },
      {
        role: 'user',
        content: `Soru: ${soru}\n\nBulunan Bilgiler:\n${kaynakMetni || '(Bilgi çekilemedi, kendi bilginle cevapla)'}`,
      },
    ]);

    // Arama cevabını da hafızaya ekle
    if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
    const gecmis = mem.get(kullaniciId);
    gecmis.push({ role: 'user', content: soru });
    gecmis.push({ role: 'assistant', content: cevap || '' });
    while (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);

    return cevap || 'Şu an cevap veremiyorum, biraz sonra tekrar dener misin?';
  }

  // ── SOHBET YOLU ──
  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);

  gecmis.push({ role: 'user', content: soru });
  while (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2); // En eski çifti sil

  const cevap = await groqCall([
    { role: 'system', content: 'Sen samimi bir asistansın. Geliştiricin Batuhan. Türkçe ve doğal konuş, yabancı kelime kullanma.' },
    ...gecmis,
  ]);

  const sonCevap = cevap || 'Şu an cevap veremiyorum, biraz sonra tekrar dener misin?';
  gecmis.push({ role: 'assistant', content: sonCevap });
  while (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);

  return sonCevap;
}

/* ══════════════════════════════════════════════════════
   DISCORD
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!soru) return msg.reply('Efendim?');

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
    msg.reply('Şu an yanıt veremiyorum, sistemde bir aksaklık var.');
  }
});

client.once('ready', c => {
  console.log(`✅ ${c.user.tag} hazır!`);
});

client.login(DISCORD_TOKEN);

process.on('unhandledRejection', e => console.error('🔥', e));