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
const MAX_PAIRS = 6; // user+assistant çifti

/* ══════════════════════════════════════════════════════
   GROQ API
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, model = SMART, max_tokens = 2000, temperature = 0.5) {
  try {
    const r = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model, messages, temperature, max_tokens },
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
    console.error('Groq Hatası:', e.response?.data || e.message);
    return 'API hatası oluştu.';
  }
}

/* ══════════════════════════════════════════════════════
   HAFIZA YÖNETİMİ — user+assistant çiftleri dengeli
   ══════════════════════════════════════════════════════ */
function hafizayaEkle(userId, role, content) {
  if (!mem.has(userId)) mem.set(userId, []);
  const gecmis = mem.get(userId);
  gecmis.push({ role, content });
  while (gecmis.length > MAX_PAIRS * 2) gecmis.splice(0, 2);
}

function hafizaGetir(userId) {
  return mem.get(userId) || [];
}

/* ══════════════════════════════════════════════════════
   GOOGLE ARAMA (çalışan versiyon)
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

    // Yedek: DuckDuckGo
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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr,en;q=0.9',
        },
        timeout: 8000,
        maxRedirects: 3,
      });

      const $ = cheerio.load(data);
      let metin = '';

      $('p, h1, h2, h3, article, .content, .post-content, .entry-content, main').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) metin += text + '\n';
      });

      if (metin.length < 200) {
        metin = $('body').text().replace(/\s+/g, ' ').trim();
      }

      metin = metin.substring(0, 3000);

      let alaka = 0;
      anahtar_kelimeler.forEach(k => {
        const m = metin.match(new RegExp(k, 'gi'));
        if (m) alaka += m.length;
      });

      if (metin.length > 100) {
        icerikler.push({ url: link.url, baslik: link.baslik, metin, alaka });
      }
    } catch (e) {
      console.log(`Erişilemedi: ${link.url}`);
    }
  });

  await Promise.allSettled(promises);
  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

/* ══════════════════════════════════════════════════════
   BİLGİ BİRLEŞTİRİCİ
   ══════════════════════════════════════════════════════ */
async function bilgiBirlestirici(soru, icerikler) {
  const kaynakMetni = icerikler
    .map((s, i) => `[KAYNAK ${i + 1}: ${s.url}]\n${s.metin}`)
    .join('\n---\n');

  return await groqCall(
    [
      {
        role: 'system',
        content: 'Sen güncel web verilerini analiz eden akıllı bir asistansın. Geliştiricin Batuhan. Türkçe konuş, yabancı kelime kullanma.',
      },
      {
        role: 'user',
        content: `Soru: "${soru}"\n\nİnternetten Toplanan Bilgiler:\n${kaynakMetni || '(Veri çekilemedi, kendi bilginle yanıtla)'}`,
      },
    ],
    SMART,
    1500,
    0.4
  );
}

/* ══════════════════════════════════════════════════════
   NİYET ANALİZİ — SOHBET mi ARAMA mı?
   ══════════════════════════════════════════════════════ */
async function niyetBelirle(soru) {
  const cevap = await groqCall(
    [
      {
        role: 'system',
        content: `Kullanıcı mesajını analiz et ve sadece tek kelime yaz: "ARAMA" veya "SOHBET".

ARAMA gereken durumlar:
- Güncel haberler, son dakika gelişmeleri
- Hava durumu
- Döviz, kripto, borsa fiyatları
- Güncel spor sonuçları, fikstür
- Belirli bir kişi/şirket/ürün hakkında güncel bilgi
- "şu an", "bugün", "son", "güncel", "kaç lira", "ne zaman", "kim kazandı" gibi ifadeler
- Spesifik bir olay veya habere dair soru

SOHBET gereken durumlar:
- Selamlaşma, sohbet, şaka
- Genel kültür, tanım, açıklama
- Fikir sorma, öneri isteme
- Matematik, mantık, yazma yardımı
- Tarihsel bilgi (güncel değil)

Sadece tek kelime yaz.`,
      },
      { role: 'user', content: soru },
    ],
    SMART,
    10,
    0.0
  );

  return cevap.trim().toUpperCase().includes('ARAMA') ? 'ARAMA' : 'SOHBET';
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId) {
  const karar = await niyetBelirle(soru);
  console.log(`[${kullaniciId}] Karar: ${karar} | Soru: ${soru}`);

  if (karar === 'ARAMA') {
    // Anahtar kelimeler için soruyu böl
    const anahtar_kelimeler = soru.split(' ').filter(k => k.length > 2).slice(0, 5);

    const linkler = await googleArama(soru);
    let cevap;

    if (linkler.length === 0) {
      // Arama tamamen başarısız → kendi bilgiyle cevapla
      cevap = await groqCall([
        { role: 'system', content: 'Sen yardımsever bir asistansın. Geliştiricin Batuhan. Türkçe konuş.' },
        { role: 'user', content: soru },
      ]);
    } else {
      const icerikler = await siteZiyaretcisi(linkler, anahtar_kelimeler);
      cevap = await bilgiBirlestirici(soru, icerikler);

      // Kaynakları ekle
      const kaynaklar = icerikler.map(s => s.url);
      if (kaynaklar.length > 0) {
        cevap += '\n\n📚 **Kaynaklar:**\n' + kaynaklar.map(u => `• ${u}`).join('\n');
      }
    }

    hafizayaEkle(kullaniciId, 'user', soru);
    hafizayaEkle(kullaniciId, 'assistant', cevap);
    return cevap;
  }

  // SOHBET
  hafizayaEkle(kullaniciId, 'user', soru);
  const gecmis = hafizaGetir(kullaniciId);

  const cevap = await groqCall([
    {
      role: 'system',
      content: 'Sen samimi bir asistansın. Geliştiricin Batuhan. Türkçe ve doğal konuş, yabancı kelime kullanma.',
    },
    ...gecmis,
  ]);

  hafizayaEkle(kullaniciId, 'assistant', cevap);
  return cevap;
}

/* ══════════════════════════════════════════════════════
   DISCORD
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!soru) return msg.reply('Efendim?');

  if (
    soru.toLowerCase().includes('oylama') &&
    (soru.includes('eşit') || soru.includes('berabere'))
  ) {
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
  console.log(`🕒 ${new Date().toLocaleString('tr-TR')}`);
});

client.login(DISCORD_TOKEN);

process.on('unhandledRejection', e => console.error('🔥', e));