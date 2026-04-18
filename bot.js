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

/* ====== GROQ RATE LIMIT YÖNETİMİ ====== */
// 429 gelince Retry-After başlığına göre bekle, sonra tekrar dene
const GROQ_MAX_RETRY = 4;
const GROQ_RETRY_BASE = 5000; // ms — başlangıç bekleme (header yoksa)

/* ====== HAFIZA ====== */
const memory    = new Map();
const MAX_HISTORY = 5;

/* ====== ARAMA CACHE (son 50 sorgu, 10 dakika TTL) ====== */
const aramaCache = new Map();
const CACHE_TTL  = 10 * 60 * 1000; // 10 dakika
const CACHE_MAX  = 50;

function cacheden(sorgu) {
    const key = sorgu.toLowerCase().trim();
    const hit  = aramaCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.zaman > CACHE_TTL) { aramaCache.delete(key); return null; }
    console.log(`📦 Cache hit: ${sorgu}`);
    return hit.veri;
}

function cacheYaz(sorgu, veri) {
    const key = sorgu.toLowerCase().trim();
    if (aramaCache.size >= CACHE_MAX) {
        // En eski girişi sil
        const ilkAnahtar = aramaCache.keys().next().value;
        aramaCache.delete(ilkAnahtar);
    }
    aramaCache.set(key, { veri, zaman: Date.now() });
}

/* ====== TAVILY KUYRUK (rate-limit güvenli) ====== */
// Dev plan: dakikada 1 istek → istekler sıraya girer, kullanıcı beklerken bilgilendirilmez
let kuyruktaki    = false;
let sonIstekZamani = 0;
const RATE_WINDOW  = 62000; // 62 saniye güvenlik marjı

const aramaKuyrugu = [];

function kuyrugaEkle(sorgu) {
    return new Promise((resolve) => {
        aramaKuyrugu.push({ sorgu, resolve });
        if (!kuyruktaki) kuyrukIsle();
    });
}

async function kuyrukIsle() {
    if (kuyruktaki || aramaKuyrugu.length === 0) return;
    kuyruktaki = true;

    while (aramaKuyrugu.length > 0) {
        const { sorgu, resolve } = aramaKuyrugu.shift();

        // Cache kontrolü
        const cached = cacheden(sorgu);
        if (cached) { resolve(cached); continue; }

        // Rate limit beklemesi
        const gecen = Date.now() - sonIstekZamani;
        if (sonIstekZamani > 0 && gecen < RATE_WINDOW) {
            const bekle = RATE_WINDOW - gecen;
            console.log(`⏳ Rate limit: ${Math.ceil(bekle / 1000)}sn bekleniyor (kuyruk: ${aramaKuyrugu.length + 1})`);
            await new Promise(r => setTimeout(r, bekle));
        }

        const veri = await tavilyIstekAt(sorgu);
        resolve(veri);
    }

    kuyruktaki = false;
}

/* ====== ADIM 2: TAVİLY — gerçek HTTP isteği ====== */
async function tavilyIstekAt(sorgu) {
    console.log(`🔍 Tavily isteği: ${sorgu}`);
    sonIstekZamani = Date.now();
    try {
        const res = await axios.post(
            "https://api.tavily.com/search",
            {
                api_key: TAVILY_API_KEY,
                query: sorgu,
                search_depth: "basic",
                max_results: 8,
                include_answer: true
            },
            { timeout: 20000 }
        );
        const d = res.data;
        const sonuclar = [];
        if (d.answer) sonuclar.push(`Özet: ${d.answer}`);
        (d.results || []).forEach(r => {
            if (r.content?.trim().length > 30)
                sonuclar.push(`[${r.title || "Kaynak"} — ${r.url}]:\n${r.content.slice(0, 700)}`);
        });
        const veri = sonuclar.join("\n\n");
        cacheYaz(sorgu, veri);
        console.log(`✅ Tavily: ${sonuclar.length} kaynak`);
        return veri;
    } catch (e) {
        console.log(`⚠️ Tavily hata: ${e.message}`);
        return "";
    }
}

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
        .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== GROQ ÇAĞRISI (retry + 429 koruması) ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.6, max_tokens = 1200 } = {}) {
    for (let deneme = 1; deneme <= GROQ_MAX_RETRY; deneme++) {
        try {
            const res = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                { model, messages, temperature, max_tokens },
                { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
            );
            return res.data.choices[0].message.content.trim();
        } catch (e) {
            const status = e.response?.status;
            if (status === 429) {
                const retryAfter = (parseInt(e.response?.headers?.["retry-after"] || "0") * 1000)
                    || (GROQ_RETRY_BASE * deneme);
                console.log(`⏳ Groq 429 — ${Math.ceil(retryAfter/1000)}sn bekleniyor (deneme ${deneme}/${GROQ_MAX_RETRY})`);
                await new Promise(r => setTimeout(r, retryAfter));
            } else if (status === 503 || status === 502) {
                const bekle = GROQ_RETRY_BASE * deneme;
                console.log(`⚠️ Groq ${status} — ${Math.ceil(bekle/1000)}sn sonra tekrar (deneme ${deneme})`);
                await new Promise(r => setTimeout(r, bekle));
            } else {
                throw e;
            }
            if (deneme === GROQ_MAX_RETRY) throw new Error(`Groq ${GROQ_MAX_RETRY} denemede yanıt vermedi`);
        }
    }
}

/* ====== ADIM 1: KURAL TABANLI ARAMA PLANI (Groq çağrısı YOK) ====== */
// Groq'u yormamak için arama kararını ve sorguyu kural+regex ile veriyoruz.
// Groq sadece TEK çağrı: nihai cevap üretimi.

const SOHBET_PATTERN = /^(merhaba|selam|naber|nasılsın|ne yapıyorsun|iyi misin|hey|hi|hello|kim (yarattı|yaptı)|kim (geliştirdi)|kim (kodladı))/i;
const YARATICI_PATTERN = /^(şiir yaz|fıkra anlat|hikaye anlat|bir şiir|bir fıkra|bir hikaye|bana şiir|bana fıkra)/i;
const MATEMATIK_PATTERN = /^[\d\s\+\-\*\/\(\)\.]+[=?]?\s*$/;

// Türkçe karakterleri normalize et
function normalize(s) {
    return s.toLowerCase()
        .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
        .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c");
}

// Sorudan akıllı Tavily sorgusu üret — Groq kullanmadan
function sorguUret(soru) {
    const s = soru.trim();
    const sn = normalize(s);

    // Müzik / şarkı
    if (/şark|albüm|müzik|dinle|parça|playlist|çalar|grup|sanatç/i.test(s))
        return { sorgu: s.replace(/şarkıları|müzikleri|albümleri/gi, "").trim() + " songs discography", tip: "muzik" };

    // Güncel haber / son dakika
    if (/haber|son dakika|bugün|dün|gündem|gelişme/i.test(s))
        return { sorgu: s, tip: "guncel_haber" };

    // Kişi / biyografi
    if (/kim(dir)?|hayatı|biyografi|doğum|öldü mü|yaşıyor mu/i.test(s))
        return { sorgu: s.replace(/kim(dir)?|hakkında/gi, "").trim() + " biography", tip: "kisi" };

    // Fiyat / kripto / borsa
    if (/fiyat|kaç para|dolar|euro|btc|bitcoin|ethereum|borsa|döviz/i.test(s))
        return { sorgu: s + " price today", tip: "guncel_haber" };

    // Genel — İngilizce'ye çevirme, doğrudan kullan
    return { sorgu: s, tip: "bilgi_sorgusu" };
}

function planHazirla(soru) {
    const s = soru.trim();

    // Arama gereksiz mi? — sadece kural tabanlı
    if (SOHBET_PATTERN.test(normalize(s)) || YARATICI_PATTERN.test(normalize(s)) || MATEMATIK_PATTERN.test(s))
        return { arama_gerekli: false, tip: "genel_sohbet", sorgular: [], kullanici_amaci: s };

    const { sorgu, tip } = sorguUret(s);
    console.log(`🧠 Plan (kural): tip=${tip} | sorgu="${sorgu}"`);
    return { arama_gerekli: true, tip, sorgular: [sorgu], kullanici_amaci: s };
}

/* ====== ADIM 3: CEVAP ÜRET ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = planHazirla(soru);

    let webVerisi = "";
    if (plan.arama_gerekli) {
        const sorgu = plan.sorgular?.[0] || soru;

        // Önce cache'e bak, yoksa kuyruğa ekle
        const cached = cacheden(sorgu);
        webVerisi = cached !== null ? cached : await kuyrugaEkle(sorgu);
    }

    const gecmis     = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] Kullanıcı: ${h.user}\nAwe: ${h.bot}`).join("\n")
        : "";

    const kufur = kufurVarMi(soru);

    let sistemPrompt;
    if (kufur) {
        sistemPrompt = "Sen Awe adında bir Discord botusun, geliştiricin Batuhan. Kullanıcı sana küfür etti. Türkçe küfürle kısa ve sert geri dön (1-2 cümle).";
    } else if (webVerisi) {
        sistemPrompt = `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.
KURALLAR:
1) Kullanıcının amacı: "${plan.kullanici_amaci}" — cevabı bu amaca göre ver.
2) Yalnızca aşağıdaki web verisine dayan. Web verisinde olmayan hiçbir şeyi UYDURMA; "bu konuda güvenilir bilgiye ulaşamadım" de.
3) Siyasi görüş katma.
4) Discord formatı kullan: **kalın** önemli bilgiler için.
5) Gereksiz tekrar yapma, öz ve bilgilendirici ol.`;
    } else {
        sistemPrompt = `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.
KURALLAR:
1) Samimi ve kısa konuş.
2) SADECE Türkçe kelime kullan, yabancı kelime yazma.
3) Siyasi yorum yapma.
4) Liste veya başlık kullanma.`;
    }

    const kullaniciPrompt = [
        gecmisMetin ? `Geçmiş konuşma:\n${gecmisMetin}` : "",
        webVerisi   ? `Web'den gelen güncel veri:\n${webVerisi}` : "",
        `Kullanıcı mesajı: ${soru}`
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
        else     await msg.channel.send(metin);
    } catch (err) {
        if (err.code === 50013) { try { await msg.author.send(metin); } catch {} }
        else console.error("❌ Mesaj gönderilemedi:", err.message);
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

    msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(typing);
        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) await guvenliGonder(msg, parcalar[i], i === 0);
    } catch (err) {
        clearInterval(typing);
        console.error("❌ Hata:", err.message);
        await guvenliGonder(msg, "Bir sorun oluştu, tekrar dene.");
    }
});

client.once("clientReady", c => {
    console.log(`✅ ${c.user.tag} aktif — Model: ${MODEL_SMART}`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan | Bot: Awe`);
});

process.on("unhandledRejection", err => console.error("🔥", err?.message || err));

client.login(DISCORD_TOKEN);