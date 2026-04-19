const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const cheerio = require('cheerio');

/* ── SERVER ── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG ──────────────────────────────────────────── */
const GROQ_KEY = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const SMART = 'llama-3.3-70b-versatile';
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';

const mem = new Map(); // Kullanıcı hafızası

/* ══════════════════════════════════════════════════════
   GROQ API ÇAĞRISI
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
    console.error("Groq Hatası:", e.response?.data || e.message);
    return "API hatası oluştu.";
  }
}

/* ══════════════════════════════════════════════════════
   GOOGLE ARAMA (GELİŞMİŞ SCRAPER)
   ══════════════════════════════════════════════════════ */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr' },
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const sonuclar = [];

    // Modern Google yapısı için seçiciler
    $('div.g').each((i, elem) => {
      const link = $(elem).find('a').attr('href');
      const baslik = $(elem).find('h3').text().trim();
      if (link && link.startsWith('http') && baslik) {
        sonuclar.push({ url: link, baslik });
      }
    });

    return sonuclar.slice(0, 5);
  } catch (e) {
    console.error("Arama Hatası:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════
   SİTE İÇERİK OKUYUCU VE BİRLEŞTİRİCİ
   ══════════════════════════════════════════════════════ */
async function bilgiBirlestirici(soru, linkler) {
  let derlenmişMetin = "";
  
  for (const link of linkler.slice(0, 3)) {
    try {
      const { data } = await axios.get(link.url, { timeout: 5000 });
      const $ = cheerio.load(data);
      const metin = $('p').text().substring(0, 1000).replace(/\s+/g, ' ').trim();
      if (metin.length > 50) derlenmişMetin += `\nKaynak (${link.url}): ${metin}\n`;
    } catch (e) { continue; }
  }

  if (!derlenmişMetin) return null;

  const prompt = `Soru: ${soru}\n\nİnternetten Bulunan Bilgiler:\n${derlenmişMetin}\n\nBu bilgileri kullanarak doğal bir Türkçe ile cevap ver. Geliştiricin Batuhan. Araya yabancı kelime sokma.`;
  return await groqCall([{ role: 'user', content: prompt }]);
}

/* ══════════════════════════════════════════════════════
   ANA AKILLI MANTIK
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId) {
  // 1. ADIM: Niyet Analizi (70B)
  const niyet = await groqCall([
    {
      role: 'system',
      content: 'Kullanıcı mesajını analiz et. Sadece güncel haber, hava durumu, döviz veya bilmediğin çok spesifik teknik konular için "ARAMA" yaz. Selamlaşma, sohbet, fikir sorma veya genel kültür için "SOHBET" yaz. Tek kelime cevap ver.'
    },
    { role: 'user', content: soru }
  ], SMART, 10, 0.1);

  console.log(`Karar: ${niyet} | Soru: ${soru}`);

  // 2. ADIM: Sohbet ise Hafıza ile Yanıtla
  if (!niyet.toUpperCase().includes('ARAMA')) {
    if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
    const gecmis = mem.get(kullaniciId);
    gecmis.push({ role: 'user', content: soru });
    if (gecmis.length > 10) gecmis.shift();

    const cevap = await groqCall([
      { role: 'system', content: 'Sen samimi bir asistansın. Geliştiricin Batuhan. Türkçe ve doğal konuş, yabancı kelime kullanma.' },
      ...gecmis
    ]);

    gecmis.push({ role: 'assistant', content: cevap });
    return cevap;
  }

  // 3. ADIM: Arama ise İnternete Git
  const sonuclar = await googleArama(soru);
  if (sonuclar.length === 0) {
    // Arama başarısızsa sohbet moduna düş (hata vermek yerine kendi bilgini kullan)
    return await groqCall([{ role: 'system', content: 'İnternette sonuç bulamadın, kendi genel bilginle cevap ver.' }, { role: 'user', content: soru }]);
  }

  const sentezCevap = await bilgiBirlestirici(soru, sonuclar);
  return sentezCevap || "Bilgi derlenirken bir sorun oluştu.";
}

/* ══════════════════════════════════════════════════════
   DISCORD EVENTLERİ
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!soru) return msg.reply("Efendim?");

  // Özel Kural: Oylama
  if (soru.toLowerCase().includes("oylama") && (soru.includes("eşit") || soru.includes("berabere"))) {
    return msg.reply("Oylama berabere bitti, kimse idam edilmedi!");
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
    msg.reply("Şu an yanıt veremiyorum, sistemde bir aksaklık var.");
  }
});

client.login(DISCORD_TOKEN);