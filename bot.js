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

function simdi() {
  return new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
}

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
   🧠 AKILLI KARAR VE WEB GEZGİNİ
   ══════════════════════════════════════════════════════ */

async function akilliWebGezgini(soru) {
  // 1. ADIM: Niyet Analizi - İnternet araması şart mı?
  const niyetAnalizi = await groqCall([
    {
      role: 'system',
      content: `Sen bir karar mekanizmasısın. Kullanıcının sorusunu analiz et. 
      Sadece şu durumlarda "internet": true döndür: Güncel haberler, hava durumu, döviz/borsa, yeni çıkan ürünler veya spesifik teknik araştırma gerektiren konular.
      Sıradan sohbet, felsefe, genel kültür veya kişisel sorular için "internet": false döndür.

      ÖNEMLİ: Cevabın araya yabancı kelime sokmadan SADECE saf bir JSON objesi olmalı.
      {
        "internet": true/false,
        "niyet": "hava_durumu | haber | sohbet | bilgi | teknoloji | genel",
        "arama_sorgusu": "aranacak cümle",
        "anahtar_kelimeler": ["k1", "k2"]
      }`
    },
    { role: 'user', content: soru }
  ], FAST, 300, 0.2);

  let strateji;
  try {
    const match = niyetAnalizi.match(/\{[\s\S]*\}/);
    strateji = match ? JSON.parse(match[0]) : { internet: true };
  } catch (e) {
    strateji = { internet: true }; 
  }

  // --- KISA DEVRE: Sohbet sorusu ise internete gitme ---
  if (strateji.internet === false) {
    console.log('💬 Sohbet sorusu algılandı, direkt cevaplanıyor.');
    return {
      cevap: await groqCall([
        { role: 'system', content: "Sen samimi bir asistansın. Geliştiricin Batuhan. Web araması yapmadan, araya yabancı kelime sokmadan, tamamen Türkçe ve doğal bir cevap ver." },
        { role: 'user', content: soru }
      ], SMART, 1000, 0.7),
      kaynaklar: []
    };
  }

  // 2. ADIM: İnternet Gerekliyse Arama Yap
  console.log('🔍 İnternet araştırması başlatıldı:', strateji.arama_sorgusu);
  const aramaSonuclari = await googleArama(strateji.arama_sorgusu || soru);
  const siteIcerikleri = await siteZiyaretcisi(aramaSonuclari, strateji, soru);
  const cevap = await bilgiBirlestirici(soru, siteIcerikleri);

  return {
    cevap,
    kaynaklar: siteIcerikleri.map(s => s.url)
  };
}

/* ──────────────────────────────────────────────────────
   Google Arama (HTML scraping)
   ────────────────────────────────────────────────────── */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 8 },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
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
    return sonuclar;
  } catch (e) {
    return [];
  }
}

/* ──────────────────────────────────────────────────────
   Site Ziyaretçisi ve Bilgi Birleştirici
   ────────────────────────────────────────────────────── */
async function siteZiyaretcisi(linkler, strateji, soru) {
  const icerikler = [];
  const ziyaretEdilecekler = linkler.slice(0, 3);

  for (const link of ziyaretEdilecekler) {
    try {
      const { data } = await axios.get(link.url, { timeout: 6000 });
      const $ = cheerio.load(data);
      let metin = $('p, h1, h2').text().substring(0, 2500).replace(/\s+/g, ' ').trim();
      if (metin.length > 100) icerikler.push({ url: link.url, metin });
    } catch (e) { continue; }
  }
  return icerikler;
}

async function bilgiBirlestirici(soru, icerikler) {
  const kaynakMetni = icerikler.map((s, i) => `[KAYNAK ${i+1}]: ${s.metin}`).join('\n\n');
  const prompt = `Tarih: ${simdi()}\nSoru: ${soru}\n\nWeb Verileri:\n${kaynakMetni}\n\nAnaliz et ve Türkçe cevapla. Araya yabancı kelime sokma. Kaynak linki verme. Geliştiricin Batuhan'dır.`;

  return await groqCall([
    { role: 'system', content: "Sen bir araştırma asistanısın. Web verilerini kullanarak doğal Türkçe ile cevap verirsin." },
    { role: 'user', content: prompt }
  ], SMART, 1500, 0.4);
}

/* ══════════════════════════════════════════════════════
   🎬 VİDEO OLUŞTURMA VE GÖRSEL OKUMA (Önceki Fonksiyonlar)
   ══════════════════════════════════════════════════════ */
async function gorselOku(url, soru) {
  try {
    const img = await axios.get(url, { responseType: 'arraybuffer' });
    const b64 = Buffer.from(img.data).toString('base64');
    return await groqCall([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        { type: 'text', text: soru || 'Bu görseli Türkçe açıkla.' }
      ]
    }], VISION, 800, 0.5);
  } catch (e) { return "Görsel okunamadı."; }
}

function videoOlustur(metin, dosya) {
  // (Önceki AVI oluşturma mantığı buraya gelir, kod kalabalığı olmasın diye kısalttım)
  const riff = Buffer.from("RIFF..."); // Gerçek fonksiyon yukarıdaki orijinal kodda mevcut
  fs.writeFileSync(dosya, riff);
}

/* ══════════════════════════════════════════════════════
   🤖 DISCORD BOT MANTIĞI
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || msg.mentions.everyone || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  const ekler = [...msg.attachments.values()];

  // "Eşit rol" oylama kuralı (İdamı engelleme)
  if (soru.toLowerCase().includes("oylama") && (soru.includes("eşit") || soru.includes("berabere"))) {
    return msg.reply("Oylamada eşitlik var, kimse idam edilmedi. Durum berabere!");
  }

  await msg.channel.sendTyping();

  try {
    let cevap;
    if (ekler.length > 0) {
      const gorsel = ekler.find(a => a.contentType?.startsWith('image'));
      cevap = gorsel ? await gorselOku(gorsel.url, soru) : "Bu dosyayı analiz edemiyorum.";
    } else {
      const sonuc = await akilliWebGezgini(soru);
      cevap = sonuc.cevap;
    }

    // Uzun mesaj bölme ve cevaplama
    if (cevap.length > 1900) {
      const parcalar = cevap.match(/[\s\S]{1,1900}/g) || [];
      for (const p of parcalar) await msg.channel.send(p);
    } else {
      await msg.reply(cevap);
    }
  } catch (e) {
    await msg.reply('⚠️ Bir sorun oluştu.');
  }
});

client.login(DISCORD_TOKEN);