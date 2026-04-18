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
const MODEL_FAST  = "llama-3.1-8b-instant";
const MODEL_SMART = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 5;

/* ====== RATE LIMIT ====== */
const groqQueue = [];
let groqProcessing = false;
let groqLastRequest = 0;
const GROQ_MIN_INTERVAL = 2100;

const tavilyQueue = [];
let tavilyProcessing = false;
let tavilyLastRequest = 0;
const TAVILY_MIN_INTERVAL = 700;

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

/* ====== RETRY ====== */
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await axios(url, options);
        } catch (err) {
            if (err.response?.status === 429) {
                const retryAfter = parseInt(err.response.headers['retry-after']) || Math.pow(2, i) * 1000;
                console.log(`429, ${retryAfter}ms bekleniyor...`);
                await new Promise(r => setTimeout(r, retryAfter));
            } else if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
                const wait = Math.pow(2, i) * 1000;
                await new Promise(r => setTimeout(r, wait));
            } else {
                throw err;
            }
        }
    }
    throw new Error('Max retries reached');
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
            temperature: options.temperature || 0.1, // Daha dusuk = daha az uydurma
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
                    max_results: 8,
                    include_answer: true
                },
                timeout: 20000
            }
        );
        
        const d = result.data;
        // Guvenilirlik kontrolu
        const sonuclar = [];
        if (d.answer && d.answer.length > 20 && !d.answer.includes("I don't know") && !d.answer.includes("I couldn't find")) {
            sonuclar.push(`OZET: ${d.answer}`);
        }
        
        (d.results || []).forEach(r => {
            if (r.content?.trim().length > 50 && r.score > 0.5) { // Sadece yuksek skorlu sonuclar
                sonuclar.push(`[${r.title || "Kaynak"} - ${r.url}]: ${r.content.slice(0, 500)}`);
            }
        });
        
        console.log(`Tavily: ${sonuclar.length} kaynak`);
        task.resolve(sonuclar.join("\n\n") || null);
    } catch (err) {
        console.log(`Tavily hata: ${err.message}`);
        task.resolve(null);
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

Kurallar:
- Sorudaki OZEL ISIMLERI (grup adi, kisi adi) oldugu gibi kullan
- "X grubu hakkinda bilgi" ise "X band members history" gibi Ingilizce sorgu uret
- Kisa ve spesifik tut (5-8 kelime)

Soru: ${soru}

Sadece JSON, baska hicbir sey yazma.`;

    try {
        const raw = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 200 });
        const json = raw.match(/\{[\s\S]*\}/)?.[0];
        return json ? JSON.parse(json) : { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    } catch {
        return { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    }
}

/* ====== CEVAP ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const kufur = kufurVarMi(soru);

    // 1. Sohbet/kufur ise direkt cevap
    if (kufur) {
        return "Kufur etme lan gerizekali.";
    }
    
    // Basit selamlasma kontrolu
    const selamRegex = /^(selam|merhaba|naber|nasilsin|ne yapiyorsun|hey|hello)$/i;
    if (selamRegex.test(soru.trim())) {
        return "Selam! Ne ogrenmek istersin?";
    }

    // 2. Arama plani olustur
    const plan = await planHazirla(soru);
    
    // 3. Web aramasi yap (eger gerekliyse)
    let webVerisi = null;
    if (plan.arama_gerekli) {
        webVerisi = await tavilyAra(plan.sorgular || [soru]);
    }

    // 4. Web verisi yoksa veya bos ise
    if (!webVerisi || webVerisi.length < 100) {
        // Genel sohbet mi bilgi mi karar ver
        const bilgiSorusu = /(kimdir|nedir|nerede|ne zaman|hangi|kac|nasil|grubu|sarkisi|album)/i.test(soru);
        if (bilgiSorusu) {
            return "Bu konuda guvenilir kaynaga ulasamadim. Daha spesifik sorabilir misin?";
        }
        // Genel sohbet ise devam et
    }

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] Kullanici: ${h.user}\nBot: ${h.bot}`).join("\n")
        : "";

    // 5. Prompt olustur - KATI KURALLAR
    let sistemPrompt;
    if (webVerisi && webVerisi.length > 100) {
        sistemPrompt = `Sen Awe, Discord botu. Gelistiricin Batuhan. Tarih: ${tarih}.

KATI KURALLAR:
1) SADECE asagidaki web verisinde yazanlari kullan
2) Web verisinde YOKSA "bu konuda kaynagim yetersiz" de ve uydurma
3) Soruda "HOST" yaziyorsa, veride "HOST" gecmiyorsa yanlis bilgi verme
4) Kisa ve net cevap ver (2-3 cumle)
5) **kalin** format kullan

Web Verisi:
${webVerisi}`;
    } else {
        sistemPrompt = `Sen Awe, Discord botu. Gelistiricin Batuhan. Tarih: ${tarih}.

Kurallar:
1) Samimi ve kisa konus
2) Sadece Turkce
3) Bilmedigini soyleyebilirsin`;
    }

    const kullaniciPrompt = gecmisMetin 
        ? `Onceki konusma:\n${gecmisMetin}\n\nYeni soru: ${soru}`
        : `Soru: ${soru}`;

    const cevap = await groq(
        [
            { role: "system", content: sistemPrompt },
            { role: "user", content: kullaniciPrompt }
        ],
        { model: MODEL_SMART, temperature: 0.1, max_tokens: 800 }
    );

    // 6. Cevap kontrolu - uydurma var mi?
    const supheliKelimeler = ["sanirim", "galiba", "belki", "olabilir", "tahminimce", "muhtemelen"];
    const cevapKucuk = cevap.toLowerCase();
    if (supheliKelimeler.some(k => cevapKucuk.includes(k)) && webVerisi) {
        // Uydurma ihtimali yuksek, tekrar sor
        const duzeltPrompt = `Web verisinde net bilgi yoksa "tam emin degilim" de. Cevap: ${cevap}`;
        const duzeltilmis = await groq(
            [{ role: "user", content: duzeltPrompt }],
            { model: MODEL_FAST, temperature: 0.1, max_tokens: 300 }
        );
        return duzeltilmis;
    }

    // 7. Hafiza guncelle
    const yeni = [...gecmis, { user: soru, bot: cevap }];
    if (yeni.length > MAX_HISTORY) yeni.shift();
    memory.set(userId, yeni);

    return cevap;
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
        if (err.code === 50013) { try { await msg.author.send(metin); } catch {} }
        else console.error("Gonderme hatasi:", err.message);
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

    // Cooldown
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
        console.error("Hata:", err);
        await guvenliGonder(msg, "Bir sorun olustu, tekrar dene.");
    }
});

client.once("ready", c => {
    console.log(`${c.user.tag} aktif`);
    console.log(`Tarih: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
});

process.on("unhandledRejection", err => console.error("Hata:", err));

client.login(DISCORD_TOKEN);