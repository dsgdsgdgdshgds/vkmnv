const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY   = process.env.groq;
const DISCORD_TOKEN  = process.env.token;
const TAVILY_API_KEY = "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";

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
const rateLimiter = new Map();
const USER_COOLDOWN = 5000;

let lastTavilyRequest = 0;
const TAVILY_COOLDOWN = 6000;

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim","orospu çocuğu","pezevenk","yavşak"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
        .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c")
        .replace(/[^a-z0-9\s]/g, "");
    return KUFURLER.some(w => k.includes(w) || k.split(/\s+/).includes(w));
}

/* ====== GROQ ÇAĞRISI ====== */
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
    const prompt = `Sen bir arama motoru uzmanısın. Kullanıcının sorusunu analiz et ve en iyi tek arama sorgusunu üret.

JSON formatında döndür:
{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["tek en iyi sorgu"]
}

ARAMA GEREKSİZ (false) — SADECE BUNLAR:
- Selamlaşma, küfür, argo, "nasılsın", "ne yapıyorsun" gibi sohbet
- "şiir yaz", "fıkra anlat" gibi yaratıcı istekler
Diğer HER şey için arama_gerekli: true.

EN İYİ SORGU NASIL ÜRETILIR:
- Sorudaki özel isimleri, grup/kişi adlarını AYNEN kullan
- Türkçe soru ise İngilizce sorgu üret — İngilizce kaynaklar daha zengin
- Müzik: "band name most popular songs founder" şeklinde yaz
- Haber/güncel: Türkçe yaz, tarihi ekle
- Spesifik ve kısa tut (5-8 kelime ideal)
- Sadece JSON döndür, başka hiçbir şey yazma.

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

/* ====== ADIM 2: TAVİLY WEB ARAMA ====== */
async function tavilyAra(sorgular) {
    const sorgu = Array.isArray(sorgular) ? sorgular[0] : sorgular;
    console.log(`🔍 Arama: ${sorgu}`);

    const simdi = Date.now();
    const gecen = simdi - lastTavilyRequest;
    if (gecen < TAVILY_COOLDOWN && lastTavilyRequest > 0) {
        const bekle = TAVILY_COOLDOWN - gecen;
        console.log(`⏳ Rate limit: ${Math.ceil(bekle/1000)}sn bekleniyor...`);
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
                max_results: 10,
                include_answer: true
            },
            { timeout: 20000 }
        );
        
        const d = res.data;
        const sonuclar = [];
        if (d.answer) sonuclar.push(`Özet: ${d.answer}`);
        (d.results || []).slice(0, 3).forEach(r => {
            if (r.content?.trim().length > 30)
                sonuclar.push(`[${r.title || "Kaynak"} — ${r.url}]: ${r.content.slice(0, 400)}`);
        });
        
        console.log(`✅ Tavily: ${sonuclar.length} kaynak`);
        return sonuclar.join("\n\n");
    } catch (e) {
        console.log(`⚠️ Tavily hata: ${e.response?.status || e.message}`);
        if (e.response?.status === 429) {
            lastTavilyRequest = Date.now() + 30000;
        }
        return "";
    }
}

/* ====== ADIM 3: CEVAP ÜRET (KISA) ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = await planHazirla(soru);
    const webVerisi = plan.arama_gerekli ? await tavilyAra(plan.sorgular) : "";

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] K: ${h.user}\nA: ${h.bot}`).join("\n")
        : "";

    const kufur = kufurVarMi(soru);

    let sistemPrompt;
    if (kufur) {
        sistemPrompt = `Sen Awe adında bir Discord botusun. Kullanıcı sana küfür etti. Türkçe, kısa ve sert geri dön. Max 1-2 cümle.`;
    } else if (webVerisi) {
        sistemPrompt = `Sen Awe, Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.

KURALLAR:
1) Sadece web verisindeki bilgileri kullan
2) UYDURMA - yoksa "bilmiyorum" de
3) **KISA VE ÖZ** - Max 2-3 cümle
4) Sadece cevap ver, açıklama yapma
5) Markdown kullanma, düz yaz

Web verisi:
${webVerisi.slice(0, 1500)}`;
    } else {
        sistemPrompt = `Sen Awe, Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.

KURALLAR:
1) Samimi ve ultra kısa konuş (1-2 cümle)
2) SADECE Türkçe
3) Siyasi yorum yapma
4) Liste/başlık yok, düz metin`;
    }

    const kullaniciPrompt = [
        gecmisMetin ? `Geçmiş:\n${gecmisMetin}` : "",
        `Soru: ${soru}`
    ].filter(Boolean).join("\n\n");

    try {
        const cevap = await groq([
            { role: "system", content: sistemPrompt },
            { role: "user", content: kullaniciPrompt }
        ], { 
            model: MODEL_SMART, 
            temperature: 0.5, 
            max_tokens: 300  // Düşürüldü - kısa yanıt
        });

        // Hafızaya kaydet (kısa tut)
        const yeni = [...gecmis, { user: soru.slice(0, 80), bot: cevap.slice(0, 200) }];
        if (yeni.length > MAX_HISTORY) yeni.shift();
        memory.set(userId, yeni);

        return cevap;
    } catch (e) {
        console.error("Groq hatası:", e.message);
        return "Şu an cevap veremiyorum.";
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
        const p = kalan.lastIndexOf('\n\n', limit);
        if (p > limit * 0.6) kes = p;
        else { 
            const s = kalan.lastIndexOf('\n', limit); 
            if (s > limit * 0.6) kes = s; 
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
            allowedMentions: { repliedUser: false } 
        };
        
        if (ilk) await msg.reply(options);
        else await msg.channel.send(options);
    } catch (err) {
        console.error("Mesaj hatası:", err.code, err.message);
        if (err.code === 50013) { 
            try { await msg.author.send(metin); } catch {} 
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
    
    // Rate limit
    const userId = msg.author.id;
    const simdi = Date.now();
    const sonKullanim = rateLimiter.get(userId) || 0;
    
    if (simdi - sonKullanim < USER_COOLDOWN) {
        const kalan = Math.ceil((USER_COOLDOWN - (simdi - sonKullanim)) / 1000);
        return guvenliGonder(msg, `⏱️ ${kalan}sn bekle.`);
    }
    rateLimiter.set(userId, simdi);

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return guvenliGonder(msg, "Ne sormak istiyorsun?");

    // Typing
    await msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const cevap = await cevapUret(userId, soru);
        clearInterval(typing);
        
        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) {
            await guvenliGonder(msg, parcalar[i], i === 0);
        }
    } catch (err) {
        clearInterval(typing);
        console.error("❌ Hata:", err);
        await guvenliGonder(msg, "Bir sorun oluştu.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} aktif — Model: ${MODEL_SMART}`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan | Bot: Awe`);
});

process.on("unhandledRejection", err => console.error("🔥", err?.message || err));
process.on("uncaughtException", err => console.error("💥", err?.message || err));

client.login(DISCORD_TOKEN);