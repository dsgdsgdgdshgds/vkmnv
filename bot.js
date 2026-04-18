const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http  = require('http');

/* ====== PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY  = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const TAVILY_KEY    = process.env.tavily || "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";

/* ====== MODEL ====== */
const MODEL = "llama-3.3-70b-versatile";

/* ====== HAFIZA ====== */
const memory     = new Map();
const MAX_HISTORY = 4;

/* ====== ARAMA CACHE (15 dk TTL) ====== */
const aramaCache = new Map();
const CACHE_TTL  = 15 * 60 * 1000;

function cacheden(key) {
    const hit = aramaCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > CACHE_TTL) { aramaCache.delete(key); return null; }
    console.log(`📦 Cache hit: ${key}`);
    return hit.v;
}
function cacheYaz(key, v) {
    if (aramaCache.size >= 60) aramaCache.delete(aramaCache.keys().next().value);
    aramaCache.set(key, { v, t: Date.now() });
}

/* ====== TAVİLY — bekleme YOK, hata olursa boş dön ====== */
let sonTavilyZamani = 0;
const TAVILY_ARALIK = 62000; // dev plan: 1/dk

async function tavilyAra(sorgu) {
    // Cache'de varsa anında dön
    const cached = cacheden(sorgu);
    if (cached !== null) return cached;

    // Rate limit dolmadıysa arama, Groq kendi bilgisiyle cevaplar
    const gecen = Date.now() - sonTavilyZamani;
    if (sonTavilyZamani > 0 && gecen < TAVILY_ARALIK) {
        const kalan = Math.ceil((TAVILY_ARALIK - gecen) / 1000);
        console.log(`⏭️ Tavily skip (${kalan}sn kaldı) — Groq kendi bilgisiyle cevaplar`);
        return null; // null = arama yapılmadı ama hata değil
    }

    console.log(`🔍 Tavily: ${sorgu}`);
    sonTavilyZamani = Date.now();

    try {
        const res = await axios.post(
            "https://api.tavily.com/search",
            { api_key: TAVILY_KEY, query: sorgu, search_depth: "basic", max_results: 6, include_answer: true },
            { timeout: 10000 }
        );
        const d = res.data;
        const satirlar = [];
        if (d.answer) satirlar.push(`Özet: ${d.answer}`);
        (d.results || []).forEach(r => {
            if (r.content?.trim().length > 30)
                satirlar.push(`[${r.title}]: ${r.content.slice(0, 600)}`);
        });
        const veri = satirlar.join("\n\n");
        if (veri) cacheYaz(sorgu, veri);
        console.log(`✅ Tavily: ${satirlar.length} kaynak`);
        return veri;
    } catch (e) {
        console.log(`⚠️ Tavily hata: ${e.message}`);
        return null;
    }
}

/* ====== KÜFÜR ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim"];
function kufurVarMi(s) {
    const n = s.toLowerCase().replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c");
    return KUFURLER.some(w => n.includes(w));
}

/* ====== GROQ (retry sadece 429 için, max 3 deneme) ====== */
async function groq(messages, max_tokens = 1000) {
    for (let i = 1; i <= 3; i++) {
        try {
            const res = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                { model: MODEL, messages, temperature: 0.65, max_tokens },
                { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 25000 }
            );
            return res.data.choices[0].message.content.trim();
        } catch (e) {
            if (e.response?.status === 429) {
                const bekle = (parseInt(e.response.headers?.["retry-after"] || "10")) * 1000;
                console.log(`⏳ Groq 429 — ${bekle/1000}sn bekle (deneme ${i}/3)`);
                await new Promise(r => setTimeout(r, bekle));
            } else {
                throw e;
            }
        }
    }
    throw new Error("Groq yanıt vermedi");
}

/* ====== PLAN — senkron, kural tabanlı (Groq çağrısı yok) ====== */
function normalize(s) {
    return s.toLowerCase().replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c");
}

const SOHBET_RE  = /^(merhaba|selam|naber|nasilsin|ne yapiyorsun|iyi misin|hey|hi |hello|kimsin|kim yaratti|kim yapti|kim gelistirdi)/;
const YARATICI_RE = /^(siir yaz|fikra anla|hikaye anla|bana siir|bana fikra|bana hikaye)/;
const HESAP_RE   = /^[\d\s\+\-\*\/\(\)\.,%]+[=?]?\s*$/;

function planHazirla(soru) {
    const n = normalize(soru.trim());

    if (SOHBET_RE.test(n) || YARATICI_RE.test(n) || HESAP_RE.test(soru))
        return { aramali: false, sorgu: null };

    let sorgu = soru.trim();

    if (/sark|album|muzik|dinle|parca|playlist|grup|sanatc/i.test(n))
        sorgu = soru.replace(/şarkıları?|müzikleri?|albümleri?/gi, "").trim() + " songs";
    else if (/kimdir|hayati|biyografi|dogum|oldu mu|yasiyor mu/i.test(n))
        sorgu = soru.replace(/kimdir|hakkinda/gi, "").trim() + " biography";
    else if (/fiyat|kac para|dolar|euro|btc|bitcoin|ethereum|borsa|doviz/i.test(n))
        sorgu = soru + " today";

    console.log(`🧠 Sorgu: "${sorgu}"`);
    return { aramali: true, sorgu };
}

/* ====== CEVAP ÜRET ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const plan  = planHazirla(soru);
    const kufur = kufurVarMi(soru);

    // Web verisi — null gelirse (rate limit) Groq kendi bilgisiyle cevaplar
    let webVerisi = "";
    if (!kufur && plan.aramali) {
        const sonuc = await tavilyAra(plan.sorgu);
        webVerisi = sonuc || ""; // null → ""
    }

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.map((h, i) => `[${i+1}] Kullanıcı: ${h.user}\nAwe: ${h.bot}`).join("\n");

    let sistem;
    if (kufur) {
        sistem = "Sen Awe adında bir Discord botusun. Geliştiricin Batuhan. Kullanıcı küfür etti, Türkçe sert ve kısa geri dön (1-2 cümle).";
    } else if (webVerisi) {
        sistem = `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.\nKURALLAR: Yalnızca verilen web verisini kullan, uydurma. Siyasi görüş katma. Discord **kalın** formatı kullan.`;
    } else {
        sistem = `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.\nKURALLAR: Samimi ve kısa konuş. Sadece Türkçe kelime kullan. Siyasi yorum yapma.`;
    }

    const icerik = [
        gecmisMetin ? `Geçmiş:\n${gecmisMetin}` : "",
        webVerisi   ? `Web verisi:\n${webVerisi}` : "",
        `Kullanıcı: ${soru}`
    ].filter(Boolean).join("\n\n");

    const cevap = await groq([
        { role: "system", content: sistem },
        { role: "user",   content: icerik }
    ]);

    const yeni = [...gecmis, { user: soru, bot: cevap }];
    if (yeni.length > MAX_HISTORY) yeni.shift();
    memory.set(userId, yeni);
    return cevap;
}

/* ====== MESAJ BÖLÜCÜ ====== */
function bol(metin, limit = 1950) {
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
async function gonder(msg, metin, ilk = true) {
    try {
        if (ilk) await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        else     await msg.channel.send(metin);
    } catch (e) {
        if (e.code === 50013) { try { await msg.author.send(metin); } catch {} }
        else console.error("❌ Gönderim hatası:", e.message);
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
    if (!soru) return gonder(msg, "Ne sormak istiyorsun?");

    msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(typing);
        const parcalar = bol(cevap);
        for (let i = 0; i < parcalar.length; i++) await gonder(msg, parcalar[i], i === 0);
    } catch (e) {
        clearInterval(typing);
        console.error("❌ Hata:", e.message);
        await gonder(msg, "Bir sorun oluştu, tekrar dene.");
    }
});

client.once("ready", c => {
    console.log(`✅ ${c.user.tag} aktif`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
});

process.on("unhandledRejection", e => console.error("🔥", e?.message || e));

client.login(DISCORD_TOKEN);