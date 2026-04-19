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
const FAST = 'llama-3.3-7b-versatile';
const SMART = 'llama-3.3-70b-versatile';
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';
const TMP = '/tmp/bb';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

/* ── HAFIZA ──────────────────────────────────────────── */
const mem = new Map();
const MAX = 20;

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
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    console.error("Groq Hatası:", e.message);
    return "Şu an teknik bir sorun yaşıyorum.";
  }
}

/* ══════════════════════════════════════════════════════
   🧠 KESİN KARAR MEKANİZMASI (Sohbet vs Araştırma)
   ══════════════════════════════════════════════════════ */

async function akilliCevapSistemi(soru, gecmis = []) {
  // 1. ADIM: Muhakeme Odaklı Analiz
  const analizSistemi = `Şu anki tarih: ${simdi()}. 
  Görevin: Kullanıcının sorusunun İNTERNETTE ARANMASI GEREKİP GEREKMEDİĞİNE karar vermek.
  
  KRİTERLER:
  - Eğer soru "Naber, nasılsın, kimsin, bana fıkra anlat, felsefe yapalım, günaydın" gibi kişisel, duygusal veya genel bilgiye dayalıysa -> karar: "SOHBET"
  - Eğer soru "Bugün hava nasıl, [İsim] kimdir (yeni biri), dün ne oldu, dolar kaç TL, şu anki haberler" gibi güncel veri gerektiriyorsa -> karar: "ARAMA"

  SADECE JSON DÖNDÜR:
  {
    "karar": "SOHBET" veya "ARAMA",
    "arama_terimi": "Google için kısa sorgu (arama değilse boş bırak)",
    "neden": "Kısa açıklama"
  }`;

  const analizResponse = await groqCall([
    { role: 'system', content: analizSistemi },
    { role: 'user', content: `Soru: "${soru}"` }
  ], FAST, 300, 0.1); // 0.1 sıcaklık kararlılık sağlar

  let analiz;
  try {
    const jsonMatch = analizResponse.match(/\{[\s\S]*\}/);
    analiz = jsonMatch ? JSON.parse(jsonMatch[0]) : { karar: "SOHBET" };
  } catch (e) {
    analiz = { karar: "SOHBET" };
  }

  // --- DURUM 1: SOHBET (İnternet Yok) ---
  if (analiz.karar === "SOHBET") {
    console.log(`💬 Sohbet Kararı: ${analiz.neden}`);
    return {
      cevap: await groqCall([
        { role: 'system', content: "Sen samimi bir asistansın. Geliştiricin Batuhan. Web araması yapmadan, kendi bilgilerinle samimi, doğal ve yabancı kelime kullanmadan cevap ver." },
        ...gecmis.slice(-5), // Son 5 mesajı hatırlasın
        { role: 'user', content: soru }
      ], SMART, 1000, 0.7),
      kaynaklar: []
    };
  }

  // --- DURUM 2: ARAŞTIRMA (İnternet Var) ---
  console.log(`🔍 Araştırma Kararı: ${analiz.arama_terimi} | Neden: ${analiz.neden}`);
  const sonuclar = await googleArama(analiz.arama_terimi || soru);
  const icerikler = await siteZiyaretcisi(sonuclar);
  
  if (icerikler.length === 0) {
    return { cevap: "Üzgünüm, internette bu konuda güncel bir bilgi bulamadım.", kaynaklar: [] };
  }

  const veriMetni = icerikler.map((s, i) => `[SİTE ${i+1}]: ${s.metin}`).join('\n\n');
  const finalPrompt = `Şu anki tarih: ${simdi()}.
  İnternetten gelen verileri analiz ederek soruyu cevapla.
  
  KURAL:
  1. Türkçe konuş, yabancı kelime sokma.
  2. Kaynak linki veya URL verme.
  3. Geliştiricin Batuhan'dır.
  
  Veriler: ${veriMetni}
  Soru: ${soru}`;

  return {
    cevap: await groqCall([{ role: 'user', content: finalPrompt }], SMART, 1500, 0.3),
    kaynaklar: icerikler.map(s => s.url)
  };
}

/* ──────────────────────────────────────────────────────
   GOOGLE & SCRAPING
   ────────────────────────────────────────────────────── */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    const $ = cheerio.load(data);
    const linkler = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href?.startsWith('/url?q=')) {
        const u = href.replace('/url?q=', '').split('&')[0];
        if (u.startsWith('http') && !u.includes('google.com')) linkler.push(u);
      }
    });
    return [...new Set(linkler)].slice(0, 3);
  } catch { return []; }
}

async function siteZiyaretcisi(linkler) {
  const sonuclar = [];
  for (const url of linkler) {
    try {
      const { data } = await axios.get(url, { timeout: 5000 });
      const $ = cheerio.load(data);
      $('script, style, nav, footer').remove();
      const metin = $('body').text().substring(0, 1500).replace(/\s+/g, ' ').trim();
      if (metin.length > 100) sonuclar.push({ url, metin });
    } catch { continue; }
  }
  return sonuclar;
}

/* ══════════════════════════════════════════════════════
   🤖 DISCORD BOT
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || msg.mentions.everyone || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!soru) return;

  // Eşitlik kuralı
  if (soru.toLowerCase().includes("eşit") && soru.includes("oylama")) {
    return msg.reply("Beraberlik! Kimse zarar görmedi.");
  }

  await msg.channel.sendTyping();

  if (!mem.has(msg.channel.id)) mem.set(msg.channel.id, []);
  const gecmis = mem.get(msg.channel.id);

  try {
    const sonuc = await akilliCevapSistemi(soru, gecmis);
    
    gecmis.push({ role: 'user', content: soru }, { role: 'assistant', content: sonuc.cevap });
    if (gecmis.length > MAX) gecmis.splice(0, 2);

    if (sonuc.cevap.length > 1900) {
      const parts = sonuc.cevap.match(/[\s\S]{1,1900}/g) || [];
      for (const p of parts) await msg.channel.send(p);
    } else {
      await msg.reply(sonuc.cevap);
    }
  } catch (e) {
    msg.reply("Şu an meşgulüm, sonra dener misin?");
  }
});

client.login(DISCORD_TOKEN);