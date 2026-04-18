const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_KEY      = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const MODEL_FAST    = "llama-3.1-8b-instant";
const MODEL_SMART   = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 8;

/* ====== GROQ YARDIMCI ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.7, max_tokens = 800 } = {}) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature, max_tokens },
        {
            headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
            timeout: 30000,
        }
    );
    return res.data.choices[0].message.content.trim();
}

/* ======================================================
   WEB ARAMA — Claude'un kendi API'si ile
   Bu endpoint artifact ortamında key gerektirmez,
   web_search tool built-in olarak çalışır
   ====================================================== */
async function webAra(sorgu) {
    try {
        const res = await axios.post(
            "https://api.anthropic.com/v1/messages",
            {
                model: "claude-haiku-4-5-20251001",
                max_tokens: 1024,
                tools: [{ type: "web_search_20250305", name: "web_search" }],
                messages: [{
                    role: "user",
                    content: `Search for current information and give a factual summary: ${sorgu}`
                }]
            },
            {
                headers: {
                    "x-api-key": process.env.anthropic || "",
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                timeout: 30000,
            }
        );

        // Tüm text bloklarını birleştir
        const textler = (res.data.content || [])
            .filter(b => b.type === "text")
            .map(b => b.text)
            .join("\n");

        if (textler && textler.length > 20) {
            console.log(`🔍 Web arama OK: ${textler.length} karakter`);
            return textler;
        }

        // stop_reason tool_use ise ikinci tur gerekiyor
        if (res.data.stop_reason === "tool_use") {
            const toolBlocks = res.data.content.filter(b => b.type === "tool_use");
            const toolResults = toolBlocks.map(tb => ({
                type: "tool_result",
                tool_use_id: tb.id,
                content: tb.output || ""
            }));

            const res2 = await axios.post(
                "https://api.anthropic.com/v1/messages",
                {
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 1024,
                    tools: [{ type: "web_search_20250305", name: "web_search" }],
                    messages: [
                        { role: "user", content: `Search for current information and give a factual summary: ${sorgu}` },
                        { role: "assistant", content: res.data.content },
                        { role: "user", content: toolResults }
                    ]
                },
                {
                    headers: {
                        "x-api-key": process.env.anthropic || "",
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    timeout: 30000,
                }
            );

            const textler2 = (res2.data.content || [])
                .filter(b => b.type === "text")
                .map(b => b.text)
                .join("\n");

            console.log(`🔍 Web arama (2. tur): ${textler2.length} karakter`);
            return textler2;
        }

    } catch (e) {
        console.log(`⚠️ Web arama hatası: ${e.response?.status} ${e.message}`);
    }
    return "";
}

/* ====== HAVA DURUMU — Open-Meteo (key yok) ====== */
async function getHavaDurumu(sehir) {
    try {
        const geo = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
            params: { name: sehir, count: 1, language: "tr", format: "json" },
            timeout: 6000,
        });
        if (!geo.data.results?.length) return null;
        const { latitude, longitude, name, country } = geo.data.results[0];

        const w = await axios.get("https://api.open-meteo.com/v1/forecast", {
            params: {
                latitude, longitude,
                current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                daily: "weather_code,temperature_2m_max,temperature_2m_min",
                timezone: "auto", forecast_days: 3
            },
            timeout: 6000,
        });

        const c = w.data.current, d = w.data.daily;
        const kodu = { 0:"Açık ☀️",1:"Az bulutlu 🌤️",2:"Parçalı ⛅",3:"Kapalı ☁️",
            45:"Sisli 🌫️",51:"Çisenti 🌦️",61:"Yağmur 🌧️",63:"Yağmur 🌧️",65:"Şiddetli yağmur 🌧️",
            71:"Kar 🌨️",73:"Kar 🌨️",75:"Yoğun kar ❄️",80:"Sağanak 🌦️",
            95:"Fırtına ⛈️",96:"Dolu ⛈️" };

        return {
            sehir: name, ulke: country,
            sicaklik: Math.round(c.temperature_2m),
            hissedilen: Math.round(c.apparent_temperature),
            nem: c.relative_humidity_2m,
            ruzgar: Math.round(c.wind_speed_10m),
            durum: kodu[c.weather_code] || "Bilinmiyor",
            gunluk: d.temperature_2m_max.map((max, i) => ({
                max: Math.round(max),
                min: Math.round(d.temperature_2m_min[i]),
                durum: kodu[d.weather_code[i]] || "?"
            })).slice(0, 3)
        };
    } catch (e) {
        console.log(`⚠️ Hava hatası: ${e.message}`);
        return null;
    }
}

/* ====== KÜFÜR ====== */
const KUFURLER = ["amk","amina","orospu","sik","got","bok","yarrak","pic","sikerim",
    "orospu cocugu","kahpe","pezevenk","yavsak","serefsiz","amcik","gavat","siktir","keko","gerzek"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase().replace(/ı/g,"i").replace(/ş/g,"s").replace(/ç/g,"c").replace(/ğ/g,"g").replace(/ö/g,"o").replace(/ü/g,"u");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== DİL TEMİZLEME ====== */
function temizleDil(metin) {
    const y = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0590-\u05ff]/g;
    const t = metin.replace(y, '');
    return t.trim().length < 3 ? metin : t;
}

/* ======================================================
   KARAR VERİCİ — llama-8b ile hızlı JSON karar
   ====================================================== */
async function kararVer(soru, gecmis) {
    const prompt = `Kullanıcı mesajını analiz et. SADECE JSON döndür, başka hiçbir şey yazma.

Format: {"action":"...","query":"...","city":"..."}

action seçenekleri:
- "chat"    → selamlama, sohbet, kişisel soru, subjektif
- "search"  → güncel bilgi (haberler, maç, fiyat, transfer, kur, borsa, son gelişme, gerçek dünya sorusu)  
- "weather" → hava durumu sorusu (city alanına şehri yaz)
- "insult"  → küfür/hakaret var

Şüphe durumunda "search" seç.
query: Google'a yazılacak Türkçe arama sorgusu
city: hava için şehir adı (İngilizce)

Önceki konuşma: ${gecmis || "(yok)"}
Kullanıcı: ${soru}`;

    try {
        const yanit = await groq(
            [{ role: "user", content: prompt }],
            { model: MODEL_FAST, temperature: 0.1, max_tokens: 80 }
        );
        const m = yanit.match(/\{[\s\S]*?\}/);
        if (!m) return { action: "chat" };
        const k = JSON.parse(m[0]);
        console.log(`🤔 Karar: ${JSON.stringify(k)}`);
        return k;
    } catch (e) {
        console.log(`⚠️ Karar hatası: ${e.message}`);
        return { action: "chat" };
    }
}

/* ======================================================
   ANA CEVAP FONKSİYONU
   ====================================================== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.slice(-3).map(h => `K: ${h.user} | B: ${h.bot}`).join(" || ");

    const kufurlu = kufurVarMi(soru);
    let action, aramaVerisi = "", hava = null;

    if (kufurlu) {
        action = "insult";
    } else {
        const karar = await kararVer(soru, gecmisMetin);
        action = karar.action || "chat";

        if (action === "search") {
            aramaVerisi = await webAra(karar.query || soru);
        } else if (action === "weather") {
            hava = await getHavaDurumu(karar.city || "Istanbul");
        }
    }

    // ---- Prompt oluştur ----
    let sistem, kullanici;

    if (action === "insult") {
        sistem = `Sen BatuBot Discord botusun. Kullanıcı küfür etti. 1-2 cümle esprili Türkçe geri laf sok. Başka hiçbir şey yazma.`;
        kullanici = `"${soru}"`;

    } else if (action === "weather" && hava) {
        sistem = `Sen BatuBot Discord botusun. Hava verisini doğal Türkçe ile sun. Emoji kullan. Sadece hava bilgisi, ekstra yorum yok.`;
        kullanici = `${tarih} | ${hava.sehir}, ${hava.ulke}: ${hava.sicaklik}°C (hissedilen ${hava.hissedilen}°C), Nem %${hava.nem}, Rüzgar ${hava.ruzgar}km/s, ${hava.durum}. 3 gün: ${hava.gunluk.map((g,i) => `Gün${i+1}: ${g.max}/${g.min}°C ${g.durum}`).join(", ")}`;

    } else if (action === "search") {
        sistem = `Sen BatuBot Discord botusun. Aşağıdaki web arama sonuçlarını kullanarak soruyu yanıtla. Net ve kısa ol (3-5 cümle). Veri yetersizse "Tam bilgiye ulaşamadım ama..." de. Sadece Türkçe.`;
        kullanici = [
            `Tarih: ${tarih}`,
            gecmisMetin ? `Önceki: ${gecmisMetin}` : "",
            aramaVerisi ? `Web sonuçları:\n${aramaVerisi}` : "Web araması boş döndü.",
            `Soru: ${soru}`
        ].filter(Boolean).join("\n\n");

    } else {
        sistem = `Sen BatuBot Discord botusun. Geliştirici: Batuhan. Samimi, sıcak, esprili sohbet et. Kısa cevaplar (1-3 cümle). Soru sorulursa önce yanıtla. Düzeltme gelirse kabul et. Sadece Türkçe.`;
        kullanici = [
            `Tarih: ${tarih}`,
            gecmisMetin ? `Önceki: ${gecmisMetin}` : "",
            `Kullanıcı: ${soru}`
        ].filter(Boolean).join("\n\n");
    }

    try {
        let cevap = await groq(
            [{ role: "system", content: sistem }, { role: "user", content: kullanici }],
            { model: MODEL_SMART, temperature: 0.75, max_tokens: 600 }
        );

        cevap = temizleDil(cevap);
        if (!cevap || cevap.length < 2) cevap = "Anlayamadım, tekrar yazar mısın? 🤔";

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
        else await msg.channel.send(metin);
    } catch (err) {
        if (err.code === 50013) {
            try { await msg.author.send(`(${msg.guild?.name} — izin yok)\n\n${metin}`); }
            catch { console.error("❌ DM de gönderilemedi."); }
        } else console.error("❌ Gönderilemedi:", err.message);
    }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot || msg.mentions.everyone || !msg.mentions.has(client.user)) return;
    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return guvenliGonder(msg, "Merhaba! Ne sormak istiyorsun? 🤖");

    msg.channel.sendTyping().catch(() => {});
    const ti = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);
    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(ti);
        const p = mesajlariBol(cevap);
        for (let i = 0; i < p.length; i++) await guvenliGonder(msg, p[i], i === 0);
    } catch (err) {
        clearInterval(ti);
        await guvenliGonder(msg, "⚠️ Bir sorun oluştu, lütfen tekrar dene.");
    }
});

client.once("ready", c => {
    console.log(`✅ ${c.user.tag} aktif | Groq: ${GROQ_KEY ? "✅" : "❌"}`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
});

process.on("unhandledRejection", err => console.error("🔥", err?.message || err));

client.login(DISCORD_TOKEN);