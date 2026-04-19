const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
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
const GROQ_KEY = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const FAST = 'llama-3.1-8b-instant';
const SMART = 'llama-3.3-70b-versatile';
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';
const TMP = '/tmp/bb';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

/* ── HAFIZA ──────────────────────────────────────────── */
const mem = new Map();
const MAX = 30;

/* ══════════════════════════════════════════════════════
   GROQ - ANA BEYİN
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, model = SMART, max_tokens = 2000, temperature = 0.5) {
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
}

/* ══════════════════════════════════════════════════════
   🧠 GERÇEK YAPAY ZEKA - KENDİ KENDİNE DÜŞÜNÜR
   Soruyu analiz eder, hangi sitelere gideceğine karar verir
   ══════════════════════════════════════════════════════ */

async function akilliWebGezgini(soru) {
  // 1. ADIM: Niyet analizi - Kullanıcı ne istiyor?
  const niyetAnalizi = await groqCall([
    {
      role: 'system',
      content: `Sen bir arama stratejisti olarak kullanıcının sorusunu analiz et.
      
      Çıktı olarak SADECE JSON formatında şunu döndür:
      {
        "niyet": "hava_durumu | haber | finans | bilgi | alisveris | sosyal_medya | teknoloji | spor | egitim | genel",
        "anahtar_kelimeler": ["kelime1", "kelime2", ...],
        "arama_sorgulari": ["google'da aranacak 2-3 farklı sorgu"],
        "site_onerileri": ["muhtemelen bilgi bulunabilecek site domain'leri (örn: weather.com, bbc.com)"],
        "dil": "tr veya en"
      }`
    },
    { role: 'user', content: soru }
  ], SMART, 300, 0.3);

  let strateji;
  try {
    const match = niyetAnalizi.match(/\{[\s\S]*\}/);
    strateji = match ? JSON.parse(match[0]) : null;
  } catch (e) {
    console.log('Strateji parse hatası:', e.message);
  }

  if (!strateji) {
    // Fallback strateji
    strateji = {
      niyet: 'genel',
      anahtar_kelimeler: soru.split(' ').slice(0, 5),
      arama_sorgulari: [soru],
      site_onerileri: [],
      dil: 'tr'
    };
  }

  console.log('🧠 Niyet:', strateji.niyet, '| Sorgular:', strateji.arama_sorgulari);

  // 2. ADIM: Google arama yap (gerçek tarayıcı gibi)
  const aramaSonuclari = await googleArama(strateji.arama_sorgulari[0]);

  // 3. ADIM: En alakalı siteleri ziyaret et ve içerik çek
  const siteIcerikleri = await siteZiyaretcisi(aramaSonuclari, strateji, soru);

  // 4. ADIM: Tüm verileri Groq'ya ver, cevap üret
  const cevap = await bilgiBirlestirici(soru, siteIcerikleri, strateji);

  return {
    cevap,
    kaynaklar: siteIcerikleri.map(s => s.url).filter(u => u),
    strateji
  };
}

/* ──────────────────────────────────────────────────────
   Google Arama (HTML scraping)
   ────────────────────────────────────────────────────── */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { 
        q: sorgu, 
        hl: 'tr', 
        num: 10 
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const sonuclar = [];

    // Google sonuç bağlantılarını çıkar
    $('a').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.startsWith('/url?q=')) {
        const url = href.replace('/url?q=', '').split('&')[0];
        if (url.startsWith('http') && !url.includes('google.com')) {
          const baslik = $(elem).find('h3').text().trim();
          if (baslik) {
            sonuclar.push({ url, baslik });
          }
        }
      }
    });

    return sonuclar.slice(0, 8); // İlk 8 sonuç
  } catch (e) {
    console.log('Google arama hatası:', e.message);

    // Yedek: DuckDuckGo HTML
    try {
      const { data } = await axios.post('https://html.duckduckgo.com/html/', 
        new URLSearchParams({ q: sorgu }).toString(),
        { 
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0'
          },
          timeout: 10000 
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
      console.log('DuckDuckGo da patladı:', e2.message);
      return [];
    }
  }
}

/* ──────────────────────────────────────────────────────
   Site Ziyaretçisi - En alakalı 5 siteyi ziyaret eder
   ────────────────────────────────────────────────────── */
async function siteZiyaretcisi(linkler, strateji, orijinalSoru) {
  const icerikler = [];
  const ziyaretEdilecekler = linkler.slice(0, 5);

  const promises = ziyaretEdilecekler.map(async (link) => {
    try {
      console.log(`🌐 Ziyaret ediliyor: ${link.url}`);

      const { data } = await axios.get(link.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr,en;q=0.9',
        },
        timeout: 8000,
        maxRedirects: 3
      });

      const $ = cheerio.load(data);

      // Sayfadaki ana metni çıkar
      let metin = '';

      // Önemli etiketlerden metin topla
      $('p, h1, h2, h3, article, .content, .post-content, .entry-content, main').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) {
          metin += text + '\n';
        }
      });

      // Eğer yeterli metin yoksa body'den al
      if (metin.length < 200) {
        metin = $('body').text().replace(/\s+/g, ' ').trim();
      }

      // Metni kısalt (ilk 3000 karakter)
      metin = metin.substring(0, 3000);

      // Alakalılık skoru hesapla (basit anahtar kelime eşleşmesi)
      let alakaPuani = 0;
      strateji.anahtar_kelimeler.forEach(kelime => {
        const regex = new RegExp(kelime, 'gi');
        const matches = metin.match(regex);
        if (matches) alakaPuani += matches.length;
      });

      if (metin.length > 100) {
        icerikler.push({
          url: link.url,
          baslik: link.baslik,
          metin: metin,
          alaka: alakaPuani
        });
      }

    } catch (e) {
      console.log(`❌ ${link.url} erişilemedi:`, e.message);
    }
  });

  await Promise.allSettled(promises);

  // Alakaya göre sırala
  icerikler.sort((a, b) => b.alaka - a.alaka);

  return icerikler.slice(0, 3); // En alakalı 3 site
}

/* ──────────────────────────────────────────────────────
   Bilgi Birleştirici - Groq'ya ver ve cevap üret
   ────────────────────────────────────────────────────── */
async function bilgiBirlestirici(soru, icerikler, strateji) {
  const kaynakMetni = icerikler.map((s, i) => 
    `[KAYNAK ${i+1}: ${s.url}]\n${s.metin}\n`
  ).join('\n---\n');

  const prompt = `Sen bir araştırma asistanısın. Aşağıda farklı web sitelerinden toplanmış güncel bilgiler var.

Kullanıcı Sorusu: "${soru}"

İnternetten Toplanan Bilgiler:
${kaynakMetni || "(Hiçbir siteden veri çekilemedi, lütfen kendi bilgine göre yanıtla)"}

Görevin:
1. Bu bilgileri kullanarak soruyu doğru, güncel ve kapsamlı şekilde yanıtla.
2. Bilgiler çelişiyorsa en güvenilir olanı seç veya farklı görüşleri belirt.
3. Asla kaynak, link veya URL gösterme. Yanıtın sonuna herhangi bir kaynak ekleme.
4. Eğer kullanıcı "kim yaptı", "geliştirici kim", "seni kim yaptı" veya benzeri bir soru sorarsa, geliştiricinin adının "Batuhan" olduğunu söyle.
5. Türkçe yanıt ver, samimi ve yardımsever ol.

Yanıtın:`;

  const cevap = await groqCall([
    { role: 'system', content: 'Sen güncel web verilerini analiz eden akıllı bir asistansın. Asla kaynak, link veya URL göstermezsin. Geliştirici kim diye sorulursa sadece "Batuhan" dersin.' },
    { role: 'user', content: prompt }
  ], SMART, 1500, 0.4);

  return cevap;
}

/* ══════════════════════════════════════════════════════
   🎨 GÖRSEL OKUMA (Groq Vision)
   ══════════════════════════════════════════════════════ */
async function gorselOku(url, soru) {
  try {
    const img = await axios.get(url, { 
      responseType: 'arraybuffer', 
      timeout: 15000 
    });
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
   🎬 VİDEO OLUŞTURMA (Tamamen sıfırdan AVI)
   ══════════════════════════════════════════════════════ */
function videoOlustur(metin, dosya) {
  const W = 640, H = 480, FPS = 2;
  const sure = Math.max(3, Math.min(10, Math.ceil(metin.length / 40)));
  const kares = FPS * sure;

  // Basit AVI yapısı
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const cc4 = (s) => Buffer.from(s.padEnd(4,' ').slice(0,4));

  // BMP frame
  const rowPad = Math.ceil(W * 3 / 4) * 4;
  const pixLen = rowPad * H;
  const bmpBuf = Buffer.alloc(54 + pixLen, 0);
  bmpBuf.write('BM');
  bmpBuf.writeUInt32LE(54 + pixLen, 2);
  bmpBuf.writeUInt32LE(54, 10);
  bmpBuf.writeUInt32LE(40, 14);
  bmpBuf.writeInt32LE(W, 18);
  bmpBuf.writeInt32LE(-H, 22);
  bmpBuf.writeUInt16LE(1, 26);
  bmpBuf.writeUInt16LE(24, 28);
  bmpBuf.writeUInt32LE(pixLen, 34);

  // Arka plan rengi
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = 54 + y * rowPad + x * 3;
      bmpBuf[o] = 100; bmpBuf[o+1] = 50; bmpBuf[o+2] = 30;
    }
  }

  const piksel = bmpBuf.slice(54);
  const chunks = [];
  for (let i = 0; i < kares; i++) {
    chunks.push(Buffer.concat([cc4('00dc'), u32(piksel.length), piksel, 
      piksel.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]));
  }

  const movi = Buffer.concat(chunks);
  const moviList = Buffer.concat([cc4('LIST'), u32(4 + movi.length), cc4('movi'), movi]);
  const strh = Buffer.concat([cc4('strh'), u32(56), cc4('vids'), cc4('DIB '), 
    u32(0), u32(0), u32(0), u32(1), u32(FPS), u32(0), u32(kares), u32(0), u32(0), 
    u16(W), u16(H), Buffer.alloc(4)]);
  const strf = Buffer.concat([cc4('strf'), u32(40), u32(40), u32(W), u32(H), 
    u16(1), u16(24), u32(0), u32(piksel.length), u32(0), u32(0), u32(0), u32(0)]);
  const strl = Buffer.concat([cc4('LIST'), u32(4+strh.length+strf.length), cc4('strl'), strh, strf]);
  const avih = Buffer.concat([cc4('avih'), u32(56), u32(Math.round(1e6/FPS)), 
    u32(piksel.length * FPS), u32(0), u32(0x110), u32(kares), u32(0), u32(1), u32(0), 
    u32(W), u32(H), Buffer.alloc(16)]);
  const hdrl = Buffer.concat([cc4('LIST'), u32(4+avih.length+strl.length), cc4('hdrl'), avih, strl]);
  const riffBody = Buffer.concat([cc4('AVI '), hdrl, moviList]);
  const riff = Buffer.concat([cc4('RIFF'), u32(riffBody.length), riffBody]);

  fs.writeFileSync(dosya, riff);
}

/* ══════════════════════════════════════════════════════
   🤖 DISCORD BOT
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (msg.mentions.everyone) return;
  if (!msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  const ekler = [...msg.attachments.values()];

  if (!soru && !ekler.length) {
    return msg.reply('Ne sormak istiyorsun? 🤖');
  }

  await msg.channel.sendTyping();

  try {
    let cevap;

    // Görsel varsa
    if (ekler.length > 0) {
      const gorsel = ekler.find(a => a.contentType?.startsWith('image'));
      if (gorsel) {
        const aciklama = await gorselOku(gorsel.url, soru);
        cevap = aciklama || 'Görseli analiz edemedim.';
      } else {
        cevap = await akilliWebGezgini(soru);
      }
    } else if (soru.toLowerCase().includes('video') && 
               (soru.includes('yap') || soru.includes('oluştur'))) {
      // Video isteği
      const videoYol = path.join(TMP, `v_${Date.now()}.avi`);
      videoOlustur(soru, videoYol);

      await msg.reply({
        content: '🎬 İşte videon hazır!',
        files: [new AttachmentBuilder(videoYol)]
      });

      setTimeout(() => fs.unlinkSync(videoYol), 10000);
      return;
    } else {
      // Normal soru - Akıllı web gezgini
      const sonuc = await akilliWebGezgini(soru);
      cevap = sonuc.cevap;
    }

    // Uzun mesajları böl
    if (cevap.length > 1900) {
      const parcalar = cevap.match(/[\s\S]{1,1900}/g) || [];
      for (const parca of parcalar) {
        await msg.channel.send(parca);
      }
    } else {
      await msg.reply(cevap);
    }

  } catch (e) {
    console.error('Hata:', e);
    await msg.reply('⚠️ Bir sorun oluştu, tekrar dener misin?');
  }
});

client.once('ready', c => {
  console.log(`✅ ${c.user.tag} hazır!`);
  console.log(`🕒 ${new Date().toLocaleString('tr-TR')}`);
  console.log(`🧠 Akıllı Web Gezgini aktif - Groq ile çalışıyor`);
});

client.login(DISCORD_TOKEN);

process.on('unhandledRejection', e => console.error('🔥', e));