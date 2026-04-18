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
const MODEL_FAST  = "llama-3.1-8b-instant";  // 30 RPM, 14,400 RPD
const MODEL_SMART = "llama-3.3-70b-versatile"; // 30 RPM, 1,000 RPD

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 5;

/* ====== RATE LIMIT YONETIMI ====== */
// Groq: 30 RPM (2 saniyede 1 istek)
const groqQueue = [];
let groqProcessing = false;
let groqLastRequest = 0;
const GROQ_MIN_INTERVAL = 2100; // 2.1 saniye (güvenli margin)

// Tavily: 100 RPM (0.6 saniyede 1 istek)
const tavilyQueue = [];
let tavilyProcessing = false;
let tavilyLastRequest = 0;
const TAVILY_MIN_INTERVAL = 700; // 0.7 saniye

// Kullanici bazli rate limit
const userCooldowns = new Map();
const USER_COOLDOWN_MS = 5000; // 5 saniye

/* ====== KUFUR TESPITI ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/g/g,"g").replace(/u/g,"u").replace(/s/g,"s")
        .replace(/i/g,"i").replace(/o/g,"o").replace(/c/g,"c");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== EXPONENTIAL BACKOFF ====== */
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await axios(url, options);
        } catch (err) {
            if (err.response?.status === 429) {
                const retryAfter = parseInt(err.response.headers['retry-after']) || Math.pow(2, i) * 1000;
                console.log(`429 hatasi, ${retryAfter}ms bekleniyor... (deneme ${i + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, retryAfter));
            } else if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
                const wait = Math.pow(2, i) * 1000;
                console.log(`Baglanti hatasi, ${wait}ms bekleniyor...`);
                await new Promise(r => setTimeout(r, wait));
            } else {
                throw err;
            }
        }
    }
    throw new Error('Max retries reached');
}

/* ====== GROQ RATE LIMITER ====== */
async function processGroqQueue() {
    if (groqProcessing || groqQueue.length === 0) return;
    groqProcessing = true;

    const now = Date.now();
    const elapsed = now - groqLastRequest;
    
    if (elapsed < GROQ_MIN_INTERVAL) {
        const wait = GROQ_MIN_INTERVAL - elapsed;
        await new Promise(r => setTimeout(r, wait));
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
        console.error("Groq hatasi:", err.message);
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
            temperature: options.temperature || 0.6,
            max_tokens: options.max_tokens || 1500,
            resolve,
            reject
        });
        processGroqQueue();
    });
}

/* ====== TAVILY RATE LIMITER ====== */
async function processTavilyQueue() {
    if (tavilyProcessing || tavilyQueue.length === 0) return;
    tavilyProcessing = true;

    const now = Date.now();
    const elapsed = now - tavilyLastRequest;
    
    if (elapsed < TAVILY_MIN_INTERVAL) {
        const wait = TAVILY_MIN_INTERVAL - elapsed;
        await new Promise(r => setTimeout(r, wait));
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
        if (d.answer) sonuclar.push(`Ozet: ${d.answer}`);
        (d.results || []).forEach(r => {
            if (r.content?.trim().length > 30)
                sonuclar.push(`[${r.title || "Kaynak"} - ${r.url}]:\n${r.content.slice(0, 600)}`);
        });
        
        console.log(`Tavily: ${sonuclar.length} kaynak`);
        task.resolve(sonuclar.join("\n\n"));
    } catch (err) {
        console.log(`Tavily hata: ${err.message}`);
        task.resolve("");
    }

    tavilyProcessing = false;
    processTavilyQueue();
}

function tavilyAra(sorgular) {
    const sorgu = Array.isArray(sorgular) ? sorgular[0] : sorgular;
    console.log(`Arama: ${sorgu}`);
    
    return new Promise((resolve) => {
        tavilyQueue.push({ query: sorgu, resolve });
        processTavilyQueue();
    });
}

/* ====== ARAMA PLANI ====== */
async function planHazirla(soru) {
    const prompt = `Sen bir arama motoru uzmanisin. Kullanicinin sorusunu analiz et ve en iyi tek arama sorgusunu uret.

JSON formatinda dondur:
{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["tek en iyi sorgu"]
}

ARAMA GEREKSIZ (false) - SADECE BUNLAR:
- Selamlasma, kufur, argo, "nasilsin", "ne yapiyorsun" gibi sohbet
- "siir yaz", "fikra anlat" gibi yaratci istekler
Diger HER sey icin arama_gerekli: true.

EN IYI SORGU NASIL URETILIR:
- Sorudaki ozel isimleri, grup/kisi adlarini AYNEN kullan
- Turkce soru ise Ingilizce sorgu uret - Ingilizce kaynaklar daha zengin
- Muzik: "band name most popular songs founder" seklinde yaz
- Haber/guncel: Turkce yaz, tarihi ekle
- Spesifik ve kisa tut (5-8 kelime ideal)
- Sadece JSON dondur, baska hicbir sey yazma.

SORU: ${soru}`;

    try {
        const raw = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 300 });
        const json = raw.match(/\{[\s\S]*\}/)?.[0];
        return json ? JSON.parse(json) : { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    } catch {
        return { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    }
}

/* ====== CEVAP URET ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = await planHazirla(soru);
    const webVerisi = plan.arama_gerekli ? await tavilyAra(plan.sorgular || plan.sorgu) : "";

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] Kullanici: ${h.user}\nAwe: ${h.bot}`).join("\n")
        : "";

    const kufur = kufurVarMi(soru);

    let sistemPrompt;
    if (kufur) {
        sistemPrompt = "Sen Awe adinda bir Discord botusun, gelistiricin Batuhan. Kullanici sana kufur etti. Turkce kufurle kisa ve sert geri don (1-2 cumle).";
    } else if (webVerisi) {
        sistemPrompt = `Sen Awe adinda Discord botusun. Gelistiricin Batuhan. Bugun: ${tarih}. KURALLAR: 1) Sadece asagidaki web verisinde yazanlari soyle. 2) Web verisinde olmayan hicbir seyi UYDURMA veya tahmin etme - bulamadiysan "bu konuda guvenilir bilgiye ulasamadim" de. 3) Siyasi gorus KATMA. 5) Discord formati: **kalin**.`;
    } else {
        sistemPrompt = `Sen Awe adinda Discord botusun. Gelistiricin Batuhan. Bugun: ${tarih}. KURALLAR: 1) Samimi ve kisa konus. 2) SADECE Turkce kelime kullan, tek bir yabanci kelime bile yazma. 3) Siyasi yorum yapma. 4) Liste veya baslik kullanma.`;
    }

    const kullaniciPrompt = [
        gecmisMetin ? `Gecmis konusma:\n${gecmisMetin}` : "",
        webVerisi   ? `Web'den gelen guncel veri:\n${webVerisi}` : "",
        `Kullanici mesaji: ${soru}`
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

/* ====== MESAJ BOLUCU ====== */
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

/* ====== GUVENLI GONDER ====== */
async function guvenliGonder(msg, metin, ilk = true) {
    try {
        if (ilk) await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        else     await msg.channel.send(metin);
    } catch (err) {
        if (err.code === 50013) { try { await msg.author.send(metin); } catch {} }
        else console.error("Mesaj gonderilemedi:", err.message);
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

    // Kullanici cooldown kontrolu
    const now = Date.now();
    const lastUse = userCooldowns.get(msg.author.id) || 0;
    if (now - lastUse < USER_COOLDOWN_MS) {
        const wait = Math.ceil((USER_COOLDOWN_MS - (now - lastUse)) / 1000);
        return guvenliGonder(msg, `Cok hizli mesaj atiyorsun. ${wait} saniye bekle.`);
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
        console.error("Hata:", err.message);
        if (err.response?.status === 429) {
            await guvenliGonder(msg, "Cok fazla istek atildi, lutfen biraz bekleyin.");
        } else {
            await guvenliGonder(msg, "Bir sorun olustu, tekrar dene.");
        }
    }
});

client.once("clientReady", c => {
    console.log(`${c.user.tag} aktif - Model: ${MODEL_SMART}`);
    console.log(`${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`Gelistirici: Batuhan | Bot: Awe`);
    console.log(`Rate limit: Groq 30 RPM, Tavily 100 RPM`);
});

process.on("unhandledRejection", err => console.error("Hata:", err?.message || err));

client.login(DISCORD_TOKEN);