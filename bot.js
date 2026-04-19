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
    console.error("Groq Hatası:", e.message);
    return "Üzgünüm, şu an cevap veremiyorum.";
  }
}

/* ══════════════════════════════════════════════════════
   🧠 HİBRİT ZEKA: SOHBET Mİ? ARAŞTIRMA MI?
   ══════════════════════════════════════════════════════ */

async function akilliCevapSistemi(soru, gecmis = []) {
  // 1. ADIM: Niyet Analizi (Hızlı Model ile)
  // Modele çok sert bir talimat veriyoruz ki basit soruları internete taşımasın.
  const analiz = await groqCall([
    {
      role: 'system',
      content: `Görevin kullanıcının sorusunu 'sohbet' mi yoksa 'arama' mı olarak ayırmak.
      
      - SOHBET: Selamlaşma, nasılsın, şaka yap, felsefi sorular, genel tanımlar, tavsiye isteme, senin hakkında sorular.
      - ARAMA: Güncel haberler, bugünkü hava durumu/borsa, yeni çıkan bir ürün, dün olan bir maç, belirli bir tarihli olay.

      JSON FORMATINDA CEVAP VER:
      {
        "karar": "sohbet" veya "arama",
        "sebep": "neden bu karar verildi",
        "arama_terimi": "eğer arama ise Google'a yazılacak kısa öz cümle"
      }`
    },
    { role: 'user', content: soru }
  ], FAST, 200, 0.1);

  let kararVerici;
  try {
    const match = analiz.match(/\{[\s\S]*\}/);
    kararVerici = match ? JSON.parse(match[0]) : { karar: "sohbet" };
  } catch (e) {
    kararVerici = { karar: "sohbet" };
  }

  // --- DURUM A: SADECE SOHBET ---
  if (kararVerici.karar === "sohbet") {
    console.log("💬 Sadece sohbet ediliyor...");
    return {
      cevap: await groqCall([
        { role: 'system', content: "Sen samimi, zeki bir asistansın. Geliştiricin Batuhan. Web araması yapmadan, kendi bilgilerinle, Türkçe ve doğal bir şekilde cevap ver. Asla yabancı kelime karıştırma." },
        ...gecmis,
        { role: 'user', content: soru }
      ], SMART, 1000, 0.7),
      kaynaklar: []
    };
  }

  // --- DURUM B: GÜNCEL BİLGİ GEREKİYOR (İNTERNET) ---
  console.log("🔍 Güncel bilgi aranıyor:", kararVerici.arama_terimi);
  const aramaSonuclari = await googleArama(kararVerici.arama_terimi || soru);
  const siteIcerikleri = await siteZiyaretcisi(aramaSonuclari);
  
  const kaynakMetni = siteIcerikleri.map((s, i) => `[KAYNAK ${i+1}]: ${s.metin}`).join('\n\n');
  
  const finalCevap = await groqCall([
    { role: 'system', content: `Sen bir araştırma asistanısın. Şu anki tarih: ${simdi()}. Aşağıdaki internet verilerini kullanarak soruyu cevapla. Türkçe konuş, yabancı kelime kullanma, link verme. Geliştiricin Batuhan.` },
    { role: 'user', content: `Web Verileri:\n${kaynakMetni}\n\nSoru: ${soru}` }
  ], SMART, 1500, 0.3);

  return {
    cevap: finalCevap,
    kaynaklar: siteIcerikleri.map(s => s.url)
  };
}

/* ──────────────────────────────────────────────────────
   YARDIMCI FONKSİYONLAR (Arama & Tarama)
   ────────────────────────────────────────────────────── */

async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr' },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    });
    const $ = cheerio.load(data);
    const sonuclar = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href?.startsWith('/url?q=')) {
        const url = href.replace('/url?q=', '').split('&')[0];
        if (url.startsWith('http') && !url.includes('google.com')) {
          const baslik = $(el).find('h3').text().trim();
          if (baslik) sonuclar.push({ url, baslik });
        }
      }
    });
    return sonuclar.slice(0, 5);
  } catch (e) { return []; }
}

async function siteZiyaretcisi(linkler) {
  const sonuclar = [];
  for (const link of linkler.slice(0, 2)) { // Hız için ilk 2 site yeterli
    try {
      const { data } = await axios.get(link.url, { timeout: 5000 });
      const $ = cheerio.load(data);
      const metin = $('p').text().substring(0, 2000).replace(/\s+/g, ' ').trim();
      if (metin.length > 100) sonuclar.push({ url: link.url, metin });
    } catch (e) { continue; }
  }
  return sonuclar;
}

/* ══════════════════════════════════════════════════════
   🤖 DISCORD BOT BAŞLANGIÇ
   ══════════════════════════════════════════════════════ */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || msg.mentions.everyone || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!soru) return msg.reply("Seni dinliyorum?");

  // Özel Durum: Oylama Eşitliği
  if (soru.includes("eşit") && soru.includes("oylama")) {
    return msg.reply("Beraberlik var! Kimse idam edilmedi, herkes hayatta.");
  }

  await msg.channel.sendTyping();

  // Hafıza Yönetimi
  if (!mem.has(msg.channel.id)) mem.set(msg.channel.id, []);
  const gecmis = mem.get(msg.channel.id);

  try {
    const sonuc = await akilliCevapSistemi(soru, gecmis);
    
    // Hafızayı güncelle
    gecmis.push({ role: 'user', content: soru });
    gecmis.push({ role: 'assistant', content: sonuc.cevap });
    if (gecmis.length > MAX) gecmis.splice(0, 2);

    // Mesaj gönder (2000 karakter sınırı kontrolü)
    if (sonuc.cevap.length > 1900) {
      const parts = sonuc.cevap.match(/[\s\S]{1,1900}/g) || [];
      for (const p of parts) await msg.channel.send(p);
    } else {
      await msg.reply(sonuc.cevap);
    }

  } catch (err) {
    msg.reply("Şu an bağlantı kuramadım, tekrar dener misin?");
  }
});

client.login(DISCORD_TOKEN);