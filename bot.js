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
        /hava\s*durumu/i, /hava\s*nasıl/i, /kaç\s*derce/i, /sıcaklık/i,
        /yağmur/i, /kar\s*yağı/i, /güneş/i, /bulutlu/i, /rüzgar/i,
        /weather/i, /temperature/i, /forecast/i, /yağacak/i, /bulancak/i
    ];
    return patterns.some(p => p.test(k));
}

/* ====== SPOR SORUSU KONTROLÜ ====== */
function isSporSorusu(soru) {
    const k = soru.toLowerCase();
    const patterns = [
        /maç/i, /maçı/i, /skor/i, /sonuç/i, /puan/i, /futbol/i, /basketbol/i,
        /galatasaray/i, /fenerbahçe/i, /beşiktaş/i, /trabzon/i, /süper\s*lig/i,
        /şampiyonlar\s*ligi/i, /euro/i, /dünya\s*kupası/i, /nba/i, /nfl/i,
        /tenis/i, /formula/i, /f1/i, /transfer/i, /gol/i, /asist/i
    ];
    return patterns.some(p => p.test(k));
}

/* ====== HABER/GÜNCEL OLAY KONTROLÜ ====== */
function isHaberSorusu(soru) {
    const k = soru.toLowerCase();
    const patterns = [
        /haber/i, /son\s*durum/i, /gündem/i, /bugün\s*ne\s*oldu/i, /son\s*gelişme/i,
        /patlama/i, /deprem/i, /yangın/i, /kaza/i, /ölüm/i, /seçim/i, /oylama/i,
        /ekonomi/i, /dolar/i, /euro/i, /altın/i, /borsa/i, /bitcoin/i, /kripto/i,
        /enflasyon/i, /faiz/i, /merkez\s*bankası/i
    ];
    return patterns.some(p => p.test(k));
}

/* ====== BİLGİ/ANSİKLOPEDİ SORUSU KONTROLÜ ====== */
function isBilgiSorusu(soru) {
    const k = soru.toLowerCase();
    const patterns = [
        /nedir/i, /kimdir/i, /ne\s*zaman/i, /nasıl/i, /neden/i, /nerede/i,
        /tarihi/i, /hakkında/i, /bilgi/i, /tanım/i, /açıklama/i,
        /kim\s*yaptı/i, /kim\s*buldu/i, /kim\s*icat/i, /kaç\s*yılında/i,
        /ne\s*demek/i, /anlamı/i, /tarihçe/i
    ];
    return patterns.some(p => p.test(k));
}

/* ====== NORMAL SOHBET KONTROLÜ ====== */
function isNormalSohbet(soru) {
    const k = soru.toLowerCase().trim();
    const patterns = [
        /^merhaba/i, /^selam/i, /^naber/i, /^nasılsın/i, /^ne\s*yapıyorsun/i,
        /^iyi\s*misin/i, /^günaydın/i, /^iyi\s*akşamlar/i, /^iyi\s*geceler/i,
        /^teşekkür/i, /^sağol/i, /^eyvallah/i, /^görüşürüz/i, /^bay/i, /^bb/i,
        /^haha/i, /^lol/i, /^xd/i, /^😂/, /^🤣/, /^😅/, /^👍/, /^👎/,
        /^(evet|hayır|tamam|olur|olmaz|belki)$/i,
        /^(sa|as|sea|selamun\s*aleyküm)$/i
    ];
    return patterns.some(p => p.test(k)) || soru.length < 15;
}

/* ====== OPEN-METEO HAVA DURUMU ====== */
async function getHavaDurumu(sehir) {
    try {
        const geoRes = await axios.get(
            `https://geocoding-api.open-meteo.com/v1/search`,
            { 
                params: { name: sehir, count: 1, language: "tr", format: "json" },
                timeout: 5000,
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
                timeout: 5000,
                responseType: 'json'
            }
        );
        
        const current = weatherRes.data.current;
        const daily = weatherRes.data.daily;
        
        const weatherCodes = {
            0: "Açık ☀️", 1: "Parçalı bulutlu 🌤️", 2: "Bulutlu ⛅", 3: "Kapalı ☁️",
            45: "Sisli 🌫️", 48: "Donmuş sis 🌫️",
            51: "Çisenti 🌦️", 53: "Orta çisenti 🌧️", 55: "Yoğun çisenti 🌧️",
            61: "Hafif yağmur 🌧️", 63: "Yağmur 🌧️", 65: "Şiddetli yağmur 🌧️",
            71: "Hafif kar 🌨️", 73: "Kar 🌨️", 75: "Yoğun kar 🌨️",
            80: "Sağanak 🌦️", 81: "Orta sağanak 🌧️", 82: "Şiddetli sağanak ⛈️",
            95: "Gök gürültüsü ⛈️", 96: "Dolu ⛈️", 99: "Şiddetli dolu ⛈️"
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

/* ====== SEARX WEB ARAMA (DuckDuckGo yerine - sorunsuz JSON) ====== */
async function duckDuckGoSearch(sorgu, maxResults = 5) {
    try {
        const searchUrl = `https://searx.be/search?q=${encodeURIComponent(sorgu)}&format=json&language=tr-TR&categories=general`;
        
        const res = await axios.get(searchUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
            },
            timeout: 10000,
            responseType: 'json'
        });
        
        const data = res.data;
        const results = [];
        
        if (data.results && Array.isArray(data.results)) {
            for (const item of data.results.slice(0, maxResults)) {
                if (item.title && item.content) {
                    results.push({
                        title: item.title.trim(),
                        snippet: item.content.trim(),
                        url: item.url || '#'
                    });
                }
            }
        }
        
        return results;
    } catch (e) {
        console.log(`⚠️ Searx arama hatası: ${e.message}`);
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
                        `https://\( {lang}.wikipedia.org/api/rest_v1/page/summary/ \){encodeURIComponent(sayfa.title)}`,
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

/* ====== ŞEHİR ÇIKARMA ====== */
function extractSehir(soru) {
    const sehirler = [
        "İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Adana", "Konya", 
        "Gaziantep", "Şanlıurfa", "Mersin", "Diyarbakır", "Kayseri", "Eskişehir",
        "Samsun", "Trabzon", "Malatya", "Erzurum", "Van", "Batman", "Elazığ",
        "Sakarya", "Kocaeli", "Manisa", "Aydın", "Balıkesir", "Tekirdağ",
        "Çanakkale", "Edirne", "Kırklareli", "Rize", "Artvin", "Giresun", "Ordu",
        "Sivas", "Tokat", "Amasya", "Çorum", "Yozgat", "Kırıkkale", "Kırşehir",
        "Nevşehir", "Niğde", "Aksaray", "Karaman", "Isparta", "Burdur", "Uşak",
        "Afyonkarahisar", "Kütahya", "Bilecik", "Bolu", "Düzce", "Zonguldak",
        "Karabük", "Bartın", "Kastamonu", "Sinop", "Çankırı", "Bayburt", "Gümüşhane",
        "Ardahan", "Kars", "Iğdır", "Ağrı", "Muş", "Bitlis", "Hakkari", "Şırnak",
        "Siirt", "Mardin", "Kilis", "Hatay", "Osmaniye", "Kahramanmaraş", "Adıyaman",
        "Tunceli", "Bingöl", "Muğla", "Denizli", "Konya", "Eskişehir", "Bulancak"
    ];
    
    const k = soru.toLowerCase();
    for (const sehir of sehirler) {
        if (k.includes(sehir.toLowerCase())) return sehir;
    }
    
    const match = soru.match(/([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)?)/);
    return match ? match[1] : null;
}

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = [
    "amk","amına","orospu","oç","sik","göt","bok","yarrak","piç","sikerim",
    "orospu çocuğu","gerizekalı","salak","ahmak","kahpe","mal","aptal","pezevenk",
    "yavşak","şerefsiz","piç kurusu","amcık","gavat","orosbu","siktir","lanet",
    "allahını","peygamberini","dinsiz","imansız","it","köpek","eşşek","yosma",
    "keko","zibidi","moron","aptal sürüsü","gerzek","manyak","deli","kafasız"
];

function kufurVarMi(metin) {
    const k = metin.toLowerCase();
    return KUFURLER.some(w => {
        const normalized = w.replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u");
        return k.includes(w) || k.includes(normalized);
    });
}

/* ====== DİL TEMİZLEME ====== */
function temizleDil(metin) {
    const yabanciKarakterler = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0600-\u06ff\u0750-\u077f\u0400-\u04ff\u0370-\u03ff\u0e00-\u0e7f\u0590-\u05ff]/g;
    let temiz = metin.replace(yabanciKarakterler, '');
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
            const sehir = extractSehir(soru) || "İstanbul";
            const hava = await getHavaDurumu(sehir);
            if (hava) {
                webSonucu = { tip: "hava", veri: hava };
                tip = "hava";
            }
        } else if (isSporSorusu(soru) || isHaberSorusu(soru) || isBilgiSorusu(soru)) {
            const sorgu = soru.replace(/[?.!]/g, '').trim();
            const results = await duckDuckGoSearch(sorgu, 5);
            
            if (results.length > 0) {
                const formatted = results.map((r, i) => 
                    `[${i+1}] \( {r.title}\n \){r.snippet}`
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
        }
    }
    
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.slice(-2).map((h, i) => `[${i + 1}] K: ${h.user} | B: ${h.bot}`).join("\n")
        : "";
    
    let sistemPrompt;
    let kullaniciPrompt;
    
    if (mesajdaKufur) {
        sistemPrompt = "You are a Discord bot named BatuBot. Developer is Batuhan. User insulted you. Respond with short, witty Turkish insults (1-2 sentences). Be creative but not too harsh. NEVER use Chinese, Japanese, Korean, Arabic, Russian or any non-Latin script. ONLY Turkish or English.";
        kullaniciPrompt = `User said: "${soru}"\n\nRespond with Turkish insult.`;
        
    } else if (tip === "hava") {
        const h = webSonucu.veri;
        sistemPrompt = "You are BatuBot, a Discord bot. Present weather data in a friendly, concise way. Use emojis. ONLY Turkish or English. Never other languages.";
        kullaniciPrompt = `Today is ${tarih}\n\nWeather for ${h.sehir}, ${h.ulke}:\n` +
            `Temperature: ${h.sicaklik}°C (feels like ${h.hissedilen}°C)\n` +
            `Humidity: ${h.nem}%\n` +
            `Wind: ${h.ruzgar} km/h\n` +
            `Condition: ${h.durum}\n\n` +
            `3-Day Forecast:\n` +
            h.gunluk.map((g, i) => `Day ${i+1}: ${g.max}°C / ${g.min}°C - ${g.durum}`).join("\n") +
            `\n\nPresent this information naturally in Turkish.`;
            
    } else if (tip === "arastirma") {
        sistemPrompt = "You are BatuBot, a helpful Discord bot. Answer using the provided web data. Summarize clearly with bullet points. If uncertain, say 'Tahminim:' (My guess:). ONLY Turkish or English. NEVER use Chinese, Japanese, Korean, Arabic, Russian or any other non-Latin script. If data is insufficient, say you couldn't find current info.";
        kullaniciPrompt = [
            `Date: ${tarih}`,
            webSonucu?.veri ? `Web search results:\n${webSonucu.veri}` : "",
            `User question: ${soru}`,
            `\nIMPORTANT: Answer based ONLY on the web data provided above. If no data, say "Güncel bilgiye ulaşamadım" (Couldn't reach current info).`
        ].filter(Boolean).join("\n\n");
        
    } else {
        sistemPrompt = "You are BatuBot, a friendly Discord bot. Developer is Batuhan. Chat casually and warmly. Keep responses short (1-3 sentences). Be witty but respectful. ONLY Turkish or English. NEVER use Chinese, Japanese, Korean, Arabic, Russian or any non-Latin script.";
        kullaniciPrompt = [
            `Date: ${tarih}`,
            gecmisMetin ? `Recent chat history:\n${gecmisMetin}` : "",
            `User: ${soru}`
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
                cevap = `**${h.sehir} Hava Durumu**\n🌡️ ${h.sicaklik}°C (hissedilen: \( {h.hissedilen}°C)\n💧 Nem: % \){h.nem}\n💨 Rüzgar: ${h.ruzgar} km/s\n☁️ \( {h.durum}\n\n**3 Günlük Tahmin:**\n \){h.gunluk.map((g, i) => `Gün ${i+1}: ${g.max}°C / ${g.min}°C`).join('\n')}`;
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
                await msg.author.send(`(\( {msg.guild?.name || "Sunucu"} kanalında mesaj iznim yok, DM atıyorum)\n\n \){metin}`);
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