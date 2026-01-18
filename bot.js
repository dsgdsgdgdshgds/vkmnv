const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot çalışıyor!");
    res.end();
}).listen(8080 || process.env.PORT);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/* ====== API AYARLARI ====== */
const GROQ_API_KEY = process.env.API;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERPER_API_KEY = "d5b0d101f822182dd67294e6612b511eb1c797bd";

/* ====== SOHBET GEÇMİŞİ + COOLDOWN ====== */
const userContexts = new Map();
const userLastProcess = new Map();

/* Güncel tarih helper */
function getCurrentTurkishDate() {
    const now = new Date();
    return now.toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        dateStyle: 'full',
        timeStyle: 'short'
    });
}

/* Soru dizi/güncel bölüm içeriyor mu? */
function isDiziBolumSorusu(soru) {
    const lower = soru.toLowerCase();
    return lower.includes('bölüm') || lower.includes('kaçıncı') || lower.includes('son bölüm') || 
           lower.includes('dizi') || lower.includes('yayınlandı') || lower.includes('ne zaman');
}

/* 1. ARAMA TERİMİ ÜRETİCİ - Güncel + dizi odaklı güçlendirme */
async function arastirmaPlaniHazirla(soru) {
    const simdi = getCurrentTurkishDate();
    const yilAy = simdi.split(' ')[3] + ' ' + simdi.split(' ')[2]; // Örn: 2026 Ocak

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant", // 70b varsa: "llama-3.1-70b-versatile"
                messages: [
                    {
                        role: "system",
                        content: `EN GÜNCEL arama terimleri üret. Soru dizi bölümüyle ilgiliyse mutlaka '\( {yilAy}' veya ' \){simdi}' ekle.
Örnekler:
- "${soru} ${yilAy}"
- "${soru} son bölüm ne zaman ${simdi}"
- "Arka Sokaklar son bölüm sayısı ${yilAy}"
Her satıra bir tane, 4 tane üret. Kısa ve kesin ol.`
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.15,
                max_tokens: 150
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").map(s => s.trim()).filter(s => s.length > 10);
    } catch (e) {
        return [`${soru} \( {yilAy}`, ` \){soru} son bölüm ${simdi}`];
    }
}

/* ÖZETLEME */
async function ozetleBilgi(hamBilgi) {
    if (hamBilgi.length < 2200) return hamBilgi;
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "En güncel bilgileri (tarih, bölüm sayısı) öne çıkararak maks 1700 karaktere indir. Türkçe." },
                    { role: "user", content: hamBilgi }
                ],
                temperature: 0.1,
                max_tokens: 550
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.trim();
    } catch {
        return hamBilgi.substring(0, 5500) + " (kısaltıldı)";
    }
}

/* VERİ TOPLAMA */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular.slice(0, 5)) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 10 },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 9000 }
            );
            if (res.data?.organic) {
                kaynaklar += res.data.organic.slice(0, 7).map(r => 
                    `[${r.title} | ${r.date || ''}] \( {r.snippet} ( \){r.link})`
                ).join("\n\n") + "\n";
            }
        } catch {}
    }
    return kaynaklar.trim();
}

/* ANA CEVAP FONKSİYONU - Güncel hesaplama güçlendirildi */
async function dogrulanmisCevap(userId, soru) {
    const simdi = getCurrentTurkishDate();

    const plan = await arastirmaPlaniHazirla(soru);
    let hamBilgi = await veriTopla(plan);
    hamBilgi = await ozetleBilgi(hamBilgi);

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `K: ${h.user}\nB: ${h.bot}`).join("\n───\n");

    const isDizi = isDiziBolumSorusu(soru);

    const prompt = `
GERÇEK ZAMAN: ${simdi} (Türkiye) → CEVABINI MUTLAKA BU TARİHE EN YAKIN VERİYLE VER!

ÖNCEKİ KONUŞMA:
${historyText || "Yok"}

KURALLAR:
- Eğer soru dizi bölümü, son bölüm, kaçıncı bölüm, yayın tarihi içeriyorsa:
  → En son bilinen bölüm sayısını ve tarihini kullan.
  → Eğer güncel bölüm sayısı belli değilse: son yayın + haftalık (genelde Cuma) ritimle tahmini hesapla ve bunu açıkça belirt.
  → Kaynak tarihlerini mutlaka yaz.
- Cevap kısa ve net olsun (600-1800 karakter ideal).
- Eski veri varsa "Bu bilgi ... tarihli, daha güncel olabilir" de.
- Gereksiz giriş yok.

VERİLER (en güncel olanlar öne çıksın):
${hamBilgi || "Güncel veri alınamadı."}

Soru: ${soru}

Cevap:`;

    try {
        const model = "llama-3.1-8b-instant"; // 70b varsa değiştir
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model,
                messages: [
                    { role: "system", content: "Güncel veriye odaklan. Dizi sorusunda bölüm sayısını tarihle birlikte ver, gerekirse basit tahmin yap (haftalık yayın varsay). Kısa, doğru, doğrudan cevap ver." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.12,
                max_tokens: isDizi ? 1200 : 900  // dizi sorularında biraz daha uzun izin
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let cevap = res.data.choices[0].message.content.trim();

        history.push({ user: soru, bot: cevap });
        if (history.length > 4) history.shift();
        userContexts.set(userId, history);

        return cevap;
    } catch (e) {
        console.error("Groq hata:", e.message);
        return `Şu anda (${simdi}) veri alınamıyor, lütfen tekrar dene.`;
    }
}

/* MESAJ DİNLEYİCİ (değişmedi) */
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (msg.mentions.everyone || msg.content.includes("@everyone") || msg.content.includes("@here")) return;
    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    const now = Date.now();
    const last = userLastProcess.get(msg.author.id) || 0;
    if (now - last < 2200) return;
    userLastProcess.set(msg.author.id, now);

    try {
        await msg.channel.sendTyping();
        const cevap = await dogrulanmisCevap(msg.author.id, temizSoru);

        if (cevap.length > 2000) {
            const chunks = [];
            let rest = cevap;
            while (rest.length > 0 && chunks.length < 5) {
                let end = rest.lastIndexOf('\n', 1900) || 1900;
                chunks.push(rest.substring(0, end).trim());
                rest = rest.substring(end).trim();
            }
            if (rest) chunks.push("... (çok uzun, kesildi)");

            for (let i = 0; i < chunks.length; i++) {
                if (i === 0) await msg.reply(chunks[i]);
                else await msg.channel.send(chunks[i]);
                if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1000));
            }
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        await msg.reply("Hata oluştu, tekrar dene.").catch(() => {});
    }
});

client.once("ready", () => {
    console.log(`Bot aktif → ${client.user.tag} | ${getCurrentTurkishDate()}`);
});

client.login(DISCORD_TOKEN).catch(err => console.error("Login hatası:", err));