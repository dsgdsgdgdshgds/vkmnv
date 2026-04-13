const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT AYARI ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY  = process.env.groq;
const DISCORD_TOKEN = process.env.token;

/* ====== MODELLER ====== */
const MODEL_FAST  = "llama-3.1-8b-instant";   // Karar verme için hızlı model
const MODEL_SMART = "llama-3.3-70b-versatile"; // Cevap üretme için akıllı model

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 8;

/* ====== GROQ YARDIMCI ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.7, max_tokens = 1000 } = {}) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature, max_tokens },
        {
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            timeout: 30000,
        }
    );
    return res.data.choices[0].message.content.trim();
}

/* ======================================================
   ADIM 1 — LLM KARAR VERİCİ
   
   Claude'un çalışma mantığını taklit eder:
   Hızlı model mesajı okuyup JSON kararı döner:
   {
     "action": "chat" | "search" | "weather" | "insult",
     "query": "arama sorgusu (sadece search için)",
     "city": "şehir adı (sadece weather için)"
   }
   ====================================================== */
async function kararVer(soru, gecmisMetin) {
    const sistemPrompt = `Sen bir karar motorusun. Kullanıcının mesajını analiz edip ne yapılması gerektiğine karar veriyorsun.

SADECE şu JSON formatında yanıt ver, başka hiçbir şey yazma:
{"action":"...", "query":"...", "city":"..."}

ACTION seçenekleri:
- "chat"    → Normal sohbet, selamlama, şaka, kısa cevap yeterli
- "search"  → Güncel bilgi gerekiyor (haberler, maç sonuçları, fiyatlar, son gelişmeler, güncel olaylar, herhangi bir gerçek dünya sorusu)
- "weather" → Hava durumu sorusu
- "insult"  → Kullanıcı küfür veya hakaret etti

SEARCH ne zaman kullanılır:
- Spor: maç sonuçları, skor, puan durumu, transfer haberleri, son maç
- Haber: son dakika, gündem, olaylar, deprem, ekonomi
- Fiyat: dolar, euro, altın, bitcoin, borsa
- Gerçek kişiler veya olaylar hakkında güncel sorular
- "araştır", "bul", "ne oldu", "öğren" gibi komutlar
- Genel bilgi soruları (nedir, kimdir, nasıl çalışır) → SEARCH kullan, Wikipedia'dan alırız
- Şüphe durumunda: SEARCH seç

CHAT ne zaman kullanılır:
- Sadece selamlama, teşekkür, sohbet
- "nasılsın", "ne yapıyorsun" gibi kişisel sorular
- Bota yönelik sorular ("sen kimsin", "ne yapabilirsin")
- Tamamen subjektif/felsefi sorular

WEATHER:
- "hava durumu", "kaç derece", "yağmur var mı", "weather", "forecast" içeriyorsa
- city alanına şehir adını yaz (yoksa "Istanbul" yaz)

INSULT:
- Küfür veya ağır hakaret içeriyorsa

query: search için Google'a yazılacak Türkçe/İngilizce arama sorgusu. Spesifik ve güncel olsun.
city: weather için şehir adı (İngilizce veya orijinal adıyla)

Önceki konuşma bağlamı:
${gecmisMetin || "(yok)"}`;

    try {
        const yanit = await groq(
            [
                { role: "system", content: sistemPrompt },
                { role: "user",   content: soru }
            ],
            { model: MODEL_FAST, temperature: 0.1, max_tokens: 100 }
        );

        // JSON temizle
        const jsonMatch = yanit.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { action: "chat" };

        const karar = JSON.parse(jsonMatch[0]);
        console.log(`🤔 Karar: ${JSON.stringify(karar)} | Soru: "${soru}"`);
        return karar;

    } catch (e) {
        console.log(`⚠️ Karar hatası: ${e.message} — fallback: chat`);
        return { action: "chat" };
    }
}

/* ======================================================
/* ======================================================
   ADIM 2A -- WEB ARASTIRMA
   Groq'un built-in web search tool'u -- sadece GROQ_API_KEY yeterli
   ====================================================== */
async function webAra(sorgu) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "user",
                        content: sorgu
                    }
                ],
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "web_search",
                            description: "Search the web for current information",
                            parameters: {
                                type: "object",
                                properties: {
                                    query: { type: "string", description: "Search query" }
                                },
                                required: ["query"]
                            }
                        }
                    }
                ],
                tool_choice: "auto",
                max_tokens: 1000
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                },
                timeout: 20000,
            }
        );

        const msg = res.data.choices[0].message;
        if (msg.content) {
            console.log(`Groq web search: ${msg.content.length} karakter`);
            return msg.content;
        }
    } catch (e) {
        console.log(`Groq web search hatasi: ${e.message}`);
    }

    // Fallback: Groq'a direkt sor (training bilgisi)
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: "Sen bir arama motoru asistanisin. Kullanicinin sorusuna elimden gelen en guncel bilgiyle cevap ver. Bilmiyorsan acikca soyle."
                    },
                    {
                        role: "user",
                        content: sorgu
                    }
                ],
                max_tokens: 600,
                temperature: 0.3
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            }
        );
        const icerik = res.data.choices[0].message.content;
        console.log(`Groq fallback: ${icerik.length} karakter`);
        return icerik;
    } catch (e) {
        console.log(`Groq fallback hatasi: ${e.message}`);
    }

    return "";
}

async function getHavaDurumu(sehir) {
    try {
        const geoRes = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
            params: { name: sehir, count: 1, language: "tr", format: "json" },
            timeout: 6000,
        });

        if (!geoRes.data.results?.length) return null;
        const { latitude, longitude, name, country } = geoRes.data.results[0];

        const wRes = await axios.get("https://api.open-meteo.com/v1/forecast", {
            params: {
                latitude, longitude,
                current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                daily: "weather_code,temperature_2m_max,temperature_2m_min",
                timezone: "auto",
                forecast_days: 3
            },
            timeout: 6000,
        });

        const cur   = wRes.data.current;
        const daily = wRes.data.daily;

        const wCode = {
            0:"Açık ☀️", 1:"Az bulutlu 🌤️", 2:"Parçalı bulutlu ⛅", 3:"Kapalı ☁️",
            45:"Sisli 🌫️", 48:"Donmuş sis 🌫️",
            51:"Hafif çisenti 🌦️", 53:"Çisenti 🌧️", 55:"Yoğun çisenti 🌧️",
            61:"Hafif yağmur 🌧️", 63:"Yağmur 🌧️", 65:"Şiddetli yağmur 🌧️",
            71:"Hafif kar 🌨️", 73:"Kar 🌨️", 75:"Yoğun kar ❄️",
            80:"Sağanak 🌦️", 81:"Orta sağanak 🌧️", 82:"Şiddetli sağanak ⛈️",
            95:"Gök gürültülü ⛈️", 96:"Dolu ⛈️", 99:"Şiddetli dolu ⛈️"
        };

        return {
            sehir: name, ulke: country,
            sicaklik: Math.round(cur.temperature_2m),
            hissedilen: Math.round(cur.apparent_temperature),
            nem: cur.relative_humidity_2m,
            ruzgar: Math.round(cur.wind_speed_10m),
            durum: wCode[cur.weather_code] || "Bilinmiyor",
            gunluk: daily.temperature_2m_max.map((max, i) => ({
                max: Math.round(max),
                min: Math.round(daily.temperature_2m_min[i]),
                durum: wCode[daily.weather_code[i]] || "?"
            })).slice(0, 3)
        };
    } catch (e) {
        console.log(`⚠️ Hava durumu hatası: ${e.message}`);
        return null;
    }
}

/* ====== KÜFÜR TESPİTİ (sadece kaba küfürler) ====== */
const KUFURLER = ["amk","amina","orospu","sik","got","bok","yarrak","pic","sikerim",
    "orospu cocugu","kahpe","pezevenk","yavsak","serefsiz","amcik","gavat","siktir",
    "keko","zibidi","gerzek"];

function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ı/g,"i").replace(/ş/g,"s").replace(/ç/g,"c")
        .replace(/ğ/g,"g").replace(/ö/g,"o").replace(/ü/g,"u");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== DİL TEMİZLEME ====== */
function temizleDil(metin) {
    const yabanci = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0370-\u03ff\u0e00-\u0e7f\u0590-\u05ff]/g;
    const temiz = metin.replace(yabanci, '');
    return temiz.trim().length < 3 ? metin : temiz;
}

/* ======================================================
   ADIM 3 — CEVAP ÜRET
   Toplanan verileri kullanarak LLM'e cevap ürettir
   ====================================================== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    // Hafıza
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.slice(-4).map(h => `Kullanıcı: ${h.user}\nBot: ${h.bot}`).join("\n---\n")
        : "";

    // Küfür kontrolü önce yap (LLM'e bile sormaya gerek yok)
    const kufurlu = kufurVarMi(soru);
    let action = kufurlu ? "insult" : null;
    let aramaVerisi = "";
    let havaVerisi = null;
    let aramaQuery = "";

    // Küfür değilse LLM'e sor
    if (!kufurlu) {
        const karar = await kararVer(soru, gecmisMetin);
        action = karar.action || "chat";
        aramaQuery = karar.query || soru;

        if (action === "search") {
            aramaVerisi = await webAra(aramaQuery);
            if (!aramaVerisi) {
                // Veri gelmedi ama yine de cevap üretmeye çalış
                console.log("⚠️ Web araması boş döndü");
            }
        } else if (action === "weather") {
            const sehir = karar.city || "Istanbul";
            havaVerisi = await getHavaDurumu(sehir);
        }
    }

    // ---- Prompt oluştur ----
    let sistemPrompt, kullaniciPrompt;

    if (action === "insult") {
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Kullanıcı küfür etti. Kısa ve esprili Türkçe geri laf sok — 1-2 cümle yeterli.
Sadece laf sok. Açıklama yapma, soru sorma. Sadece Türkçe.`;
        kullaniciPrompt = `"${soru}"`;

    } else if (action === "weather" && havaVerisi) {
        const h = havaVerisi;
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Hava durumu bilgisini doğal ve samimi Türkçe ile sun. Emoji kullan.
Sadece hava bilgisi ver, ekstra yorum ekleme. Sadece Türkçe.`;
        kullaniciPrompt =
            `Tarih: ${tarih}\n\n` +
            `📍 ${h.sehir}, ${h.ulke}\n` +
            `🌡️ ${h.sicaklik}°C (hissedilen: ${h.hissedilen}°C)\n` +
            `💧 Nem: %${h.nem} | 💨 Rüzgar: ${h.ruzgar} km/s\n` +
            `☁️ ${h.durum}\n\n` +
            `3 Günlük Tahmin:\n` +
            h.gunluk.map((g, i) => `Gün ${i+1}: ${g.max}°C / ${g.min}°C — ${g.durum}`).join("\n");

    } else if (action === "weather" && !havaVerisi) {
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Kısa ve doğal Türkçe cevap ver.`;
        kullaniciPrompt = `Kullanıcı hava durumu sordu ama şehir bulunamadı. Hangi şehir için sorduğunu sor. Soru: "${soru}"`;

    } else if (action === "search") {
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Aşağıdaki web arama sonuçlarını kullanarak kullanıcının sorusunu yanıtla.

KURALLAR:
- Web verilerinden yararlanarak net ve bilgilendirici cevap ver.
- Sonuçlar güncel bilgi içeriyorsa kesin olarak söyle.
- Eğer web verileri yetersizse "Tam bilgiye ulaşamadım ama..." diyerek bildiklerini paylaş.
- Asla "verilere ulaşamadım" deyip durma — her zaman bir şeyler söyle.
- Cevabı kısa tut (3-5 cümle veya madde madde), gereksiz uzatma.
- Sadece Türkçe yaz.`;
        kullaniciPrompt = [
            `Tarih: ${tarih}`,
            gecmisMetin ? `Önceki konuşma:\n${gecmisMetin}` : "",
            aramaVerisi ? `🔍 Web Arama Sonuçları (sorgu: "${aramaQuery}"):\n${aramaVerisi}` : "⚠️ Web araması sonuç döndürmedi.",
            `Kullanıcı sorusu: ${soru}`
        ].filter(Boolean).join("\n\n");

    } else {
        // Normal sohbet
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Kullanıcıyla samimi, sıcak ve esprili sohbet et.

KURALLAR:
1. Cevaplar kısa olsun (1-3 cümle).
2. Kullanıcı soru soruyorsa önce soruyu yanıtla, sonra istersen kısa yorum ekle.
3. Kullanıcı bir şeyi düzeltiyorsa kabul et, özür dile ve bağlamla devam et.
4. Konuyu zorla değiştirme.
5. Sadece Türkçe yaz (gerekirse İngilizce). Asla başka dil kullanma.`;
        kullaniciPrompt = [
            `Tarih: ${tarih}`,
            gecmisMetin ? `Önceki konuşma:\n${gecmisMetin}` : "",
            `Kullanıcı: ${soru}`
        ].filter(Boolean).join("\n\n");
    }

    // ---- Groq'a gönder ----
    try {
        let cevap = await groq(
            [
                { role: "system", content: sistemPrompt },
                { role: "user",   content: kullaniciPrompt }
            ],
            { model: MODEL_SMART, temperature: 0.75, max_tokens: 700 }
        );

        cevap = temizleDil(cevap);

        if (!cevap || cevap.trim().length < 3) {
            cevap = action === "weather" && havaVerisi
                ? `**${havaVerisi.sehir}**: ${havaVerisi.sicaklik}°C, ${havaVerisi.durum}`
                : "Anlayamadım, tekrar yazar mısın? 🤔";
        }

        // Hafızaya kaydet
        const yeni = [...gecmis, { user: soru, bot: cevap }];
        if (yeni.length > MAX_HISTORY) yeni.shift();
        memory.set(userId, yeni);

        return cevap;

    } catch (e) {
        console.error("❌ Groq hatası:", e.message);
        return "⚠️ Bir sorun oluştu, lütfen tekrar dene.";
    }
}

/* ====== MESAJ BÖLÜCÜ ====== */
function mesajlariBol(metin, limit = 1950) {
    if (metin.length <= limit) return [metin];
    const parcalar = [];
    let kalan = metin;
    while (kalan.length > 0) {
        let kes = limit;
        const sonP = kalan.lastIndexOf('\n\n', limit);
        if (sonP > limit * 0.6) kes = sonP;
        else {
            const sonS = kalan.lastIndexOf('\n', limit);
            if (sonS > limit * 0.6) kes = sonS;
        }
        parcalar.push(kalan.slice(0, kes).trim());
        kalan = kalan.slice(kes).trim();
    }
    return parcalar;
}

/* ====== GÜVENLİ MESAJ GÖNDERME ====== */
async function guvenliGonder(msg, metin, ilk = true) {
    try {
        if (ilk) {
            await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        } else {
            await msg.channel.send(metin);
        }
    } catch (err) {
        if (err.code === 50013) {
            try { await msg.author.send(`(${msg.guild?.name || "Sunucu"} — izin yok)\n\n${metin}`); }
            catch { console.error("❌ DM de gönderilemedi."); }
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
    if (msg.mentions.everyone) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return guvenliGonder(msg, "Merhaba! Ne sormak istiyorsun? 🤖");

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

client.once("ready", c => {
    console.log(`✅ ${c.user.tag} aktif — Model: ${MODEL_SMART}`);
    console.log(`🕒 Başlangıç: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan`);
    console.log(`🔍 Web Arama: Jina AI aktif`);
});

process.on("unhandledRejection", err => {
    console.error("🔥 Unhandled Rejection:", err?.message || err);
});

client.login(DISCORD_TOKEN);