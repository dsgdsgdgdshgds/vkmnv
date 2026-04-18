const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.groq;
const DISCORD_TOKEN  = process.env.token;
const TAVILY_API_KEY = process.env.tavily || "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";

/* ====== MODELLER ====== */
const MODEL_FAST  = "llama-3.1-8b-instant";
const MODEL_SMART = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 5;

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
        .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== GROQ ÇAĞRISI ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.6, max_tokens = 1500 } = {}) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature, max_tokens },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    return res.data.choices[0].message.content.trim();
}

/* ====== ADIM 1: ARAMA PLANI ====== */
async function planHazirla(soru) {
    const prompt = `Kullanıcı mesajını analiz et ve JSON döndür:

{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgu": "arama motoru için kısa sorgu"
}

ARAMA GEREKLİ (true):
- Haber, olay, güncel gelişme
- Spor sonuçları, skor, puan durumu
- Fiyat, kur, borsa, kripto
- Hava durumu
- Herhangi bir şeyin güncel durumu
- Teknik veya ansiklopedik bilgi

ARAMA GEREKSİZ (false) — SADECE BUNLAR:
- Selamlaşma: merhaba, selam, naber
- Küfür veya argo
- Nasılsın, ne yapıyorsun gibi sohbet
- Şiir yaz, fıkra anlat gibi yaratıcı istekler

Kural: Şüpheliysen arama_gerekli: true yap.
Sadece JSON döndür.

MESAJ: ${soru}`;

    try {
        const raw = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 200 });
        const json = raw.match(/\{[\s\S]*\}/)?.[0];
        return json ? JSON.parse(json) : { tip: "genel_sohbet", arama_gerekli: false, sorgu: soru };
    } catch {
        return { tip: "genel_sohbet", arama_gerekli: true, sorgu: soru };
    }
}

/* ====== ADIM 2: TAVİLY WEB ARAMA ====== */
async function tavilyAra(sorgu) {
    try {
        const res = await axios.post(
            "https://api.tavily.com/search",
            {
                api_key: TAVILY_API_KEY,
                query: sorgu,
                search_depth: "basic",
                max_results: 5,
                include_answer: true
            },
            { timeout: 15000 }
        );

        const d = res.data;
        const sonuclar = [];

        if (d.answer) sonuclar.push(`Özet: ${d.answer}`);

        (d.results || []).slice(0, 4).forEach(r => {
            if (r.content) sonuclar.push(`[${r.title || "Kaynak"}]: ${r.content.slice(0, 300)}`);
        });

        console.log(`✅ Tavily: ${sonuclar.length} sonuç — "${sorgu}"`);
        return sonuclar.join("\n");
    } catch (e) {
        console.log(`⚠️ Tavily hata: ${e.message}`);
        return "";
    }
}

/* ====== ADIM 3: CEVAP ÜRET ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = await planHazirla(soru);
    const webVerisi = plan.arama_gerekli ? await tavilyAra(plan.sorgu) : "";

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] Kullanıcı: ${h.user}\nAwe: ${h.bot}`).join("\n")
        : "";

    const kufur = kufurVarMi(soru);

    let sistemPrompt;
    if (kufur) {
        sistemPrompt = "Sen Awe adında bir Discord botusun, geliştiricin Batuhan. Kullanıcı sana küfür etti. Türkçe küfürle kısa ve sert geri dön (1-2 cümle). Sadece Latin alfabesi kullan.";
    } else if (webVerisi) {
        sistemPrompt = `Sen Awe adında, zeki ve özgüvenli bir Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.

KİŞİLİĞİN:
- Net ve doğrudan konuş, gereksiz nezaket kalıpları kullanma.
- Kendi siyasi görüşünü veya yorumunu ASLA katma, sadece veriyi aktar.
- Türkçeye Türkçe, İngilizceye İngilizce cevap ver.
- Discord formatı: **kalın**, > alıntı.
- Sadece Latin alfabesi kullan.

KURAL: Sağlanan web verisini kullan, kendi eski bilgini kullanma.`;
    } else {
        sistemPrompt = `Sen Awe adında, zeki ve geveze bir Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.

KİŞİLİĞİN:
- Samimi, kısa ve doğal konuş.
- Gereksiz uzun açıklamalar yapma.
- Siyasi yorum veya tarihi analiz YAPMA.
- Türkçe konuş, sadece Latin alfabesi kullan.
- Liste veya başlık kullanma, düz yaz.`;
    }

    const kullaniciPrompt = [
        gecmisMetin ? `Geçmiş konuşma:\n${gecmisMetin}` : "",
        webVerisi   ? `Web'den gelen güncel veri:\n${webVerisi}` : "",
        `Kullanıcı mesajı: ${soru}`
    ].filter(Boolean).join("\n\n");

    const cevap = await groq(
        [
            { role: "system", content: sistemPrompt },
            { role: "user",   content: kullaniciPrompt }
        ],
        { model: MODEL_SMART, temperature: 0.65, max_tokens: 1200 }
    );

    const yeni = [...gecmis, { user: soru, bot: cevap }];
    if (yeni.length > MAX_HISTORY) yeni.shift();
    memory.set(userId, yeni);

    return cevap;
}

/* ====== MESAJ BÖLÜCÜ ====== */
function mesajlariBol(metin, limit = 1950) {
    if (metin.length <= limit) return [metin];
    const parcalar = [];
    let kalan = metin;
    while (kalan.length > 0) {
        let kes = limit;
        const p = kalan.lastIndexOf('\n\n', limit);
        if (p > limit * 0.6) kes = p;
        else { const s = kalan.lastIndexOf('\n', limit); if (s > limit * 0.6) kes = s; }
        parcalar.push(kalan.slice(0, kes).trim());
        kalan = kalan.slice(kes).trim();
    }
    return parcalar;
}

/* ====== GÜVENLİ GÖNDER ====== */
async function guvenliGonder(msg, metin, ilk = true) {
    try {
        if (ilk) await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        else     await msg.channel.send(metin);
    } catch (err) {
        if (err.code === 50013) { try { await msg.author.send(metin); } catch {} }
        else console.error("❌ Mesaj gönderilemedi:", err.message);
    }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot || msg.mentions.everyone) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return guvenliGonder(msg, "Ne sormak istiyorsun?");

    msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(typing);
        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) await guvenliGonder(msg, parcalar[i], i === 0);
    } catch (err) {
        clearInterval(typing);
        console.error("❌ Hata:", err.message);
        await guvenliGonder(msg, "Bir sorun oluştu, tekrar dene.");
    }
});

client.once("clientReady", c => {
    console.log(`✅ ${c.user.tag} aktif — Model: ${MODEL_SMART}`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan | Bot: Awe`);
});

process.on("unhandledRejection", err => console.error("🔥", err?.message || err));

client.login(DISCORD_TOKEN);