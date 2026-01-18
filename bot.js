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

/* Tarih oluşturma yardımcı fonksiyon */
function getCurrentTurkishDate() {
    const now = new Date();
    return now.toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        dateStyle: 'full',
        timeStyle: 'short'
    });
}

/* 1. ARAMA TERİMİ ÜRETİCİ - Güncel tarih eklenmiş */
async function arastirmaPlaniHazirla(soru) {
    const simdi = getCurrentTurkishDate();
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant", // veya "llama-3.1-70b-versatile" varsa
                messages: [
                    {
                        role: "system",
                        content: `Sen bir araştırma asistanısın. Kullanıcının sorusu için Google'da aranacak EN GÜNCEL 3-4 terimi üret. 
Her zaman şu anki tarihi (${simdi}) ekle veya yıl/ay belirt. Örnek:
- "Arka Sokaklar toplam bölüm sayısı ${simdi.split(' ')[3]}"
- "Arka Sokaklar son bölüm ne zaman yayınlandı ${simdi}"
Kısa, net, her satıra bir terim.`
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.15,
                max_tokens: 120
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").map(s => s.trim()).filter(s => s.length > 8);
    } catch (e) {
        return [soru, `${soru} ${simdi.split(' ')[3]}`];
    }
}

/* ÖZETLEME - Token sınırı için */
async function ozetleBilgi(hamBilgi) {
    if (hamBilgi.length < 2000) return hamBilgi;
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Metni en kritik noktaları koruyarak maks 1600 karaktere indirge. En güncel bilgileri öne çıkar. Türkçe." },
                    { role: "user", content: hamBilgi }
                ],
                temperature: 0.1,
                max_tokens: 500
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.trim();
    } catch {
        return hamBilgi.substring(0, 5000) + " (kısaltıldı)";
    }
}

/* 2. VERİ TOPLAMA */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular.slice(0, 4)) { // 4'e çıkardık
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 8 },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 8000 }
            );
            if (res.data?.organic) {
                kaynaklar += res.data.organic.slice(0, 6).map(r => 
                    `[${r.title} - ${r.link}] ${r.snippet || r.date || ''}`
                ).join("\n") + "\n\n";
            }
        } catch {}
    }
    return kaynaklar.trim();
}

/* 3. CEVAP ÜRETİMİ - Güncel tarih zorunlu */
async function dogrulanmisCevap(userId, soru) {
    const simdi = getCurrentTurkishDate();

    const plan = await arastirmaPlaniHazirla(soru);
    let hamBilgi = await veriTopla(plan);
    hamBilgi = await ozetleBilgi(hamBilgi);

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `K: ${h.user}\nB: ${h.bot}`).join("\n───\n");

    const prompt = `
GERÇEK ZAMAN: ${simdi} (Türkiye saati) - CEVABINI HER ZAMAN BU TARİHE EN YAKIN/EN GÜNCEL BİLGİYE DAYANDIR!
Eğer veri eskiyse veya çelişkiliyse bunu mutlaka belirt.

ÖNCEKİ KONUŞMA:
${historyText || "Yok"}

KURALLAR:
- En güncel bilgiyi kullan, tarih belirt.
- Cevabı kısa, net tut (ideal 500-1500 karakter).
- Sayısal verilerde en son olanı seç.
- Gereksiz giriş/emoji yok.

İNTERNET VERİLERİ (en güncel olanlar öne çıksın):
${hamBilgi || "Güncel veri alınamadı."}

Soru: ${soru}

Cevap:`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant", // 70b varsa değiştir: "llama-3.1-70b-versatile"
                messages: [
                    { role: "system", content: "Her zaman en güncel bilgiye odaklan. Eski veri varsa belirt. Kısa, doğrudan ve doğru cevap ver." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 1000
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let cevap = res.data.choices[0].message.content.trim();

        history.push({ user: soru, bot: cevap });
        if (history.length > 4) history.shift(); // hafıza biraz genişletildi
        userContexts.set(userId, history);

        return cevap;
    } catch (e) {
        console.error("Groq hatası:", e.message);
        return `Şu anda (${simdi}) cevap üretilemiyor, lütfen biraz sonra dene.`;
    }
}

/* ========== MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;

    if (msg.mentions.everyone || msg.content.includes("@everyone") || msg.content.includes("@here")) return;

    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    const now = Date.now();
    const last = userLastProcess.get(msg.author.id) || 0;
    if (now - last < 2200) return; // 2.2 sn cooldown
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
    console.log(`Bot aktif → ${client.user.tag} | Tarih: ${getCurrentTurkishDate()}`);
});

client.login(DISCORD_TOKEN).catch(err => console.error("Login hatası:", err));