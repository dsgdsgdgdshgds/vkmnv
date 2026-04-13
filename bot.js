const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT AYARI ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY  = process.env.groq;
const DISCORD_TOKEN = process.env.token;

/* ====== MODELLER ====== */
const MODEL_FAST  = "llama-3.1-8b-instant";
const MODEL_SMART = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 6;

/* ====== GROQ YARDIMCI FONKSİYON ====== */
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
            responseType: 'json'
        }
    );
    return res.data.choices[0].message.content.trim();
}

/* ======================================================
   HAVA DURUMU KONTROLÜ
   ÖNEMLİ: Sadece açıkça hava sorusuysa true döner.
   "yağmurda oynadım", "rüzgar gibi koştu" gibi mecazi
   kullanımları YAKALAMAZ — bağlam gerektirir.
   ====================================================== */
function isHavaDurumuSorusu(soru) {
    const k = soru.toLowerCase()
        .replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u');

    // Çok spesifik kalıplar — tek kelime değil, bağlamlı
    const kesin = [
        /hava\s*durumu/,           // "hava durumu"
        /hava\s*(nasil|kac\s*derece|sicaklik|bugün|tahmin)/,
        /weather\s*(in|at|of|for|forecast)/,
        /forecast/,
        /kac\s*derece/,            // "kaç derece"
        /sicaklik\s*(kac|ne|nedir)/,
        /yagmur\s*(yagacak|var\s*mi|mu\s*var|ihtimali)/,  // "yağmur yağacak mı"
        /kar\s*(yagacak|yagdi|var\s*mi)/,
        /dis\s*arida\s*(hava|sicak|soguk)/,
    ];

    return kesin.some(p => p.test(k));
}

/* ====== SPOR SORUSU KONTROLÜ ====== */
function isSporSorusu(soru) {
    const k = soru.toLowerCase()
        .replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u');

    const patterns = [
        /mac\s*(skoru|sonucu|kac\s*kac|bitti\s*mi)/,
        /canli\s*skor/, /live\s*score/,
        /super\s*lig\s*(puan|tablo|sonuc|lider)/,
        /sampiyonlar\s*ligi\s*(sonuc|mac|grup)/,
        /son\s*mac\s*(sonucu|skoru)/,
        /transfer\s*(haberi|duyurusu|imzaladi|ayrildi)/,
        /nba\s*(sonuc|puan|lider)/, /nfl\s*(sonuc|puan)/,
        /f1\s*(sonuc|puan|yaris)/, /formula\s*1\s*(sonuc|yaris)/,
        /galatasaray|fenerbahce|besiktas|trabzonspor/,
    ];
    return patterns.some(p => p.test(k));
}

/* ====== HABER/GÜNCEL OLAY KONTROLÜ ====== */
function isHaberSorusu(soru) {
    const k = soru.toLowerCase()
        .replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u');

    const patterns = [
        /son\s*dakika/, /breaking\s*news/,
        /bugun\s*ne\s*oldu/, /son\s*gelisme/,
        /gundem\s*(nedir|ne)?$/,
        /deprem\s*(oldu|var\s*mi|kac|nerede)/,
        /patlama\s*(oldu|var\s*mi|nerede)/,
        /yangin\s*(var\s*mi|nerede|cikti)/,
        /secim\s*(sonucu|haberi|kazandi)/,
        /dolar\s*(kac|bugün|kuru|ne\s*oldu)/,
        /euro\s*(kac|bugün|kuru)/,
        /altin\s*(fiyati|kac|gram|bugün)/,
        /bitcoin\s*(kac|fiyati|bugün)/,
        /borsa\s*(bugün|ne\s*oldu|acildi)/,
        /enflasyon\s*(kac|son|bugün)/,
    ];
    return patterns.some(p => p.test(k));
}

/* ======================================================
   GÜNCEL BİLGİ GEREKTİRİYOR MU?
   Gereksiz web aramasını önler, sadece gerçekten 
   güncel bilgi lazımsa true döner.
   ====================================================== */
function isGuncelBilgiSorusu(soru) {
    const k = soru.toLowerCase()
        .replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u');

    // Bu kalıplar varsa asla web aramaya gerek yok (ansiklopedik)
    const statik = [
        /\bnedir\b/, /\bkimdir\b/, /ne\s*demek/, /anlami\s*(nedir)?/,
        /nasil\s*(calisir|yapilir|oynanir|pisirilir)/,
        /kim\s*(buldu|icat|kurdu|yapti)/,
        /kac\s*yilinda\s*(kuruldu|dogdu|oldu|icat|kesfedildi)/,
        /ne\s*zaman\s*(dogdu|oldu|kuruldu|bitti)/,
        /hangi\s*(ulkede|sehirde|kitada|yilda)/,
        /tarihce/, /tarihi\s*(nedir|hakkinda)/,
        /nasil\s*(bir|oyun|film|dizi|yer)/,
    ];
    if (statik.some(p => p.test(k))) return false;

    // Bu kalıplar varsa web araması gerekli (güncel)
    const guncel = [
        /\bbugun\b/, /\bdun\b/, /su\s*an/, /\bsimdi\b/,
        /bu\s*(hafta|ay|yil|sezon)\b/,
        /son\s*(haber|gelisme|dakika|durum|hal)\b/,
        /\bguncel\b/, /yeni\s*(haber|aciklama|karar)/,
        /ne\s*oldu/, /neler\s*oldu/,
        /\bcanli\b/, /\blive\b/,
        /kac\s*(lira|dolar|euro|tl)\b/,
        /fiyati\s*(kac|ne\s*kadar|bugün)/,
    ];
    if (guncel.some(p => p.test(k))) return true;

    return isSporSorusu(soru) || isHaberSorusu(soru);
}

/* ====== BİLGİ/ANSİKLOPEDİ SORUSU KONTROLÜ ====== */
function isBilgiSorusu(soru) {
    const k = soru.toLowerCase()
        .replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u');

    const patterns = [
        /\bnedir\b/, /\bkimdir\b/, /\bnasil\b/, /\bneden\b/, /\bnerede\b/,
        /tarihi/, /hakkinda/, /\bbilgi\b/, /tanim/, /aciklama/,
        /kim\s*(buldu|icat|kurdu|yapti)/,
        /ne\s*demek/, /anlami/, /tarihce/,
    ];
    return patterns.some(p => p.test(k));
}

/* ====== NORMAL SOHBET KONTROLÜ ====== */
function isNormalSohbet(soru) {
    const k = soru.toLowerCase().trim()
        .replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u');

    const patterns = [
        /^(merhaba|selam|hey|yo)\b/,
        /^(naber|ne\s*haber|nasilsin|iyi\s*misin)/,
        /^(gunaydin|iyi\s*gunler|iyi\s*aksamlar|iyi\s*geceler)/,
        /^(tesekkur|sagol|eyvallah|tamam|anladim|ok\b|oke\b)/,
        /^(gorusuruz|hosca\s*kal|bb\b|byby)/,
        /^(haha|hehe|xd|lol|😂|🤣|😅|👍|👎|😎)/,
        /^(evet|hayir|yok|var|bilmiyorum|sanmiyorum)$/,
        /^(sa\b|as\b|sea\b)/,
    ];

    // Kısa sohbet mesajları (15 karakter altı) ama soru işareti yoksa
    const kissaSohbet = soru.length < 15 && !soru.includes('?');

    return patterns.some(p => p.test(k)) || kissaSohbet;
}

/* ====== OPEN-METEO HAVA DURUMU (Dünya geneli) ====== */
async function getHavaDurumu(sehir) {
    try {
        const geoRes = await axios.get(
            `https://geocoding-api.open-meteo.com/v1/search`,
            {
                params: { name: sehir, count: 1, language: "tr", format: "json" },
                timeout: 6000,
            }
        );

        if (!geoRes.data.results?.length) return null;

        const { latitude, longitude, name, country } = geoRes.data.results[0];

        const weatherRes = await axios.get(
            `https://api.open-meteo.com/v1/forecast`,
            {
                params: {
                    latitude, longitude,
                    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                    daily: "weather_code,temperature_2m_max,temperature_2m_min",
                    timezone: "auto",
                    forecast_days: 3
                },
                timeout: 6000,
            }
        );

        const current = weatherRes.data.current;
        const daily   = weatherRes.data.daily;

        const wCodes = {
            0: "Açık ☀️", 1: "Parçalı bulutlu 🌤️", 2: "Bulutlu ⛅", 3: "Kapalı ☁️",
            45: "Sisli 🌫️", 48: "Donmuş sis 🌫️",
            51: "Çisenti 🌦️", 53: "Orta çisenti 🌧️", 55: "Yoğun çisenti 🌧️",
            61: "Hafif yağmur 🌧️", 63: "Yağmur 🌧️", 65: "Şiddetli yağmur 🌧️",
            71: "Hafif kar 🌨️", 73: "Kar 🌨️", 75: "Yoğun kar 🌨️",
            80: "Sağanak 🌦️", 81: "Orta sağanak 🌧️", 82: "Şiddetli sağanak ⛈️",
            95: "Gök gürültülü fırtına ⛈️", 96: "Dolu ⛈️", 99: "Şiddetli dolu ⛈️"
        };

        return {
            sehir: name,
            ulke: country,
            sicaklik: Math.round(current.temperature_2m),
            hissedilen: Math.round(current.apparent_temperature),
            nem: current.relative_humidity_2m,
            ruzgar: Math.round(current.wind_speed_10m),
            durum: wCodes[current.weather_code] || "Bilinmiyor",
            gunluk: daily.temperature_2m_max.map((max, i) => ({
                max: Math.round(max),
                min: Math.round(daily.temperature_2m_min[i]),
                durum: wCodes[daily.weather_code[i]] || "Bilinmiyor"
            })).slice(0, 3)
        };
    } catch (e) {
        console.log(`⚠️ Hava durumu hatası: ${e.message}`);
        return null;
    }
}

/* ======================================================
   ŞEHİR ÇIKARMA — Dünya geneli, liste yok
   Open-Meteo geocoding zaten tüm dünyayı destekliyor.
   ====================================================== */
function extractSehir(soru) {
    // Türkçe ek temizleme: "İstanbul'da", "Tokyo'nun" → "İstanbul", "Tokyo"
    const temizEk = soru.replace(/'[a-zçğışöşü]+/gi, '');

    // Kalıp 1: "X hava durumu", "X'in havası nasıl"
    const m1 = temizEk.match(/([A-Za-zÇĞİÖŞÜçğışöşü][A-Za-zÇĞİÖŞÜçğışöşü\s]{1,30})\s+(?:hava|weather)/i);
    if (m1) return m1[1].trim();

    // Kalıp 2: "hava durumu X", "weather in X"
    const m2 = temizEk.match(/(?:hava(?:\s*durumu)?|weather)\s+(?:in|at|of|için)?\s*([A-Za-zÇĞİÖŞÜçğışöşü][A-Za-zÇĞİÖŞÜçğışöşü\s]{1,30})/i);
    if (m2) return m2[1].trim();

    // Kalıp 3: büyük harfle başlayan kelime grubu (New York, Los Angeles, vb.)
    const m3 = soru.match(/([A-ZÇĞİÖŞÜ][a-zçğışöşü]+(?:\s[A-ZÇĞİÖŞÜ][a-zçğışöşü]+){0,2})/);
    if (m3) return m3[1].trim();

    return null;
}

/* ====== SERPER.DEV WEB ARAMA ====== */
async function webAra(sorgu, maxResults = 5) {
    try {
        const KEY = process.env.serper;
        if (!KEY) { console.log("⚠️ serper key yok"); return []; }

        const res = await axios.post("https://google.serper.dev/search",
            { q: sorgu, gl: "tr", hl: "tr", num: maxResults },
            { headers: { "X-API-KEY": KEY, "Content-Type": "application/json" }, timeout: 10000 }
        );

        return (res.data?.organic || [])
            .slice(0, maxResults)
            .map(r => ({ title: r.title || "", snippet: r.snippet || "", url: r.link || "" }))
            .filter(r => r.title.length > 3 && r.snippet.length > 10);
    } catch (e) {
        console.log(`⚠️ Serper hatası: ${e.message}`);
        return [];
    }
}

/* ====== WIKIPEDIA FALLBACK ====== */
async function wikipediaFallback(sorgu) {
    try {
        for (const lang of ["tr", "en"]) {
            const arama = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
                params: { action: "query", list: "search", srsearch: sorgu, srlimit: 2, format: "json", origin: "*" },
                timeout: 6000
            });

            const sayfalar = arama.data?.query?.search || [];
            const sonuclar = [];

            for (const sayfa of sayfalar.slice(0, 2)) {
                try {
                    const ozet = await axios.get(
                        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sayfa.title)}`,
                        { timeout: 5000 }
                    );
                    if (ozet.data.extract) sonuclar.push(`${ozet.data.title}: ${ozet.data.extract.slice(0, 400)}`);
                } catch {}
            }
            if (sonuclar.length) return sonuclar.join("\n");
        }
    } catch (e) { console.log(`⚠️ Wikipedia hatası: ${e.message}`); }
    return "";
}

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = [
    "amk","amina","orospu","oc","sik","got","bok","yarrak","pic","sikerim",
    "orospu cocugu","geriзekalı","salak","kahpe","pezevenk",
    "yavsak","serefsiz","amcik","gavat","siktir",
    "keko","zibidi","moron","gerzek"
];

function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
        .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== DİL TEMİZLEME ====== */
function temizleDil(metin) {
    const yabanci = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0370-\u03ff\u0e00-\u0e7f\u0590-\u05ff]/g;
    const temiz = metin.replace(yabanci, '');
    return temiz.trim().length === 0 ? metin : temiz;
}

/* ======================================================
   CEVAP ÜRETME — Ana mantık
   ====================================================== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const normalSohbet = isNormalSohbet(soru);
    const mesajdaKufur = kufurVarMi(soru);

    // Önceki konuşmayı al — sohbet bağlamı için
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.slice(-3).map(h => `Kullanıcı: ${h.user}\nBot: ${h.bot}`).join("\n---\n")
        : "";

    let webSonucu = null;
    let tip = "sohbet";

    // ---- Araştırma gerektiren durumları tespit et ----
    if (!normalSohbet && !mesajdaKufur) {

        if (isHavaDurumuSorusu(soru)) {
            const sehir = extractSehir(soru) || "Istanbul";
            const hava = await getHavaDurumu(sehir);
            if (hava) {
                webSonucu = { tip: "hava", veri: hava };
                tip = "hava";
            } else {
                // Şehir bulunamadı, sohbete düş
                tip = "sohbet";
            }

        } else if (isGuncelBilgiSorusu(soru)) {
            const sorgu = soru.replace(/[?.!]/g, '').trim();
            const results = await webAra(sorgu, 5);
            if (results.length > 0) {
                webSonucu = { tip: "web", veri: results.map((r, i) => `[${i+1}] ${r.title}\n${r.snippet}`).join("\n\n") };
                tip = "arastirma";
            } else {
                const wiki = await wikipediaFallback(sorgu);
                if (wiki) { webSonucu = { tip: "wiki", veri: wiki }; tip = "arastirma"; }
            }

        } else if (isBilgiSorusu(soru)) {
            const sorgu = soru.replace(/[?.!]/g, '').trim();
            const wiki = await wikipediaFallback(sorgu);
            if (wiki) { webSonucu = { tip: "wiki", veri: wiki }; tip = "arastirma"; }
        }
    }

    // ---- Prompt oluştur ----
    let sistemPrompt, kullaniciPrompt;

    if (mesajdaKufur) {
        /* Küfür → sadece kısa ve esprili geri laf,
           SORU SORMAZ, AÇIKLAMAZ, SADECE LAF SOKAR */
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Kullanıcı sana küfür etti. Kısa ve esprili Türkçe geri laf sok — 1-2 cümle yeterli.
KURAL: Sadece laf sok. Açıklama yapma, soru sorma, başka bir şey ekleme.
Sadece Türkçe yaz. Asla Çince, Japonca, Arapça, Rusça vb. kullanma.`;
        kullaniciPrompt = `Kullanıcının mesajı: "${soru}"`;

    } else if (tip === "hava") {
        const h = webSonucu.veri;
        /* Hava → sadece hava bilgisi, başka hiçbir şey */
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Aşağıdaki hava durumu verisini Türkçe, doğal ve samimi bir şekilde sun.
KURAL: Sadece hava bilgisini ver. Laf sokma, yorum yapma, espri ekleme.
Sadece Türkçe yaz.`;
        kullaniciPrompt =
            `Tarih: ${tarih}\n\n` +
            `📍 ${h.sehir}, ${h.ulke}\n` +
            `🌡️ Sıcaklık: ${h.sicaklik}°C (hissedilen: ${h.hissedilen}°C)\n` +
            `💧 Nem: %${h.nem}\n` +
            `💨 Rüzgar: ${h.ruzgar} km/s\n` +
            `☁️ Durum: ${h.durum}\n\n` +
            `3 Günlük Tahmin:\n` +
            h.gunluk.map((g, i) => `Gün ${i+1}: ${g.max}°C / ${g.min}°C — ${g.durum}`).join("\n");

    } else if (tip === "arastirma") {
        /* Araştırma → soruyu doğrudan yanıtla, fazladan yorum yok */
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Aşağıdaki web verilerini kullanarak kullanıcının sorusunu yanıtla.
KURALLAR:
- Sadece soruyu yanıtla, başka konu açma.
- Eğer veri yetersizse "Güncel bilgiye ulaşamadım." de.
- Madde madde özetle, gereksiz uzatma.
- Laf sokma, espri ekleme — sadece bilgi ver.
- Sadece Türkçe yaz.`;
        kullaniciPrompt = [
            `Tarih: ${tarih}`,
            gecmisMetin ? `Önceki konuşma:\n${gecmisMetin}` : "",
            `Web verileri:\n${webSonucu.veri}`,
            `Kullanıcı sorusu: ${soru}`
        ].filter(Boolean).join("\n\n");

    } else {
        /* Normal sohbet — samimi, kısa, esprili
           AMA: Kullanıcı bir şey sorduysa önce o soruyu yanıtla,
           sohbeti o sorunun bağlamında sürdür */
        sistemPrompt = `Sen BatuBot adlı bir Discord botusun. Geliştirici: Batuhan.
Kullanıcıyla sıcak, samimi ve esprili sohbet et. Cevaplar kısa olsun (1-3 cümle).
ÖNEMLI KURALLAR:
1. Kullanıcı bir şey SORUYORSA → önce o soruyu yanıtla, sonra kısa espri/yorum ekleyebilirsin.
2. Kullanıcı sohbet ediyorsa → onunla oynayarak devam et, bağlamı koru.
3. Kullanıcı bir şeyi DÜZELTIYORSA (örn: "Yeva isim", "vida değil VİDA") → düzeltmeyi kabul et ve bağlamla devam et.
4. Asla konuyu zorla değiştirme veya alakasız bilgi ekleme.
5. Sadece Türkçe yaz (gerekirse İngilizce). Asla Çince, Japonca, Arapça, Rusça vb. kullanma.`;
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
            { model: MODEL_SMART, temperature: 0.75, max_tokens: 600 }
        );

        cevap = temizleDil(cevap);

        // Boş kaldıysa fallback
        if (!cevap || cevap.trim().length < 3) {
            if (tip === "hava" && webSonucu) {
                const h = webSonucu.veri;
                cevap = `**${h.sehir} Hava Durumu**\n🌡️ ${h.sicaklik}°C (hissedilen: ${h.hissedilen}°C)\n💧 Nem: %${h.nem}\n💨 Rüzgar: ${h.ruzgar} km/s\n☁️ ${h.durum}`;
            } else if (tip === "arastirma") {
                cevap = "Güncel bilgiye ulaşamadım, daha sonra tekrar dene.";
            } else {
                cevap = "Anladım 👍";
            }
        }

        // Hafızaya kaydet
        const yeniGecmis = [...gecmis, { user: soru, bot: cevap }];
        if (yeniGecmis.length > MAX_HISTORY) yeniGecmis.shift();
        memory.set(userId, yeniGecmis);

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
                await msg.author.send(`(${msg.guild?.name || "Sunucu"} kanalında mesaj iznim yok)\n\n${metin}`);
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
});

process.on("unhandledRejection", err => {
    console.error("🔥 Unhandled Rejection:", err?.message || err);
});

client.login(DISCORD_TOKEN);