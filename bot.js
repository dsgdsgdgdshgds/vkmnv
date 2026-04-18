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

/* ====== ADIM 1: ARAMA PLANI ====== */
async function planHazirla(soru) {
    const prompt = `Sen bir arama motoru uzmanısın. Kullanıcının sorusunu analiz et ve en iyi sonucu getirecek arama sorgularını üret.

JSON formatında döndür:
{
  "tip": "guncel_haber | bilgi_sorgusu | hesaplama | genel_sohbet",
  "arama_gerekli": true | false,
  "sorgular": ["sorgu1", "sorgu2", "sorgu3"]
}

ARAMA GEREKSİZ (false) — SADECE BUNLAR:
- Selamlaşma, küfür, argo, "nasılsın", "ne yapıyorsun" gibi sohbet
- "şiir yaz", "fıkra anlat" gibi yaratıcı istekler
Diğer HER şey için arama_gerekli: true.

SORGU ÜRETİRKEN:
- Sorudaki özel isimleri, grup adlarını, kişi adlarını AYNEN kullan
- Biri Türkçe, biri İngilizce sorgu yap (daha fazla kaynak bulunur)
- Spesifik sorularda konuyu parçala: "host müzik grubu kurucusu" + "host band most popular song" + "host müzik grubu hakkında"
- Müzik sorularında: "en sevilen şarkı" yerine "popular songs", "hit", "best songs" gibi İngilizce terimler ekle
- Sadece JSON döndür, başka hiçbir şey yazma.

SORU: ${soru}`;

    try {
        const raw = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 300 });
        const json = raw.match(/\{[\s\S]*\}/)?.[0];
        return json ? JSON.parse(json) : { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    } catch {
        return { tip: "bilgi_sorgusu", arama_gerekli: true, sorgular: [soru] };
    }
}

/* ====== ADIM 2: TAVİLY WEB ARAMA ====== */
async function tavilyTekArama(sorgu) {
    const res = await axios.post(
        "https://api.tavily.com/search",
        {
            api_key: TAVILY_API_KEY,
            query: sorgu,
            search_depth: "advanced",
            max_results: 8,
            include_answer: true,
            include_raw_content: true
        },
        { timeout: 20000 }
    );
    return res.data;
}

async function tavilyAra(sorgular) {
    const aramaListesi = Array.isArray(sorgular) ? sorgular.slice(0, 3) : [sorgular];
    console.log(`🔍 Sıralı arama: ${aramaListesi.join(" | ")}`);

    const tumSonuclar = [];
    const gorulmus = new Set();

    for (let i = 0; i < aramaListesi.length; i++) {
        // İkinci ve üçüncü sorguda 1sn bekle — rate limit önlemi
        if (i > 0) await new Promise(r => setTimeout(r, 1100));

        let deneme = 0;
        while (deneme < 2) {
            try {
                const d = await tavilyTekArama(aramaListesi[i]);
                if (d.answer && !gorulmus.has(d.answer)) {
                    tumSonuclar.push(`Özet: ${d.answer}`);
                    gorulmus.add(d.answer);
                }
                (d.results || []).forEach(site => {
                    if (gorulmus.has(site.url)) return;
                    gorulmus.add(site.url);
                    const icerik = site.raw_content || site.content || "";
                    if (icerik.trim().length > 30)
                        tumSonuclar.push(`[${site.title || "Kaynak"} — ${site.url}]:\n${icerik.slice(0, 800)}`);
                });
                break; // başarılı, döngüden çık
            } catch (e) {
                deneme++;
                if (e.response?.status === 429 && deneme < 2) {
                    console.log(`⏳ Rate limit, 3sn bekleniyor...`);
                    await new Promise(r => setTimeout(r, 3000));
                } else {
                    console.log(`⚠️ Tavily hata (${aramaListesi[i]}): ${e.message}`);
                    break;
                }
            }
        }

        // İlk sorguda yeterli sonuç geldiyse devam etme
        if (i === 0 && tumSonuclar.length >= 6) break;
    }

    console.log(`✅ Tavily toplam: ${tumSonuclar.length} kaynak`);
    return tumSonuclar.join("\n\n");
}

/* ====== ADIM 3: CEVAP ÜRET ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = await planHazirla(soru);
    const webVerisi = plan.arama_gerekli ? await tavilyAra(plan.sorgular || plan.sorgu) : "";

    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.length
        ? gecmis.map((h, i) => `[${i+1}] Kullanıcı: ${h.user}\nAwe: ${h.bot}`).join("\n")
        : "";

    const kufur = kufurVarMi(soru);

    let sistemPrompt;
    if (kufur) {
        sistemPrompt = "Sen Awe adında bir Discord botusun, geliştiricin Batuhan. Kullanıcı sana küfür etti. Türkçe küfürle kısa ve sert geri dön (1-2 cümle).";
    } else if (webVerisi) {
        sistemPrompt = `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}. KURALLAR: 1) Sadece aşağıdaki web verisinde yazanları söyle. 2) Web verisinde olmayan hiçbir şeyi UYDURMA veya tahmin etme — bulamadıysan "bu konuda güvenilir bilgiye ulaşamadım" de. 3) Siyasi görüş KATMA. 5) Discord formatı: **kalın**.`;
    } else {
        sistemPrompt = `Sen Awe adında Discord botusun. Geliştiricin Batuhan. Bugün: ${tarih}. KURALLAR: 1) Samimi ve kısa konuş. 2) SADECE Türkçe kelime kullan, tek bir yabancı kelime bile yazma. 3) Siyasi yorum yapma. 4) Liste veya başlık kullanma.`;
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