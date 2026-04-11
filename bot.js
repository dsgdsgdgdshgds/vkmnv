const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = requre('http');

/* ====== RENDER PORT AYARI ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.api;
const DISCORD_TOKEN  = process.env.token;
// Serper kaldırıldı — DuckDuckGo kullanılıyor (API key gerekmez)

/* ====== MODELLER ====== */
const MODEL_FAST   = "llama-3.1-8b-instant";       // hızlı planlama
const MODEL_SMART  = "llama-3.3-70b-versatile";    // derin sentez

/* ====== HAFIZA (userId → mesaj dizisi) ====== */
const memory = new Map();
const MAX_HISTORY = 5; // kaç konuşma hatırlasın

/* ====== GROQ YARDIMCI FONKSİYON ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.6, max_tokens = 1500 } = {}) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature, max_tokens },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    return res.data.choices[0].message.content.trim();
}

/* ====== ADIM 1: SORU ANALİZİ & ARAMA PLANI ====== */
// Bu adım Grok'un "düşünme" modunu simüle eder.
// Sorunun türünü (güncel haber / bilgi / hesaplama / genel) tespit edip
// Serper için optimize arama sorguları üretir.
async function planHazirla(soru) {
    const prompt = `Sen bir araştırma planlayıcısısın. Kullanıcı sorusunu analiz et ve şu JSON formatında yanıt ver:

{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["sorgu1", "sorgu2", "sorgu3"],
  "dil": "tr | en"
}

Kurallar:
- "guncel_haber" → son 24-48 saatteki olaylar, canlı skorlar, haberler
- "bilgi_sorgusu" → ansiklopedik, teknik, istatistiksel sorular
- "hesaplama" → matematik, tarih hesabı, karşılaştırma
- "genel_sohbet" → selamlaşma, fikir sorma, yaratıcı içerik → arama_gerekli: false
- Sorgular Türkçe soruysa Türkçe, İngilizce soruysa İngilizce olsun
- Tarih/spor sorularında yıl ekle (örn: "2026")
- Sadece JSON döndür, başka hiçbir şey yazma.

SORU: ${soru}`;

    try {
        const raw = await groq(
            [{ role: "user", content: prompt }],
            { model: MODEL_FAST, temperature: 0.1, max_tokens: 300 }
        );
        // JSON parse
        const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0];
        return jsonStr ? JSON.parse(jsonStr) : { tip: "genel_sohbet", arama_gerekli: false, sorgular: [], dil: "tr" };
    } catch {
        return { tip: "genel_sohbet", arama_gerekli: true, sorgular: [soru], dil: "tr" };
    }
}

/* ====================================================================
   ADIM 2: ÇOK KAYNAKLI PARALEL ARAMA MOTORU (API KEY YOK)
   Kaynaklar:
     1. wttr.in        → hava durumu (anlık, güvenilir)
     2. Wikipedia API  → ansiklopedik bilgi (TR + EN)
     3. DDG Instant    → hızlı cevaplar, tanımlar
     4. DDG HTML       → genel organik sonuçlar (fallback)
   Hepsi paralel çalışır, timeout'a takılan kaynak diğerlerini bekletmez.
==================================================================== */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36";

/* --- KAYNAK 1: wttr.in — Hava Durumu --- */
async function kaynakHava(soru) {
    const kelimeler = ["hava", "sıcaklık", "yağmur", "kar", "fırtına", "weather", "temperature", "forecast", "derece", "nem", "rüzgar"];
    if (!kelimeler.some(k => soru.toLowerCase().includes(k))) return [];

    const temiz = soru.toLowerCase()
        .replace(/hava durumu|hava|sıcaklık|weather|temperature|forecast|bugün|yarın|şu an|nasıl|kaç/g, "")
        .replace(/[^\w\sğüşıöçĞÜŞİÖÇ]/g, "").trim();
    const sehir = temiz.split(/\s+/).find(k => k.length > 2) || "istanbul";

    try {
        const res = await axios.get(
            `https://wttr.in/${encodeURIComponent(sehir)}?format=j1`,
            { timeout: 7000, headers: { "User-Agent": "curl/7.0" } }
        );
        const g = res.data.current_condition?.[0];
        if (!g) return [];
        const durum = g.lang_tr?.[0]?.value || g.weatherDesc?.[0]?.value || "";
        return [`[HAVA DURUMU - ${sehir.toUpperCase()}]: ${g.temp_C}°C | Hissedilen: ${g.FeelsLikeC}°C | ${durum} | Nem: %${g.humidity} | Rüzgar: ${g.windspeedKmph} km/s`];
    } catch { return []; }
}

/* --- KAYNAK 2: Wikipedia API — Türkçe önce, İngilizce fallback --- */
async function kaynakWikipedia(sorgu) {
    const sonuclar = [];
    for (const lang of ["tr", "en"]) {
        try {
            const arama = await axios.get(
                `https://${lang}.wikipedia.org/w/api.php`,
                { params: { action: "query", list: "search", srsearch: sorgu, srlimit: 3, format: "json", origin: "*" }, timeout: 6000 }
            );
            const sayfalar = arama.data?.query?.search || [];
            for (const sayfa of sayfalar.slice(0, 2)) {
                const ozet = await axios.get(
                    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sayfa.title)}`,
                    { timeout: 5000 }
                );
                const d = ozet.data;
                if (d.extract) {
                    sonuclar.push(`[WİKİPEDİA${lang === "en" ? "-EN" : ""}]: ${d.title} — ${d.extract.slice(0, 400)}`);
                }
            }
            if (sonuclar.length >= 2) break; // TR yeterliyse EN'e geçme
        } catch { continue; }
    }
    return sonuclar;
}

/* --- KAYNAK 3: DuckDuckGo Instant Answer --- */
async function kaynakDDGInstant(sorgu) {
    try {
        const res = await axios.get(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(sorgu)}&format=json&no_html=1&skip_disambig=1`,
            { timeout: 6000, headers: { "User-Agent": UA } }
        );
        const d = res.data;
        const sonuclar = [];
        if (d.Answer)       sonuclar.push(`[ANLИК CEVAP]: ${d.Answer}`);
        if (d.AbstractText) sonuclar.push(`[ÖZET]: ${d.AbstractText.slice(0, 300)}`);
        if (d.Definition)   sonuclar.push(`[TANIM]: ${d.Definition}`);
        (d.RelatedTopics || []).slice(0, 3).forEach(t => {
            const m = t.Text || t.Result;
            if (m) sonuclar.push(`[İLGİLİ]: ${m.replace(/<[^>]+>/g, "").slice(0, 200)}`);
        });
        return sonuclar;
    } catch { return []; }
}

/* --- KAYNAK 4: DuckDuckGo HTML Scrape — Genel Fallback --- */
async function kaynakDDGHtml(sorgu) {
    try {
        const res = await axios.get(
            `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sorgu)}`,
            { timeout: 9000, headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" } }
        );
        const html = res.data;
        const titleRe   = /<a class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetRe = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        const titles   = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
        const snippets = [...html.matchAll(snippetRe)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
        const sonuclar = [];
        for (let i = 0; i < Math.min(5, titles.length); i++) {
            if (titles[i] || snippets[i])
                sonuclar.push(`[WEB ${i + 1}]: ${titles[i] || ""} — ${snippets[i] || ""}`);
        }
        return sonuclar;
    } catch (e) {
        console.log(`⚠️ DDG HTML hata:`, e.message);
        return [];
    }
}

/* --- ANA MOTOR: Tüm kaynakları paralel çalıştır --- */
async function webdenVeriTopla(plan) {
    if (!plan.arama_gerekli || !plan.sorgular?.length) return "";

    const anasorgu = plan.sorgular[0];

    // Tüm kaynaklar aynı anda başlar, birbirini beklemez
    const [hava, wiki, ddgInstant, ddgHtml] = await Promise.all([
        kaynakHava(anasorgu),
        kaynakWikipedia(anasorgu),
        kaynakDDGInstant(anasorgu),
        kaynakDDGHtml(anasorgu)
    ]);

    // Ek sorgular için sadece DDG Instant çalıştır (hız için)
    const ekSonuclar = [];
    for (const sorgu of plan.sorgular.slice(1, 3)) {
        const [inst, html] = await Promise.all([kaynakDDGInstant(sorgu), kaynakDDGHtml(sorgu)]);
        ekSonuclar.push(...inst, ...html);
    }

    // Öncelik sırası: hava > wiki > ddg instant > ddg html > ek sorgular
    const tumSonuclar = [...hava, ...wiki, ...ddgInstant, ...ddgHtml, ...ekSonuclar];
    const tekrarsiz = [...new Set(tumSonuclar)].filter(s => s && s.trim().length > 10);

    console.log(`✅ Arama tamamlandı: ${tekrarsiz.length} sonuç (hava:${hava.length} wiki:${wiki.length} ddg:${ddgInstant.length + ddgHtml.length})`);
    return tekrarsiz.slice(0, 25).join("\n").trim();
}

/* ====== ADIM 3: GROK TARZI DERİN SENTEZ ====== */
async function cevapUret(userId, soru) {
    const simdi = new Date();
    const tarih = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    // Plan al
    const plan = await planHazirla(soru);

    // Web verisi topla
    const webVerisi = await webdenVeriTopla(plan);

    // Kullanıcı hafızası
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i + 1}] Kullanıcı: ${h.user}\n    Bot: ${h.bot}`).join("\n")
        : "Henüz geçmiş yok.";

    // Sistem promptu - Grok ruhu
    const sistemPrompt = `Sen Grok benzeri, son derece zeki, özgüvenli ve meraklı bir yapay zekasın. Adın yok, Discord'da çalışıyorsun.

KİŞİLİĞİN:
- Doğrudan, net ve özgüvenli konuş. Gereksiz "Üzgünüm, ancak..." gibi ifadelerden kaçın.
- Karmaşık konuları bile basit ve anlaşılır anlat.
- Güncel veri varsa onu kullan, yoksa bilgini kullan ama bunu belirt.
- Türkçe sorulara Türkçe, İngilizce sorulara İngilizce cevap ver.
- Discord formatı kullan: **kalın**, \`kod\`, > alıntı.
- Uzun cevaplarda başlık ve madde kullan ama gereksiz doldurmaktan kaçın.
- Emin olmadığın şeyleri "Tahminim:" diye başlat.

KURAL:
- Eğer web verisi varsa onu öncelikle kullan.
- Tarih/zaman sorularında GÜNCEL TARİH bilgisini baz al.
- Hesaplama gerektiriyorsa adım adım yap ve sonucu belirt.`;

    const kullaniciPrompt = `📅 ŞU ANKİ TARİH/SAAT: ${tarih}

📚 KONUŞMA GEÇMİŞİ:
${gecmisMetin}

🌐 WEB'DEN TOPLANAN VERİ (${plan.tip}):
${webVerisi || "Arama yapılmadı veya sonuç bulunamadı."}

❓ KULLANICI SORUSU: ${soru}

Cevabını ver:`;

    const cevap = await groq(
        [
            { role: "system", content: sistemPrompt },
            { role: "user", content: kullaniciPrompt }
        ],
        { model: MODEL_SMART, temperature: 0.65, max_tokens: 1500 }
    );

    // Hafızayı güncelle
    const yeniGecmis = [...gecmis, { user: soru, bot: cevap }];
    if (yeniGecmis.length > MAX_HISTORY) yeniGecmis.shift();
    memory.set(userId, yeniGecmis);

    return cevap;
}

/* ====== DISCORD MESAJ BÖLÜCÜ ====== */
function mesajlariBol(metin, limit = 1950) {
    if (metin.length <= limit) return [metin];
    const parcalar = [];
    let kalan = metin;
    while (kalan.length > 0) {
        let kes = limit;
        const sonParagraf = kalan.lastIndexOf('\n\n', limit);
        if (sonParagraf > limit * 0.6) kes = sonParagraf;
        else {
            const sonSatir = kalan.lastIndexOf('\n', limit);
            if (sonSatir > limit * 0.6) kes = sonSatir;
        }
        parcalar.push(kalan.slice(0, kes).trim());
        kalan = kalan.slice(kes).trim();
    }
    return parcalar;
}

/* ====== GÜVENLİ MESAJ GÖNDERME ====== */
// reply başarısız olursa channel.send'e, o da başarısız olursa sadece loglar.
async function guvenliGonder(msg, metin, ilk = true) {
    try {
        if (ilk) {
            await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        } else {
            await msg.channel.send(metin);
        }
    } catch (err) {
        if (err.code === 50013) {
            // İzin yoksa DM ile dene
            console.warn(`⚠️ Kanal izni yok (${msg.channel.id}), DM deneniyor...`);
            try {
                await msg.author.send(`(${msg.guild?.name || "Sunucu"} kanalında mesaj iznim yok, DM atıyorum)\n\n${metin}`);
            } catch {
                console.error("❌ DM de gönderilemedi. Bot'a 'Send Messages' ve 'Read Message History' izni ver.");
            }
        } else {
            console.error("❌ Mesaj gönderilemedi:", err.message);
        }
    }
}

/* ====== DISCORD İSTEMCİSİ ====== */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    // @everyone veya @here etiketlerini yoksay
    if (msg.mentions.everyone) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) {
        return guvenliGonder(msg, "Merhaba! Bana bir şey sormak ister misin? 🤖");
    }

    // Typing başlat (izin yoksa sessizce geç)
    msg.channel.sendTyping().catch(() => {});
    const typingInterval = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(typingInterval);

        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) {
            await guvenliGonder(msg, parcalar[i], i === 0);
        }
    } catch (err) {
        clearInterval(typingInterval);
        console.error("❌ Genel hata:", err.message);
        await guvenliGonder(msg, "⚠️ Bir sorun oluştu, lütfen tekrar dene.");
    }
});

// v14+ için clientReady kullan (ready deprecation uyarısını kapatır)
client.once("clientReady", c => {
    console.log(`✅ ${c.user.tag} aktif — Model: ${MODEL_SMART}`);
    console.log(`🕒 Başlangıç: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan Aktaş — Giresun/Bulancak KAFMTAL`);
});

// Unhandled rejection'ları yakala — bot çökmesini engeller
process.on("unhandledRejection", err => {
    console.error("🔥 Unhandled Rejection:", err?.message || err);
});

client.login(DISCON);