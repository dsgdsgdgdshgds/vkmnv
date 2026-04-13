const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT AYARI ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.groq;
const DISCORD_TOKEN  = process.env.token;

/* ====== MODELLER ====== */
const MODEL_FAST   = "llama-3.1-8b-instant";
const MODEL_SMART  = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 5;

/* ====== GROQ YARDIMCI FONKSİYON ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.6, max_tokens = 1500 } = {}) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature, max_tokens },
        {
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Accept-Charset": "utf-8"
            },
            timeout: 30000,
            responseType: 'json'
        }
    );
    return res.data.choices[0].message.content.trim();
}

/* ====== HAVA DURUMU KONTROLÜ ====== */
function isHavaDurumuSorusu(soru) {
    const k = soru.toLowerCase();
    const patterns = [
        /hava\s*durumu/i, /hava\s*nasil/i, /kac\s*derece/i, /sicaklik/i,
        /yagmur/i, /kar\s*yagi/i, /bulutlu/i, /ruzgar/i,
        /weather/i, /temperature/i, /forecast/i,
    ];
    return patterns.some(p => p.test(k));
}

/* ====== SPOR SORUSU KONTROLÜ ====== */
function isSporSorusu(soru) {
    const k = soru.toLowerCase();
    const patterns = [
        /mac\s*(skoru|sonucu|kac\s*kac)/i, /canli\s*skor/i, /live\s*score/i,
        /bu\s*(sezon|hafta)\s*(kac|puan|gol)/i,
        /son\s*(mac|oyun|karsilasma)/i,
        /transfer\s*(haberi|duyurusu|imzaladi)/i,
        /nba|nfl|formula|f1/i,
        /super\s*lig\s*(puan|tablo|sonuc)/i,
        /sampiyonlar\s*ligi\s*(sonuc|mac)/i,
    ];
    return patterns.some(p => p.test(k));
}

/* ====== HABER/GÜNCEL OLAY KONTROLÜ ====== */
function isHaberSorusu(soru) {
    const k = soru.toLowerCase();
    const patterns = [
        /son\s*dakika/i, /breaking/i, /bugun\s*ne\s*oldu/i,
        /son\s*gelisme/i, /gundem/i, /haber/i,
        /patlama/i, /deprem/i, /yangin/i, /kaza\s*(haberi)?/i,
        /secim\s*(sonucu|haberi)/i,
        /dolar\s*(kac|kuru)/i, /euro\s*(kac|kuru)/i,
        /altin\s*(fiyat|gram)/i, /bitcoin\s*(fiyat|kac)/i,
        /borsa\s*(bugun|son)/i, /enflasyon\s*(son|bugun)/i,
    ];
    return patterns.some(p => p.test(k));
}

/* ====== GÜNCEL BİLGİ GEREKTİRİYOR MU? ====== */
// Sadece gerçekten web araması gerektiren sorgular için true döner.
// Ansiklopedik/tarihsel sorular (nedir, kimdir, vb.) false döner.
function isGuncelBilgiSorusu(soru) {
    const k = soru.toLowerCase();

    // Kesinlikle statik/ansiklopedik — web araması GEREKSIZ
    const statikPatterns = [
        /\bnedir\b/i, /\bkimdir\b/i, /ne\s*demek/i, /anlami\s*(nedir)?/i,
        /tarihi\s*nedir/i, /tarihce/i,
        /kim\s*(buldu|icat|kurdu|yapti)/i,
        /kac\s*yilinda\s*(kuruldu|dogdu|oldu|icat)/i,
        /nasil\s*(calisir|yapilir|oynanir)/i,
        /ne\s*kadar\s*(surer|uzun|buyuk)/i,
        /hangi\s*(ulkede|sehirde|kitada)/i,
        /kac\s*(metre|kilometre|yil\s*once|yuzyl)/i,
    ];
    if (statikPatterns.some(p => p.test(k))) return false;

    // Kesinlikle güncel — web araması ŞART
    const guncelPatterns = [
        /bugun/i, /su\s*an/i, /simdi/i, /dun/i,
        /bu\s*(hafta|ay|yil|sezon)/i,
        /son\s*(haber|gelisme|dakika|durum)/i,
        /guncel/i, /yeni\s*(haber|durum|gelisme)/i,
        /kac\s*(lira|dolar|euro)\s*(bugun|simdi|su\s*an)/i,
        /fiyat\s*(bugun|simdi)/i,
        /canli/i, /live/i,
    ];
    if (guncelPatterns.some(p => p.test(k))) return true;

    // Spor & haber kalıpları da web gerektirir
    return isSporSorusu(soru) || isHaberSorusu(soru);
}

/* ====== BİLGİ/ANSİKLOPEDİ SORUSU KONTROLÜ ====== */
function isBilgiSorusu(soru) {
    const k = soru.toLowerCase();
    const patterns = [
        /nedir/i, /kimdir/i, /ne\s*zaman/i, /nasil/i, /neden/i, /nerede/i,
        /tarihi/i, /hakkinda/i, /bilgi/i, /tanim/i, /aciklama/i,
        /kim\s*yapti/i, /kim\s*buldu/i, /kim\s*icat/i, /kac\s*yilinda/i,
        /ne\s*demek/i, /anlami/i, /tarihce/i
    ];
    return patterns.some(p => p.test(k));
}

/* ====== NORMAL SOHBET KONTROLÜ ====== */
function isNormalSohbet(soru) {
    const k = soru.toLowerCase().trim();
    const patterns = [
        /^merhaba/i, /^selam/i, /^naber/i, /^nasilsin/i, /^ne\s*yapiyorsun/i,
        /^iyi\s*misin/i, /^gunaydin/i, /^iyi\s*aksamlar/i, /^iyi\s*geceler/i,
        /^teskkur/i, /^sagol/i, /^eyvallah/i, /^gorusuruz/i, /^bay/i, /^bb/i,
        /^haha/i, /^lol/i, /^xd/i, /^😂/, /^🤣/, /^😅/, /^👍/, /^👎/,
        /^(evet|hayir|tamam|olur|olmaz|belki)$/i,
        /^(sa|as|sea|selamun\s*aleykum)$/i
    ];
    return patterns.some(p => p.test(k)) || soru.length < 15;
}

/* ====== OPEN-METEO HAVA DURUMU (Dünya geneli) ====== */
async function getHavaDurumu(sehir) {
    try {
        const geoRes = await axios.get(
            `https://geocoding-api.open-meteo.com/v1/search`,
            {
                params: { name: sehir, count: 1, language: "tr", format: "json" },
                timeout: 6000,
                responseType: 'json'
            }
        );

        if (!geoRes.data.results?.length) return null;

        const { latitude, longitude, name, country } = geoRes.data.results[0];

        const weatherRes = await axios.get(
            `https://api.open-meteo.com/v1/forecast`,
            {
                params: {
                    latitude,
                    longitude,
                    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                    daily: "weather_code,temperature_2m_max,temperature_2m_min",
                    timezone: "auto",
                    forecast_days: 3
                },
                timeout: 6000,
                responseType: 'json'
            }
        );

        const current = weatherRes.data.current;
        const daily = weatherRes.data.daily;

        const weatherCodes = {
            0: "Acik ☀️", 1: "Parcali bulutlu 🌤️", 2: "Bulutlu ⛅", 3: "Kapali ☁️",
            45: "Sisli 🌫️", 48: "Donmus sis 🌫️",
            51: "Cisenti 🌦️", 53: "Orta cisenti 🌧️", 55: "Yogun cisenti 🌧️",
            61: "Hafif yagmur 🌧️", 63: "Yagmur 🌧️", 65: "Siddetli yagmur 🌧️",
            71: "Hafif kar 🌨️", 73: "Kar 🌨️", 75: "Yogun kar 🌨️",
            80: "Saganak 🌦️", 81: "Orta saganak 🌧️", 82: "Siddetli saganak ⛈️",
            95: "Gok gurultusu ⛈️", 96: "Dolu ⛈️", 99: "Siddetli dolu ⛈️"
        };

        return {
            sehir: name,
            ulke: country,
            sicaklik: Math.round(current.temperature_2m),
            hissedilen: Math.round(current.apparent_temperature),
            nem: current.relative_humidity_2m,
            ruzgar: current.wind_speed_10m,
            durum: weatherCodes[current.weather_code] || "Bilinmiyor",
            gunluk: daily.temperature_2m_max.map((max, i) => ({
                max: Math.round(max),
                min: Math.round(daily.temperature_2m_min[i]),
                durum: weatherCodes[daily.weather_code[i]] || "Bilinmiyor"
            })).slice(0, 3)
        };
    } catch (e) {
        console.log(`⚠️ Hava durumu hatası: ${e.message}`);
        return null;
    }
}

/* ====== ŞEHİR ÇIKARMA (Dünya geneli — liste yok, geocoding halleder) ====== */
function extractSehir(soru) {
    // "X hava durumu", "X'de hava", "weather in X" gibi kalıplardan şehir çek
    const kaliplar = [
        // "İstanbul hava", "London hava durumu"
        /^([A-Za-z\u00C0-\u024F\u0400-\u04FF]+(?:\s[A-Za-z\u00C0-\u024F]+)?)\s+hava/i,
        // "hava durumu İstanbul", "weather in Tokyo"
        /hava(?:\s*durumu)?\s+(?:in|at|of|icin)?\s*([A-Za-z\u00C0-\u024F]+(?:\s[A-Za-z\u00C0-\u024F]+)?)/i,
        /weather\s+(?:in|at|of)?\s*([A-Za-z\u00C0-\u024F]+(?:\s[A-Za-z\u00C0-\u024F]+)?)/i,
        // "New York'ta hava nasıl"
        /([A-Za-z\u00C0-\u024F]+(?:\s[A-Za-z\u00C0-\u024F]+)?)'?(?:da|de|ta|te|nin|nun|nun|in)\s+hava/i,
    ];

    for (const k of kaliplar) {
        const m = soru.match(k);
        if (m && m[1]) {
            const aday = m[1].trim();
            if (aday.length > 1 && aday.length < 50) return aday;
        }
    }

    // Fallback: büyük harfle başlayan kelime grubu
    const buyukMatch = soru.match(/([A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+(?:\s[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+){0,2})/);
    if (buyukMatch) return buyukMatch[1].trim();

    return null;
}

/* ====== SERPER.DEV WEB ARAMA (Google sonuçları, ücretsiz 2500/ay, kart yok) ====== */
async function webAra(sorgu, maxResults = 5) {
    try {
        const SERPER_API_KEY = process.env.serper;
        if (!SERPER_API_KEY) {
            console.log("⚠️ SERPER_API_KEY bulunamadı");
            return [];
        }

        const res = await axios.post("https://google.serper.dev/search", {
            q: sorgu,
            gl: "tr",
            hl: "tr",
            num: maxResults
        }, {
            headers: {
                "X-API-KEY": SERPER_API_KEY,
                "Content-Type": "application/json"
            },
            timeout: 10000,
            responseType: 'json'
        });

        const organic = res.data?.organic || [];

        return organic.slice(0, maxResults).map(r => ({
            title: r.title || "",
            snippet: r.snippet || "",
            url: r.link || ""
        })).filter(r => r.title.length > 3 && r.snippet.length > 10);

    } catch (e) {
        console.log(`⚠️ Serper hatası: ${e.message}`);
        return [];
    }
}

/* ====== WIKIPEDIA FALLBACK ====== */
async function wikipediaFallback(sorgu) {
    try {
        for (const lang of ["tr", "en"]) {
            const arama = await axios.get(
                `https://${lang}.wikipedia.org/w/api.php`,
                {
                    params: {
                        action: "query",
                        list: "search",
                        srsearch: sorgu,
                        srlimit: 2,
                        format: "json",
                        origin: "*"
                    },
                    timeout: 6000,
                    responseType: 'json'
                }
            );

            const sayfalar = arama.data?.query?.search || [];
            const sonuclar = [];

            for (const sayfa of sayfalar.slice(0, 2)) {
                try {
                    const ozet = await axios.get(
                        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sayfa.title)}`,
                        {
                            timeout: 5000,
                            headers: { "Accept": "application/json; charset=utf-8" },
                            responseType: 'json'
                        }
                    );
                    if (ozet.data.extract) {
                        sonuclar.push(`${ozet.data.title}: ${ozet.data.extract.slice(0, 400)}`);
                    }
                } catch {}
            }

            if (sonuclar.length) return sonuclar.join("\n");
        }
    } catch (e) {
        console.log(`⚠️ Wikipedia hatası: ${e.message}`);
    }
    return "";
}

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = [
    "amk","amina","orospu","oc","sik","got","bok","yarrak","pic","sikerim",
    "orospu cocugu","geriزekalı","salak","ahmak","kahpe","mal","aptal","pezevenk",
    "yavsak","serefsiz","pic kurusu","amcik","gavat","orosbu","siktir","lanet",
    "allahinı","peygamberini","dinsiz","imansiz","it","kopek","essek","yosma",
    "keko","zibidi","moron","gerzek","manyak","kafasiz"
];

function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
        .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== DİL TEMİZLEME ====== */
function temizleDil(metin) {
    const yabanciKarakterler = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0600-\u06ff\u0750-\u077f\u0400-\u04ff\u0370-\u03ff\u0e00-\u0e7f\u0590-\u05ff]/g;
    const temiz = metin.replace(yabanciKarakterler, '');
    if (temiz.trim().length === 0) return metin;
    return temiz;
}

/* ====== CEVAP ÜRETME ====== */
async function cevapUret(userId, soru) {
    const simdi = new Date();
    const tarih = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const normalSohbet = isNormalSohbet(soru);
    const mesajdaKufur = kufurVarMi(soru);

    let webSonucu = null;
    let tip = "sohbet";

    if (!normalSohbet && !mesajdaKufur) {
        if (isHavaDurumuSorusu(soru)) {
            // Hava durumu — şehir çıkar, dünya geneli çalışır
            const sehir = extractSehir(soru) || "Istanbul";
            const hava = await getHavaDurumu(sehir);
            if (hava) {
                webSonucu = { tip: "hava", veri: hava };
                tip = "hava";
            }
        } else if (isGuncelBilgiSorusu(soru)) {
            // Güncel bilgi gerekiyor → web ara
            const sorgu = soru.replace(/[?.!]/g, '').trim();
            const results = await webAra(sorgu, 5);

            if (results.length > 0) {
                const formatted = results.map((r, i) =>
                    `[${i + 1}] ${r.title}\n${r.snippet}`
                ).join("\n\n");
                webSonucu = { tip: "web", veri: formatted };
                tip = "arastirma";
            } else {
                const wiki = await wikipediaFallback(sorgu);
                if (wiki) {
                    webSonucu = { tip: "wiki", veri: wiki };
                    tip = "arastirma";
                }
            }
        } else if (isBilgiSorusu(soru)) {
            // Ansiklopedik soru → direkt Wikipedia, web aramaya gerek yok
            const sorgu = soru.replace(/[?.!]/g, '').trim();
            const wiki = await wikipediaFallback(sorgu);
            if (wiki) {
                webSonucu = { tip: "wiki", veri: wiki };
                tip = "arastirma";
            }
        }
    }

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.slice(-2).map((h, i) => `[${i + 1}] K: ${h.user} | B: ${h.bot}`).join("\n")
        : "";

    let sistemPrompt;
    let kullaniciPrompt;

    if (mesajdaKufur) {
        // Küfür geldi → kısa ve eğlenceli laf sok, konuyla alakasız uzun cevap verme
        sistemPrompt = `You are BatuBot, a Discord bot. Developer is Batuhan.
The user just insulted you. Fire back with a SHORT, witty Turkish comeback (1-2 sentences max).
Keep it funny and light, not overly harsh. 
NEVER answer any question in this mode — ONLY throw the comeback.
ONLY Turkish. NEVER use Chinese, Japanese, Korean, Arabic, Russian or any non-Latin script.`;
        kullaniciPrompt = `Kullanıcı şunu söyledi: "${soru}"\n\nKısa ve esprili Türkçe laf sok.`;

    } else if (tip === "hava") {
        const h = webSonucu.veri;
        // Hava durumu → sadece hava bilgisi sun, laf sokma yok
        sistemPrompt = `You are BatuBot, a Discord bot. Developer is Batuhan.
Present the weather data below in a friendly, natural way. Use emojis. Keep it concise.
DO NOT add jokes, insults, or unrelated commentary — ONLY present the weather.
ONLY Turkish.`;
        kullaniciPrompt = `Tarih: ${tarih}\n\n${h.sehir}, ${h.ulke} hava durumu:\n` +
            `Sıcaklık: ${h.sicaklik}°C (hissedilen: ${h.hissedilen}°C)\n` +
            `Nem: %${h.nem}\n` +
            `Rüzgar: ${h.ruzgar} km/s\n` +
            `Durum: ${h.durum}\n\n` +
            `3 Günlük Tahmin:\n` +
            h.gunluk.map((g, i) => `Gün ${i + 1}: ${g.max}°C / ${g.min}°C - ${g.durum}`).join("\n") +
            `\n\nBu bilgileri Türkçe, doğal bir şekilde sun.`;

    } else if (tip === "arastirma") {
        // Araştırma → web verisini kullan, sadece soruyu yanıtla
        sistemPrompt = `You are BatuBot, a Discord bot. Developer is Batuhan.
Answer the user's question using ONLY the web data provided below.
Be direct and informative. Use bullet points if listing multiple facts.
If the data is insufficient, say "Güncel bilgiye ulaşamadım."
DO NOT add jokes, insults, or unrelated commentary — just answer the question.
ONLY Turkish. NEVER use Chinese, Japanese, Korean, Arabic, Russian or any non-Latin script.`;
        kullaniciPrompt = [
            `Tarih: ${tarih}`,
            webSonucu?.veri ? `Web arama sonuçları:\n${webSonucu.veri}` : "",
            `Kullanıcı sorusu: ${soru}`,
            `\nÖNEMLİ: Sadece yukarıdaki web verisine dayanarak cevap ver.`
        ].filter(Boolean).join("\n\n");

    } else {
        // Normal sohbet → samimi, kısa, esprili ama SADECE sohbet et
        sistemPrompt = `You are BatuBot, a friendly Discord bot. Developer is Batuhan.
Chat casually and warmly. Keep responses SHORT (1-3 sentences).
Be witty and fun in normal conversation.
IMPORTANT: If the user asks a real question (not just chatting), answer it directly without unnecessary jokes.
ONLY Turkish or English. NEVER use Chinese, Japanese, Korean, Arabic, Russian or any non-Latin script.`;
        kullaniciPrompt = [
            `Tarih: ${tarih}`,
            gecmisMetin ? `Son konuşmalar:\n${gecmisMetin}` : "",
            `Kullanıcı: ${soru}`
        ].filter(Boolean).join("\n\n");
    }

    try {
        let cevap = await groq(
            [
                { role: "system", content: sistemPrompt },
                { role: "user", content: kullaniciPrompt }
            ],
            { model: MODEL_SMART, temperature: 0.7, max_tokens: 800 }
        );

        cevap = temizleDil(cevap);

        if (!cevap || cevap.trim().length < 3) {
            if (tip === "hava") {
                const h = webSonucu.veri;
                cevap = `**${h.sehir} Hava Durumu**\n🌡️ ${h.sicaklik}°C (hissedilen: ${h.hissedilen}°C)\n💧 Nem: %${h.nem}\n💨 Rüzgar: ${h.ruzgar} km/s\n☁️ ${h.durum}\n\n**3 Günlük Tahmin:**\n${h.gunluk.map((g, i) => `Gün ${i + 1}: ${g.max}°C / ${g.min}°C`).join('\n')}`;
            } else if (tip === "arastirma") {
                cevap = "Üzgünüm, şu an güncel bilgiye ulaşamıyorum. Daha sonra tekrar dene.";
            } else {
                cevap = "Anladım, devam et.";
            }
        }

        if (tip === "sohbet" || (tip === "arastirma" && webSonucu)) {
            const yeniGecmis = [...gecmis, { user: soru, bot: cevap }];
            if (yeniGecmis.length > MAX_HISTORY) yeniGecmis.shift();
            memory.set(userId, yeniGecmis);
        }

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
async function guvenliGonder(msg, metin, ilk = true) {
    try {
        if (ilk) {
            await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        } else {
            await msg.channel.send(metin);
        }
    } catch (err) {
        if (err.code === 50013) {
            try {
                await msg.author.send(`(${msg.guild?.name || "Sunucu"} kanalında mesaj iznim yok, DM atıyorum)\n\n${metin}`);
            } catch {
                console.error("❌ DM de gönderilemedi.");
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
    if (msg.mentions.everyone) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) {
        return guvenliGonder(msg, "Merhaba! Bana bir şey sormak ister misin? 🤖");
    }

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
});

process.on("unhandledRejection", err => {
    console.error("🔥 Unhandled Rejection:", err?.message || err);
});

client.login(DISCORD_TOKEN);