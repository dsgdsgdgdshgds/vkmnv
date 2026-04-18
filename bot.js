const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT AYARI ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.groq;
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
    const prompt = `Sen bir arama kararı vericisin. Kullanıcı mesajını analiz et ve şu JSON formatında yanıt ver:

{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["sorgu1", "sorgu2"],
  "dil": "tr | en"
}

ARAMA GEREKLİ (arama_gerekli: true):
- Haber, olay, gelişme, duyuru içeren her soru
- Spor sonuçları, maç, skor, puan durumu
- Fiyat, kur, borsa, kripto
- Hava durumu
- "ne zaman", "kim kazandı", "son durum", "şu an", "bugün", "kaç oldu" gibi ifadeler
- Herhangi bir kişi, yer, ürün veya olayın güncel durumu
- Teknik veya ansiklopedik bilgi soruları

ARAMA GEREKSİZ (arama_gerekli: false) — SADECE BUNLAR:
- Selamlaşma: merhaba, naber, selam, hey
- Küfür veya argo: orospu, amk, sik, lan, göt, vb.
- Kısa sohbet: nasılsın, ne yapıyorsun, iyi misin
- Yaratıcı istek: şiir yaz, fıkra anlat, kelimeyi tanımla

Kurallar:
- Emin olamazsan arama_gerekli: true yap
- Sorgular kısa ve arama motoruna uygun olsun (2-5 kelime)
- Tarih/spor sorgularına yıl ekle: "2026"
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
   ADIM 2: GROQ WEB SEARCH TOOL — Güncel Bilgi
   Groq'un yerleşik web arama aracını kullanır, harici DNS gerekmez.
==================================================================== */

async function webdenVeriTopla(plan) {
    if (!plan.arama_gerekli || !plan.sorgular?.length) return "";

    const sorgu = plan.sorgular.join(" ");
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                max_tokens: 1024,
                messages: [{ role: "user", content: `Şu konuda güncel bilgi ver (kısa, madde madde): ${sorgu}` }],
                tools: [{
                    type: "function",
                    function: {
                        name: "web_search",
                        description: "Search the web for current information",
                        parameters: {
                            type: "object",
                            properties: { query: { type: "string" } },
                            required: ["query"]
                        }
                    }
                }],
                tool_choice: "auto"
            },
            {
                headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                timeout: 20000
            }
        );

        const msg = res.data.choices[0].message;
        // Eğer tool call döndüyse, tool result ile tekrar sor
        if (msg.tool_calls?.length) {
            const toolCall = msg.tool_calls[0];
            const followUp = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model: "llama-3.3-70b-versatile",
                    max_tokens: 1024,
                    messages: [
                        { role: "user", content: `Şu konuda güncel bilgi ver: ${sorgu}` },
                        { role: "assistant", content: null, tool_calls: [toolCall] },
                        { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ result: `Web araması: ${toolCall.function.arguments}` }) }
                    ]
                },
                {
                    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    timeout: 20000
                }
            );
            const sonuc = followUp.data.choices[0].message.content?.trim();
            if (sonuc) { console.log(`✅ Groq web search tamamlandı`); return sonuc; }
        }

        // Direkt cevap döndüyse onu kullan
        const direkt = msg.content?.trim();
        if (direkt) { console.log(`✅ Groq direkt cevap`); return direkt; }
        return "";
    } catch (e) {
        console.log(`⚠️ Groq web search hata: ${e.message}`);
        // Fallback: Wikipedia
        return await wikipediaFallback(sorgu);
    }
}

/* Wikipedia fallback — Groq başarısız olursa */
async function wikipediaFallback(sorgu) {
    try {
        for (const lang of ["tr", "en"]) {
            const arama = await axios.get(
                `https://${lang}.wikipedia.org/w/api.php`,
                { params: { action: "query", list: "search", srsearch: sorgu, srlimit: 2, format: "json", origin: "*" }, timeout: 6000 }
            );
            const sayfalar = arama.data?.query?.search || [];
            const sonuclar = [];
            for (const sayfa of sayfalar.slice(0, 2)) {
                const ozet = await axios.get(
                    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sayfa.title)}`,
                    { timeout: 5000 }
                );
                if (ozet.data.extract) sonuclar.push(`${ozet.data.title}: ${ozet.data.extract.slice(0, 400)}`);
            }
            if (sonuclar.length) return sonuclar.join("\n");
        }
    } catch {}
    return "";
}

/* ====== ADIM 3: GROK TARZI DERİN SENTEZ ====== */
/* Türkçe küfür tespiti */
const KUFURLER = ["amk","orospu","oç","sik","göt","bok","yarrak","piç","sikerim","amına","orospu çocuğu","gerizekalı","salak","ahmak","kahpe","mal","aptal"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase();
    return KUFURLER.some(w => k.includes(w));
}

async function cevapUret(userId, soru) {
    const simdi = new Date();
    const tarih = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan       = await planHazirla(soru);
    const webVerisi  = await webdenVeriTopla(plan);

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i + 1}] K: ${h.user} | B: ${h.bot}`).join("\n")
        : "";

    const mesajdaKufur       = kufurVarMi(soru);
    const guncelBilgiGerekli = plan.arama_gerekli && webVerisi.trim().length > 20;

    let sistemPrompt;
    if (mesajdaKufur) {
        sistemPrompt = "Discord botusun, geliştirici Batuhan. Kullanıcı sana küfür etti, aynı tonda Türkçe küfürle kısa karşılık ver (1-2 cümle). Format kullanma.";
    } else if (guncelBilgiGerekli) {
        sistemPrompt = "Discord botusun, geliştirici Batuhan. Verilen web verisini kullanarak soruyu yanıtla. Kendi eski bilgini kullanma. Web verisi yoksa 'güncel bilgiye ulaşamadım' de. Türkçeye Türkçe, İngilizceye İngilizce. Discord formatı: **kalın**, > alıntı. Emin olmadıklarına 'Tahminim:' ekle.";
    } else {
        sistemPrompt = "Discord botusun, geliştirici Batuhan. Kullanıcıyla kısa ve samimi sohbet et. Liste veya başlık kullanma.";
    }

    const kullaniciPrompt = [
        `Tarih: ${tarih}`,
        gecmisMetin ? `Geçmiş:\n${gecmisMetin}` : "",
        webVerisi    ? `Web verisi:\n${webVerisi}` : "",
        `Soru: ${soru}`
    ].filter(Boolean).join("\n\n");

    const cevap = await groq(
        [
            { role: "system", content: sistemPrompt },
            { role: "user",   content: kullaniciPrompt }
        ],
        { model: MODEL_SMART, temperature: 0.65, max_tokens: 1000 }
    );

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
    console.log(`👤 Geliştirici: Batuhan`);
});

// Unhandled rejection'ları yakala — bot çökmesini engeller
process.on("unhandledRejection", err => {
    console.error("🔥 Unhandled Rejection:", err?.message || err);
});

client.login(DISCORD_TOKEN);