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

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
        .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== GROQ ÇAĞRISI ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.6, max_tokens = 1500 } = {}) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature, max_tokens },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    return res.data.choices[0].message.content.trim();
}

/* ====== ADIM 1: ARAMA PLANI (DÜZELTİLDİ) ====== */
async function planHazirla(soru) {
    const prompt = `Sen bir arama motoru uzmanısın. Kullanıcının sorusunu analiz et ve en iyi tek arama sorgusunu üret.

JSON formatında döndür:
{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["tek en iyi sorgu"]
}

ARAMA GEREKSİZ (false) — SADECE BUNLAR:
- Selamlaşma, küfür, argo, "nasılsın", "ne yapıyorsun", "şiir yaz", "fıkra anlat" gibi basit sohbet ve yaratıcı istekler.

ÖZEL KURAL - MÜZİK GRUBU / SANATÇI SORULARI:
- "müzik grubu", "grup", "band", "şarkıcı", "sanatçı" kelimeleri geçiyorsa sorguyu TÜRKÇE tut.
- Türkçe isimleri olduğu gibi bırak, İngilizceye çevirme.
- Örnek: "HOST müzik grubu nedir", "HOST grubu kurucusu", "HOST müzik grubu en bilinen şarkıları"

Spesifik ve kısa tut. Sadece JSON döndür, başka hiçbir şey yazma.

SORU: ${soru}`;

    try {
        const raw = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 300 });
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    } catch {
        return { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    }
}

/* ====== ADIM 2: TAVİLY WEB ARAMA ====== */
let sonIstekZamani = 0;
const MIN_BEKLEME = 40000; // 40 saniye (daha dengeli)

async function tavilyAra(sorgular) {
    const sorgu = Array.isArray(sorgular) ? sorgular[0] : sorgular;
    console.log(`🔍 Arama: ${sorgu}`);

    const simdi = Date.now();
    const gecen = simdi - sonIstekZamani;
    if (gecen < MIN_BEKLEME && sonIstekZamani > 0) {
        const bekle = MIN_BEKLEME - gecen;
        console.log(`⏳ Rate limit: ${Math.ceil(bekle/1000)}sn bekleniyor...`);
        await new Promise(r => setTimeout(r, bekle));
    }

    try {
        sonIstekZamani = Date.now();
        const res = await axios.post(
            "https://api.tavily.com/search",
            {
                api_key: TAVILY_API_KEY,
                query: sorgu,
                search_depth: "basic",
                max_results: 10,
                include_answer: true
            },
            { timeout: 25000 }
        );
        const d = res.data;
        const sonuclar = [];
        if (d.answer) sonuclar.push(`Özet: ${d.answer}`);
        (d.results || []).forEach(r => {
            if (r.content?.trim().length > 30)
                sonuclar.push(`[${r.title || "Kaynak"} — \( {r.url}]:\n \){r.content.slice(0, 800)}`);
        });
        console.log(`✅ Tavily: ${sonuclar.length} kaynak`);
        return sonuclar.join("\n\n");
    } catch (e) {
        console.log(`⚠️ Tavily hata: ${e.message}`);
        return null;
    }
}

/* ====== ADIM 3: CEVAP ÜRET (DÜZELTİLDİ) ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = await planHazirla(soru);
    let webVerisi = "";
    let aramaBasarili = false;

    if (plan.arama_gerekli) {
        webVerisi = await tavilyAra(plan.sorgular || [soru]);
        aramaBasarili = webVerisi !== null && webVerisi.length > 60;
    }

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] Kullanıcı: ${h.user}\nAwe: ${h.bot}`).join("\n")
        : "";

    const kufur = kufurVarMi(soru);

    let sistemPrompt = `SEN GERÇEK BİLGİ BOTUSUN. BİLMEDİĞİN VEYA WEB VERİSİNDE OLMAYAN HİÇBİR BİLGİYİ ASLA UYDURMA. 
Bilmiyorsan açıkça "bulamadım" veya "bu konuda net bilgi yok" de. Uydurmak kesinlikle yasaktır.\n\n`;

    if (kufur) {
        sistemPrompt += "Sen Awe adında bir Discord botusun, geliştiricin Batuhan. Kullanıcı sana küfür etti. Türkçe küfürle kısa ve sert geri dön (1-2 cümle).";
    } else if (plan.arama_gerekli && aramaBasarili) {
        sistemPrompt += `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.

KESİN KURALLAR:
1) SADECE aşağıdaki web verisinde yazanları kullan.
2) Web verisinde olmayan bilgiyi ASLA söyleme.
3) Emin olmadığın şeyi tahmin etme veya uydurma.
4) Kısa ve net cevap ver.`;
    } else if (plan.arama_gerekli && !aramaBasarili) {
        sistemPrompt += `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.

KESİN KURALLAR - BUNLARA MUTLAKA UY:
1) Web araması başarısız oldu veya yeterli güvenilir bilgi bulunamadı.
2) SADECE şu tarz cevap ver: 
   "HOST diye bilinen popüler bir müzik grubu bulamadım. Belki isim yanlış yazılmış olabilir, başka detay verir misin?"
3) ASLA şarkı adı, kişi adı, kurucu gibi bilgi uydurma.
4) Tahmin yapma. Cevap 1-2 cümleyi geçmesin.`;
    } else {
        sistemPrompt += `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}.
KURALLAR: 1) Samimi ve kısa konuş. 2) SADECE Türkçe. 3) Siyasi yorum yapma.`;
    }

    const kullaniciPrompt = [
        gecmisMetin ? `Geçmiş konuşma:\n${gecmisMetin}` : "",
        (plan.arama_gerekli && aramaBasarili && webVerisi) ? `WEB VERİSİ (SADECE BUNA GÜVEN):\n${webVerisi}` : "",
        `Kullanıcı mesajı: ${soru}`
    ].filter(Boolean).join("\n\n");

    const cevap = await groq(
        [
            { role: "system", content: sistemPrompt },
            { role: "user",   content: kullaniciPrompt }
        ],
        { 
            model: MODEL_SMART, 
            temperature: (plan.arama_gerekli && aramaBasarili) ? 0.2 : 0.3, 
            max_tokens: 1200 
        }
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

client.once("ready", c => {
    console.log(`✅ ${c.user.tag} aktif — Model: ${MODEL_SMART}`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan | Bot: Awe`);
});

process.on("unhandledRejection", err => console.error("🔥", err?.message || err));

client.login(DISCORD_TOKEN);