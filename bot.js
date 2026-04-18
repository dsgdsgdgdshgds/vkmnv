const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.groq;
const DISCORD_TOKEN  = process.env.token;
const TAVILY_API_KEY = process.env.tavily || "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";

if (!GROQ_API_KEY || !DISCORD_TOKEN) {
    console.error("HATA: GROQ_API_KEY veya DISCORD_TOKEN eksik!");
    process.exit(1);
}

/* ====== MODELLER ====== */
const MODEL_FAST  = "llama-3.1-8b-instant";  // 30 RPM
const MODEL_SMART = "llama-3.3-70b-versatile"; // 30 RPM - dikkatli kullan!

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 3; // Dusuruldu

/* ====== RATE LIMIT STATE ====== */
let groqRequestCount = 0;
let groqResetTime = Date.now() + 60000;
let groqQueue = [];
let isProcessingGroq = false;

const userCooldowns = new Map();
const USER_COOLDOWN_MS = 3000;

/* ====== KUFUR ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim","pezevenk","orosbu","sikik"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/g/g,"g").replace(/u/g,"u").replace(/s/g,"s")
        .replace(/i/g,"i").replace(/o/g,"o").replace(/c/g,"c")
        .replace(/ /g,"");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== BASIT RULE-BASED CEVAPLAR (Groq kullanmadan) ====== */
function basitCevap(soru) {
    const s = soru.toLowerCase().trim();
    
    // Selamlasma
    if (/^(selam|merhaba|hey|hello|hi|naber|nbr|selamm|merhabaa)$/i.test(s)) {
        return "Selam! Hos geldin. Ne ogrenmek istersin?";
    }
    
    // Nasilsin
    if (/nasilsin|nasılsın|naber|ne haber/i.test(s) && s.length < 20) {
        return "Iyiyim, tesekkurler! Sen nasilsin?";
    }
    
    // Ne yapiyorsun
    if (/ne yapiyorsun|ne yapıyorsun|napıyosun|napıyorsun/i.test(s)) {
        return "Mesajlari okuyup cevap vermeye calisiyorum. Sen ne yapiyorsun?";
    }
    
    // Kimsin
    if (/kimsin|sen kimsin|sen nesin/i.test(s)) {
        return "Ben Awe, Discord botuyum. Gelistiricim Batuhan. Arama yapip bilgi verebilirim.";
    }
    
    // Tesekkur
    if (/tesekkur|teşekkür|sagol|sağol|tesekkurler/i.test(s)) {
        return "Rica ederim! Baska bir sey ogrenmek istersen buradayim.";
    }
    
    // Gule gule
    if (/gule gule|görüşürüz|gorusuruz|bay|bay bay|cik|cikiyorum|cikicam/i.test(s)) {
        return "Gule gule! Tekrar gorusmek uzere.";
    }
    
    // Saat
    if (/saat kac|saat kaç|saat$/i.test(s)) {
        return `Su an saat ${new Date().toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul'})}.`;
    }
    
    // Tarih
    if (/bugun ayin kaci|bugün ayın kaçı|tarih ne|tarih$/i.test(s)) {
        return `Bugun ${new Date().toLocaleDateString('tr-TR', {timeZone: 'Europe/Istanbul'})}.`;
    }
    
    return null; // Groq gerekiyor
}

/* ====== GROQ RATE LIMIT YONETIMI ====== */
async function checkGroqLimit() {
    const now = Date.now();
    if (now > groqResetTime) {
        groqRequestCount = 0;
        groqResetTime = now + 60000;
        console.log("Groq limit resetlendi");
    }
    
    if (groqRequestCount >= 25) { // 30 yerine 25 - guvenli margin
        const wait = groqResetTime - now;
        console.log(`Groq limit dolu. ${Math.ceil(wait/1000)}sn bekleniyor...`);
        await new Promise(r => setTimeout(r, wait + 1000));
        return checkGroqLimit(); // Recursive kontrol
    }
}

async function groqCall(messages, options = {}) {
    await checkGroqLimit();
    
    const model = options.model || MODEL_FAST; // Varsayilan olarak hizli model
    const maxRetries = 5;
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            groqRequestCount++;
            console.log(`Groq istek #${groqRequestCount} (deneme ${i+1})`);
            
            const res = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model: model,
                    messages: messages,
                    temperature: options.temperature ?? 0.1,
                    max_tokens: options.max_tokens || 1000
                },
                {
                    headers: { 
                        Authorization: `Bearer ${GROQ_API_KEY}`, 
                        "Content-Type": "application/json" 
                    },
                    timeout: 25000
                }
            );
            
            return res.data.choices[0].message.content.trim();
            
        } catch (err) {
            lastError = err;
            console.error(`Groq hata ${i+1}/${maxRetries}:`, err.message, err.response?.status);
            
            if (err.response?.status === 429) {
                const retryAfter = parseInt(err.response.headers['retry-after']) || 5000;
                console.log(`429 alindi. ${retryAfter}ms bekleniyor...`);
                await new Promise(r => setTimeout(r, retryAfter + 1000));
                groqRequestCount = Math.max(0, groqRequestCount - 1); // Bu denemeyi sayma
                continue;
            }
            
            if (err.response?.status === 401) {
                throw new Error("API key gecersiz!");
            }
            
            if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
                await new Promise(r => setTimeout(r, 2000 * (i + 1)));
                continue;
            }
            
            // Diger hatalar
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    
    throw new Error(`Max retries reached: ${lastError?.message}`);
}

/* ====== TAVILY ====== */
let tavilyLastCall = 0;
const TAVILY_COOLDOWN = 2000; // 2 saniye

async function tavilyAra(sorgu) {
    const now = Date.now();
    const elapsed = now - tavilyLastCall;
    if (elapsed < TAVILY_COOLDOWN) {
        await new Promise(r => setTimeout(r, TAVILY_COOLDOWN - elapsed));
    }
    
    try {
        tavilyLastCall = Date.now();
        console.log(`Tavily arama: "${sorgu}"`);
        
        const res = await axios.post(
            "https://api.tavily.com/search",
            {
                api_key: TAVILY_API_KEY,
                query: sorgu,
                search_depth: "basic",
                max_results: 5,
                include_answer: true
            },
            { timeout: 15000 }
        );
        
        const d = res.data;
        let sonuc = "";
        
        if (d.answer && d.answer.length > 10 && !d.answer.includes("I don't know")) {
            sonuc += `OZET: ${d.answer}\n\n`;
        }
        
        (d.results || []).slice(0, 3).forEach(r => {
            if (r.content?.length > 20) {
                sonuc += `[${r.title}]: ${r.content.slice(0, 300)}\n`;
            }
        });
        
        return sonuc || null;
        
    } catch (err) {
        console.error("Tavily hatasi:", err.message);
        return null;
    }
}

/* ====== ANA CEVAP FONKSIYONU ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    
    // 1. Kufur kontrolu
    if (kufurVarMi(soru)) {
        return "Kufur etme lan gerizekali.";
    }
    
    // 2. Basit cevap (Groq kullanmadan)
    const basit = basitCevap(soru);
    if (basit) {
        console.log("Basit cevap donduruldu (Groq kullanilmadi)");
        return basit;
    }
    
    // 3. Bilgi sorusu mu kontrol et (regex ile)
    const bilgiSorusu = /(kimdir|nedir|nerede|ne zaman|hangi|kac|nasil|grubu|sarkisi|album|kurucu|uyesi|tarih|neden|nasıl)/i.test(soru);
    const aramaGerekli = bilgiSorusu && soru.length > 10;
    
    let webVerisi = null;
    
    // 4. Arama yap (eger gerekliyse)
    if (aramaGerekli) {
        // Arama sorgusunu basitlestir - direk soruyu kullan
        const aramaSorgusu = soru.replace(/[?¿]/g, "").trim();
        webVerisi = await tavilyAra(aramaSorgusu);
    }
    
    // 5. Groq prompt hazirla
    const gecmis = memory.get(userId) || [];
    const gecmisText = gecmis.map(h => `K: ${h.user}\nB: ${h.bot}`).join("\n\n");
    
    let prompt;
    if (webVerisi && webVerisi.length > 50) {
        prompt = `Sen Awe, Discord botu. Gelistiricin Batuhan. Tarih: ${tarih}.

KATI KURAL: Sadece asagidaki web verisindeki bilgileri kullan. Emin degilsen "bilmiyorum" de. Uydurma.

Web Verisi:
${webVerisi}

${gecmisText ? `Onceki konusma:\n${gecmisText}\n\n` : ""}Soru: ${soru}`;
    } else {
        prompt = `Sen Awe, Discord botu. Gelistiricin Batuhan. Tarih: ${tarih}.

Kurallar:
1) Samimi ve kisa konus (max 2 cumle)
2) Sadece Turkce
3) Bilmedigini soyleyebilirsin
4) "HOST" gibi ozel isimlerde kararsiz kalirsan "bu konuda net bilgim yok" de

${gecmisText ? `Onceki konusma:\n${gecmisText}\n\n` : ""}Soru: ${soru}`;
    }
    
    // 6. Groq cagrisi (tek seferde)
    try {
        const cevap = await groqCall(
            [{ role: "user", content: prompt }],
            { model: MODEL_FAST, max_tokens: 600 } // Hizli model, kisa cevap
        );
        
        // 7. Hafiza guncelle
        const yeni = [...gecmis, { user: soru, bot: cevap }];
        if (yeni.length > MAX_HISTORY) yeni.shift();
        memory.set(userId, yeni);
        
        return cevap;
        
    } catch (err) {
        console.error("Groq cagri hatasi:", err.message);
        
        // Fallback cevaplar
        if (webVerisi) {
            return "Arama sonuclarini isleyemedim. Daha sonra tekrar dene.";
        }
        return "Su an cok mesgulim. Birazdan tekrar sorar misin?";
    }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

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
        if (err.code === 50013) { 
            try { await msg.author.send(metin); } catch {} 
        }
    }
}

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
        return guvenliGonder(msg, `Cok hizli yaziyorsun. ${wait}sn bekle.`);
    }
    userCooldowns.set(msg.author.id, now);

    // Typing indicator
    msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 5000);

    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(typing);
        
        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) {
            await guvenliGonder(msg, parcalar[i], i === 0);
        }
    } catch (err) {
        clearInterval(typing);
        console.error("Genel hata:", err);
        await guvenliGonder(msg, "Bir hata olustu. Lutfen tekrar dene.");
    }
});

client.once("ready", c => {
    console.log(`${c.user.tag} aktif!`);
    console.log(`Groq: 25 RPM limit (guvenli margin)`);
    console.log(`Basit cevaplar: Groq kullanilmadan`);
});

process.on("unhandledRejection", err => console.error("Unhandled:", err));

client.login(DISCORD_TOKEN);