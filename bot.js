const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.groq;
const DISCORD_TOKEN  = process.env.token;
const TAVILY_API_KEY = process.env.tavily || "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";

// API KEY kontrolu
if (!GROQ_API_KEY) {
    console.error("HATA: GROQ_API_KEY (groq) tanimli degil!");
    process.exit(1);
}
if (!DISCORD_TOKEN) {
    console.error("HATA: DISCORD_TOKEN (token) tanimli degil!");
    process.exit(1);
}

/* ====== MODELLER ====== */
const MODEL_FAST  = "llama-3.1-8b-instant";
const MODEL_SMART = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 5;

/* ====== RATE LIMIT ====== */
const groqQueue = [];
let groqProcessing = false;
let groqLastRequest = 0;
const GROQ_MIN_INTERVAL = 2500; // 2.5 saniye (daha guvenli)

const tavilyQueue = [];
let tavilyProcessing = false;
let tavilyLastRequest = 0;
const TAVILY_MIN_INTERVAL = 1000; // 1 saniye

const userCooldowns = new Map();
const USER_COOLDOWN_MS = 5000;

/* ====== KUFUR ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/g/g,"g").replace(/u/g,"u").replace(/s/g,"s")
        .replace(/i/g,"i").replace(/o/g,"o").replace(/c/g,"c");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== RETRY MEKANIZMASI ====== */
async function fetchWithRetry(url, options, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`API istegi: ${url} (deneme ${i + 1}/${maxRetries})`);
            const result = await axios(url, options);
            return result;
        } catch (err) {
            lastError = err;
            console.error(`API hatasi (deneme ${i + 1}/${maxRetries}):`, err.message);
            
            if (err.response) {
                console.error(`Status: ${err.response.status}`);
                console.error(`Data:`, JSON.stringify(err.response.data).substring(0, 200));
                
                // 401 - Unauthorized (API key yanlis)
                if (err.response.status === 401) {
                    throw new Error("API anahtari gecersiz. Lutfen GROQ_API_KEY veya TAVILY_API_KEY kontrol et.");
                }
                
                // 429 - Rate limit
                if (err.response.status === 429) {
                    const retryAfter = parseInt(err.response.headers['retry-after']) || (Math.pow(2, i) * 2000);
                    console.log(`Rate limit. ${retryAfter}ms bekleniyor...`);
                    await new Promise(r => setTimeout(r, retryAfter));
                    continue;
                }
                
                // 500, 502, 503, 504 - Server hatalari
                if (err.response.status >= 500) {
                    const wait = Math.pow(2, i) * 1000;
                    console.log(`Server hatasi. ${wait}ms bekleniyor...`);
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }
            }
            
            // Baglanti hatalari
            if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
                const wait = Math.pow(2, i) * 1500;
                console.log(`Baglanti hatasi (${err.code}). ${wait}ms bekleniyor...`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            
            // Diger hatalar - hemen fail et
            throw err;
        }
    }
    
    throw new Error(`Max retries reached. Son hata: ${lastError?.message || 'Bilinmeyen hata'}`);
}

/* ====== GROQ ====== */
async function processGroqQueue() {
    if (groqProcessing || groqQueue.length === 0) return;
    groqProcessing = true;

    const now = Date.now();
    const elapsed = now - groqLastRequest;
    if (elapsed < GROQ_MIN_INTERVAL) {
        await new Promise(r => setTimeout(r, GROQ_MIN_INTERVAL - elapsed));
    }

    const task = groqQueue.shift();
    try {
        groqLastRequest = Date.now();
        const result = await fetchWithRetry(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                method: 'POST',
                data: {
                    model: task.model,
                    messages: task.messages,
                    temperature: task.temperature,
                    max_tokens: task.max_tokens
                },
                headers: { 
                    Authorization: `Bearer ${GROQ_API_KEY}`, 
                    "Content-Type": "application/json" 
                },
                timeout: 30000
            }
        );
        task.resolve(result.data.choices[0].message.content.trim());
    } catch (err) {
        console.error("Groq isleme hatasi:", err.message);
        task.reject(err);
    }

    groqProcessing = false;
    processGroqQueue();
}

function groq(messages, options = {}) {
    return new Promise((resolve, reject) => {
        groqQueue.push({
            messages,
            model: options.model || MODEL_SMART,
            temperature: options.temperature || 0.1,
            max_tokens: options.max_tokens || 1500,
            resolve,
            reject
        });
        processGroqQueue();
    });
}

/* ====== TAVILY ====== */
async function processTavilyQueue() {
    if (tavilyProcessing || tavilyQueue.length === 0) return;
    tavilyProcessing = true;

    const now = Date.now();
    const elapsed = now - tavilyLastRequest;
    if (elapsed < TAVILY_MIN_INTERVAL) {
        await new Promise(r => setTimeout(r, TAVILY_MIN_INTERVAL - elapsed));
    }

    const task = tavilyQueue.shift();
    try {
        tavilyLastRequest = Date.now();
        const result = await fetchWithRetry(
            "https://api.tavily.com/search",
            {
                method: 'POST',
                data: {
                    api_key: TAVILY_API_KEY,
                    query: task.query,
                    search_depth: "basic",
                    max_results: 5,
                    include_answer: true
                },
                timeout: 20000
            }
        );
        
        const d = result.data;
        const sonuclar = [];
        
        if (d.answer && d.answer.length > 10) {
            sonuclar.push(`OZET: ${d.answer}`);
        }
        
        (d.results || []).forEach(r => {
            if (r.content?.trim().length > 30) {
                sonuclar.push(`[${r.title || "Kaynak"}]: ${r.content.slice(0, 400)}`);
            }
        });
        
        console.log(`Tavily basarili: ${sonuclar.length} sonuc`);
        task.resolve(sonuclar.join("\n\n") || null);
    } catch (err) {
        console.error("Tavily hatasi:", err.message);
        task.resolve(null); // Hata olsa bile devam et
    }

    tavilyProcessing = false;
    processTavilyQueue();
}

function tavilyAra(sorgular) {
    const sorgu = Array.isArray(sorgular) ? sorgular[0] : sorgular;
    console.log(`Arama sorgusu: "${sorgu}"`);
    return new Promise((resolve) => {
        tavilyQueue.push({ query: sorgu, resolve });
        processTavilyQueue();
    });
}

/* ====== PLAN ====== */
async function planHazirla(soru) {
    const prompt = `Soru analiz et. JSON dondur:
{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["en iyi arama sorgusu"]
}

Sadece selam, kufur, "nasilsin", "siir yaz" ise arama_gerekli: false.
Diger hersey icin true.

Soru: ${soru}

Sadece JSON, baska hicbir sey yazma.`;

    try {
        const raw = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 200 });
        const json = raw.match(/\{[\s\S]*\}/)?.[0];
        return json ? JSON.parse(json) : { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    } catch (err) {
        console.error("Plan hazirlama hatasi:", err.message);
        return { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    }
}

/* ====== CEVAP ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const kufur = kufurVarMi(soru);

    if (kufur) {
        return "Kufur etme lan gerizekali.";
    }
    
    const selamRegex = /^(selam|merhaba|naber|nasilsin|ne yapiyorsun|hey|hello)$/i;
    if (selamRegex.test(soru.trim())) {
        return "Selam! Ne ogrenmek istersin?";
    }

    let webVerisi = null;
    try {
        const plan = await planHazirla(soru);
        console.log(`Plan: ${JSON.stringify(plan)}`);
        
        if (plan.arama_gerekli) {
            webVerisi = await tavilyAra(plan.sorgular || [soru]);
        }
    } catch (err) {
        console.error("Arama asamasi hatasi:", err.message);
        // Arama hatasi olsa bile devam et
    }

    if (!webVerisi || webVerisi.length < 50) {
        const bilgiSorusu = /(kimdir|nedir|nerede|ne zaman|hangi|kac|nasil|grubu|sarkisi|album)/i.test(soru);
        if (bilgiSorusu) {
            return "Bu konuda guvenilir kaynaga ulasamadim. Daha spesifik sorabilir misin?";
        }
    }

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] K: ${h.user}\nB: ${h.bot}`).join("\n")
        : "";

    let sistemPrompt;
    if (webVerisi && webVerisi.length > 50) {
        sistemPrompt = `Sen Awe, Discord botu. Gelistiricin Batuhan. Tarih: ${tarih}.

KATI KURAL: Sadece asagidaki verideki bilgileri kullan. Veride yoksa "bilmiyorum" de.

Web Verisi:
${webVerisi}`;
    } else {
        sistemPrompt = `Sen Awe, Discord botu. Gelistiricin Batuhan. Tarih: ${tarih}. Samimi ve kisa konus. Bilmedigini soyleyebilirsin.`;
    }

    const kullaniciPrompt = gecmisMetin 
        ? `Onceki:\n${gecmisMetin}\n\nSoru: ${soru}`
        : `Soru: ${soru}`;

    try {
        const cevap = await groq(
            [
                { role: "system", content: sistemPrompt },
                { role: "user", content: kullaniciPrompt }
            ],
            { model: MODEL_SMART, temperature: 0.1, max_tokens: 800 }
        );

        const yeni = [...gecmis, { user: soru, bot: cevap }];
        if (yeni.length > MAX_HISTORY) yeni.shift();
        memory.set(userId, yeni);

        return cevap;
    } catch (err) {
        console.error("Cevap uretme hatasi:", err.message);
        return "Uzgunum, su an cevap veremiyorum. Lutfen daha sonra tekrar dene.";
    }
}

/* ====== MESAJ ====== */
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

async function guvenliGonder(msg, metin, ilk = true) {
    try {
        if (ilk) await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        else await msg.channel.send(metin);
    } catch (err) {
        console.error("Discord gonderme hatasi:", err.message);
        if (err.code === 50013) { 
            try { await msg.author.send(metin); } catch {} 
        }
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

    const now = Date.now();
    const lastUse = userCooldowns.get(msg.author.id) || 0;
    if (now - lastUse < USER_COOLDOWN_MS) {
        const wait = Math.ceil((USER_COOLDOWN_MS - (now - lastUse)) / 1000);
        return guvenliGonder(msg, `Cok hizli yaziyorsun. ${wait} saniye bekle.`);
    }
    userCooldowns.set(msg.author.id, now);

    msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(typing);
        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) await guvenliGonder(msg, parcalar[i], i === 0);
    } catch (err) {
        clearInterval(typing);
        console.error("Genel hata:", err);
        await guvenliGonder(msg, "Bir hata olustu. Lutfen tekrar dene.");
    }
});

client.once("ready", c => {
    console.log(`${c.user.tag} aktif`);
    console.log(`Tarih: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`Groq API: ${GROQ_API_KEY ? 'Tanimli' : 'TANIMLI DEGIL!'}`);
    console.log(`Tavily API: ${TAVILY_API_KEY ? 'Tanimli' : 'Tanimli degil'}`);
});

process.on("unhandledRejection", err => console.error("Unhandled:", err));

client.login(DISCORD_TOKEN).catch(err => {
    console.error("Discord login hatasi:", err.message);
    process.exit(1);
});