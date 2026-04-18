const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.groq;  // Düzeltildi: groq -> GROQ_API_KEY
const DISCORD_TOKEN  = process.env.token; // Düzeltildi: token -> DISCORD_TOKEN
const TAVILY_API_KEY = "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"; // Düzeltildi: sabit key kaldırıldı

// API Key kontrolü
if (!GROQ_API_KEY || !DISCORD_TOKEN) {
    console.error("❌ GROQ_API_KEY ve DISCORD_TOKEN gerekli!");
    process.exit(1);
}

/* ====== MODELLER ====== */
const MODEL_FAST  = "llama-3.1-8b-instant";
const MODEL_SMART = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 5;

/* ====== RATE LIMITING ====== */
const rateLimiter = new Map(); // Kullanıcı bazlı rate limit
const USER_COOLDOWN = 5000; // 5 saniye
const GLOBAL_TAVILY_COOLDOWN = 6000; // Tavily: 6 saniye (dakikada 10 istek)

let lastTavilyRequest = 0;

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim","orospu çocuğu","pezevenk","yavşak"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
        .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c")
        .replace(/[^a-z0-9\s]/g, ""); // Özel karakterleri temizle
    return KUFURLER.some(w => k.includes(w) || k.split(/\s+/).includes(w));
}

/* ====== GROQ ÇAĞRISI (Retry Mekanizmalı) ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.6, max_tokens = 1500, retries = 2 } = {}) {
    let lastError;
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                { model, messages, temperature, max_tokens },
                { 
                    headers: { 
                        Authorization: `Bearer ${GROQ_API_KEY}`, 
                        "Content-Type": "application/json" 
                    }, 
                    timeout: 30000 
                }
            );
            return res.data.choices[0].message.content.trim();
        } catch (e) {
            lastError = e;
            if (e.response?.status === 429) {
                const wait = Math.pow(2, i) * 1000 + Math.random() * 1000;
                console.log(`⏳ Groq rate limit, ${Math.round(wait)}ms bekleniyor...`);
                await new Promise(r => setTimeout(r, wait));
            } else if (i < retries) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
    throw lastError;
}

/* ====== ADIM 1: ARAMA PLANI ====== */
async function planHazirla(soru) {
    const prompt = `Sen bir arama motoru uzmanısın. Kullanıcının sorusunu analiz et.

JSON formatında döndür:
{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["en iyi sorgu"]
}

ARAMA GEREKSİZ (false):
- Selamlaşma, "nasılsın", "ne yapıyorsun", "şiir yaz", "fıkra anlat"
- Basit matematik, "2+2 kaç eder"
- Kişisel yaratıcı istekler

EN İYİ SORGU:
- Özel isimleri AYNEN kullan
- Türkçe soru → İngilizce sorgu (daha iyi sonuç)
- Müzik: "HOST band most popular song founder"
- Spesifik ve kısa (5-8 kelime)
- Sadece JSON, başka hiçbir şey yazma.

SORU: ${soru}`;

    try {
        const raw = await groq([{ role: "user", content: prompt }], { 
            model: MODEL_FAST, 
            temperature: 0.1, 
            max_tokens: 300 
        });
        const jsonMatch = raw.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) throw new Error("JSON bulunamadı");
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            tip: parsed.tip || "bilgi_sorgusu",
            arama_gerekli: parsed.arama_gerekli !== false,
            sorgular: Array.isArray(parsed.sorgular) ? parsed.sorgular : [soru]
        };
    } catch (e) {
        console.log("⚠️ Plan hatası:", e.message);
        return { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    }
}

/* ====== ADIM 2: TAVİLY WEB ARAMA (Geliştirilmiş) ====== */
async function tavilyAra(sorgular) {
    if (!TAVILY_API_KEY) {
        console.log("⚠️ TAVILY_API_KEY tanımlı değil");
        return "";
    }

    const sorgu = Array.isArray(sorgular) ? sorgular[0] : sorgular;
    if (!sorgu || sorgu.length < 2) return "";

    console.log(`🔍 Arama: ${sorgu}`);

    // Rate limit kontrolü
    const simdi = Date.now();
    const gecen = simdi - lastTavilyRequest;
    if (gecen < GLOBAL_TAVILY_COOLDOWN && lastTavilyRequest > 0) {
        const bekle = GLOBAL_TAVILY_COOLDOWN - gecen;
        console.log(`⏳ Tavily rate limit: ${Math.ceil(bekle/1000)}sn bekleniyor...`);
        await new Promise(r => setTimeout(r, bekle));
    }

    try {
        lastTavilyRequest = Date.now();
        const res = await axios.post(
            "https://api.tavily.com/search",
            {
                api_key: TAVILY_API_KEY,
                query: sorgu,
                search_depth: "basic",
                max_results: 8,
                include_answer: true,
                include_domains: [] // Güvenilir domainler eklenebilir
            },
            { timeout: 15000 }
        );
        
        const d = res.data;
        const sonuclar = [];
        
        if (d.answer && d.answer.length > 10) {
            sonuclar.push(`Özet: ${d.answer}`);
        }
        
        (d.results || []).slice(0, 5).forEach(r => {
            if (r.content?.trim().length > 20) {
                sonuclar.push(`[${r.title || "Kaynak"}]: ${r.content.slice(0, 600)}`);
            }
        });
        
        console.log(`✅ Tavily: ${sonuclar.length} kaynak`);
        return sonuclar.join("\n\n");
    } catch (e) {
        console.log(`⚠️ Tavily hata: ${e.response?.status || e.message}`);
        if (e.response?.status === 429) {
            lastTavilyRequest = Date.now() + 30000; // 30sn bekle
        }
        return "";
    }
}

/* ====== ADIM 3: CEVAP ÜRET ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    // Önce plan hazırla
    const plan = await planHazirla(soru);
    
    // Web araması yap (eğer gerekliyse)
    let webVerisi = "";
    if (plan.arama_gerekli) {
        webVerisi = await tavilyAra(plan.sorgular);
    }

    // Hafıza yönetimi
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] K: ${h.user}\nA: ${h.bot.slice(0, 200)}`).join("\n")
        : "";

    const kufur = kufurVarMi(soru);

    // Sistem promptu seçimi
    let sistemPrompt;
    if (kufur) {
        sistemPrompt = `Sen Awe, Discord botusun. Geliştiricin Batuhan. Kullanıcı sana küfür etti. Kısa, sert ama yaratıcı şekilde karşılık ver. 1-2 cümle, Türkçe.`;
    } else if (webVerisi) {
        sistemPrompt = `Sen Awe, Discord botusun. Geliştiricin Batuhan. Tarih: ${tarih}.

KURALLAR:
1) SADECE web verisindeki bilgileri kullan
2) UYDURMA - emin değilsen "bu konuda kesin bilgim yok" de
3) Siyasi yorum yapma
4) Format: **kalın** için markdown
5) Maksimum 3-4 cümle, öz ve net ol

Web verisi:
${webVerisi.slice(0, 2000)}`;
    } else {
        sistemPrompt = `Sen Awe, Discord botusun. Geliştiricin Batuhan. Tarih: ${tarih}.

KURALLAR:
1) Samimi ve kısa konuş (max 2-3 cümle)
2) SADECE Türkçe
3) Siyasi yorum yapma
4) Sohbet tarzında, doğal ol`;
    }

    const kullaniciPrompt = gecmisMetin 
        ? `Önceki konuşma:\n${gecmisMetin}\n\nŞimdi: ${soru}`
        : soru;

    try {
        const cevap = await groq([
            { role: "system", content: sistemPrompt },
            { role: "user", content: kullaniciPrompt }
        ], { 
            model: webVerisi ? MODEL_SMART : MODEL_FAST, 
            temperature: 0.7, 
            max_tokens: 800 
        });

        // Hafızaya kaydet
        const yeni = [...gecmis, { user: soru.slice(0, 100), bot: cevap.slice(0, 500) }];
        if (yeni.length > MAX_HISTORY) yeni.shift();
        memory.set(userId, yeni);

        return cevap;
    } catch (e) {
        console.error("Groq hatası:", e.message);
        return "Şu an yanıt üretemiyorum, birazdan tekrar dene.";
    }
}

/* ====== MESAJ BÖLÜCÜ ====== */
function mesajlariBol(metin, limit = 1950) {
    if (metin.length <= limit) return [metin];
    const parcalar = [];
    let kalan = metin;
    
    while (kalan.length > 0) {
        if (kalan.length <= limit) {
            parcalar.push(kalan.trim());
            break;
        }
        
        let kes = limit;
        // Önce çift yeni satır ara
        const p = kalan.lastIndexOf('\n\n', limit);
        if (p > limit * 0.5) kes = p;
        else {
            // Sonra tek yeni satır
            const s = kalan.lastIndexOf('\n', limit);
            if (s > limit * 0.5) kes = s;
            else {
                // Sonra nokta+boşluk
                const n = kalan.lastIndexOf('. ', limit);
                if (n > limit * 0.7) kes = n + 1;
            }
        }
        
        parcalar.push(kalan.slice(0, kes).trim());
        kalan = kalan.slice(kes).trim();
    }
    return parcalar;
}

/* ====== GÜVENLİ GÖNDER ====== */
async function guvenliGonder(msg, metin, ilk = true) {
    try {
        const options = { 
            content: metin, 
            allowedMentions: { repliedUser: false, everyone: false, roles: false } 
        };
        
        if (ilk) await msg.reply(options);
        else await msg.channel.send(options);
    } catch (err) {
        console.error("Mesaj gönderme hatası:", err.code, err.message);
        if (err.code === 50013) { // Missing permissions
            try { 
                await msg.author.send(metin); 
            } catch (dmErr) {
                console.error("DM de başarısız:", dmErr.message);
            }
        }
    }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;
    
    // Rate limit kontrolü
    const userId = msg.author.id;
    const simdi = Date.now();
    const sonKullanim = rateLimiter.get(userId) || 0;
    
    if (simdi - sonKullanim < USER_COOLDOWN) {
        const kalan = Math.ceil((USER_COOLDOWN - (simdi - sonKullanim)) / 1000);
        return guvenliGonder(msg, `⏱️ Lütfen ${kalan} saniye bekle.`);
    }
    rateLimiter.set(userId, simdi);

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return guvenliGonder(msg, "Ne sormak istiyorsun? 🎤");

    // Typing indicator
    await msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => {
        msg.channel.sendTyping().catch(() => {});
    }, 8000);

    try {
        const cevap = await cevapUret(userId, soru);
        clearInterval(typing);
        
        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) {
            await guvenliGonder(msg, parcalar[i], i === 0);
        }
    } catch (err) {
        clearInterval(typing);
        console.error("❌ Ana hata:", err);
        await guvenliGonder(msg, "Bir sorun oluştu 😅 Tekrar dene.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} aktif`);
    console.log(`🧠 Model: ${MODEL_SMART}`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan | Bot: Awe`);
    console.log(`🔑 Tavily: ${TAVILY_API_KEY ? "Aktif" : "Devre dışı"}`);
});

process.on("unhandledRejection", err => {
    console.error("🔥 Unhandled:", err?.message || err);
});

process.on("uncaughtException", err => {
    console.error("💥 Uncaught:", err?.message || err);
    // Bot çökmesin ama logla
});

client.login(DISCORD_TOKEN);