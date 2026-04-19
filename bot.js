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
const GROQ_KEY = process.env.gro;
const DISCORD_TOKEN = process.env.toke;
const FAST = 'llama-3.1-8b-instant'; // Kullanılmasa da tanımlı kalabilir
const SMART = 'llama-3.3-70b-versatile'; // Artık her yerde bu kullanılacak
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';
const TMP = '/tmp/bb';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

/* ── HAFIZA ──────────────────────────────────────────── */
const mem = new Map();

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

async function niyetAnaliziYap(soru) {
  // 70B modeli ile kesin niyet analizi (JSON yerine tek kelime)
  const analiz = await groqCall([
    {
      role: 'system',
      content: `Sen bir niyet okuyucusun. Kullanıcının mesajını incele.
Eğer mesaj güncel bilgi (hava durumu, borsa, güncel haber, fiyatlar) veya spesifik teknik araştırma gerektiriyorsa SADECE "ARAMA" yaz.
Eğer mesaj sıradan bir sohbet, selamlaşma, hal hatır sorma, felsefe veya genel kültür ise SADECE "SOHBET" yaz.
Cevabında başka hiçbir kelime veya noktalama işareti kullanma.`
    },
    { role: 'user', content: soru }
  ], SMART, 15, 0.1); 

  console.log(`🤖 Niyet Analizi Sonucu: ${analiz}`);
  return analiz.toUpperCase().includes('ARAMA');
}

async function akilliWebGezgini(soru, kullaniciId) {
  const internetGerekliMi = await niyetAnaliziYap(soru);

  // --- KISA DEVRE: Sohbet sorusu ise internete gitme ---
  if (!internetGerekliMi) {
    console.log('💬 Sohbet algılandı, direkt cevaplanıyor.');
    
    // Hafıza (Memory) Yönetimi
    if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
    const gecmis = mem.get(kullaniciId);
    
    // Yeni soruyu hafızaya ekle
    gecmis.push({ role: 'user', content: soru });
    if (gecmis.length > 10) gecmis.shift(); // Son 10 mesajı hatırla

    const mesajlar = [
      { role: 'system', content: "Sen samimi, eğlenceli ve doğal bir asistansın. Geliştiricin Batuhan. Web araması yapmadan, araya yabancı kelime sokmadan, tamamen Türkçe cevap ver. Robot gibi değil, bir dost gibi konuş." },
      ...gecmis
    ];

    // 70B modeli ile sohbete cevap ver
    const cevap = await groqCall(mesajlar, SMART, 1000, 0.7);
    
    // Botun cevabını da hafızaya ekle
    gecmis.push({ role: 'assistant', content: cevap });
    mem.set(kullaniciId, gecmis);

    return { cevap, kaynaklar: [] };
  }

  // --- İNTERNET ARAMASI GEREKİYORSA ---
  console.log('🔍 İnternet araştırması başlatıldı:', soru);
  const aramaSonuclari = await googleArama(soru);
  
  if (!aramaSonuclari || aramaSonuclari.length === 0) {
    return { cevap: "İnternette araştırdım ancak bu konuyla ilgili güncel bir veri bulamadım.", kaynaklar: [] };
  }

  const siteIcerikleri = await siteZiyaretcisi(aramaSonuclari, {}, soru);
  const cevap = await bilgiBirlestirici(soru, siteIcerikleri);

  return { cevap, kaynaklar: siteIcerikleri.map(s => s.url) };
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

  // 70B modeli ile bilgileri birleştirip cevaplama
  return await groqCall([
    { role: 'system', content: "Sen bir araştırma asistanısın. Web verilerini kullanarak doğal Türkçe ile cevap verirsin." },
    { role: 'user', content: prompt }
  ], SMART, 1500, 0.4);
}

/* ══════════════════════════════════════════════════════
   🎬 VİDEO OLUŞTURMA VE GÖRSEL OKUMA 
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
  const riff = Buffer.from("RIFF..."); 
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

  // "Eşit rol" oylama kuralı
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
      // Kullanıcı ID'sini göndererek hafızayı çalıştır
      const sonuc = await akilliWebGezgini(soru, msg.author.id);
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
    console.error(e);
    await msg.reply('⚠️ Bir sorun oluştu.');
  }
});

client.login(DISCORD_TOKEN);