const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot Calisiyor!");
    res.end();
}).listen(8080);

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

/* ====== SOHBET GEÇMİŞİ ====== */
const userContexts = new Map();

/* Kısa/selamlaşma/normal sohbet kontrolü */
function isNormalSohbet(soru) {
    const temiz = soru.toLowerCase().trim();
    if (temiz.length < 6) return true;
    if (/^(selam|merhaba|sa|nasılsın|naber|iyi akşamlar|günaydın|slm|hey|selamlar)$/i.test(temiz)) return true;
    if (/^(\W|\d)+$/.test(temiz)) return true; // sadece emoji, nokta, sayı vs.
    if (temiz.split(" ").length <= 2) return true;
    return false;
}

/* 1. ADIM: ARAMA TERİMİ ÜRETİCİ */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Sen bir veri madencisisin. Kullanıcının sorusu için Google'da aratılacak en güncel ve teknik 3 terimi üret. Her satıra bir tane tane yaz. Gereksiz açıklama yapma."
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.1,
                max_tokens: 120
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content
            .split("\n")
            .map(s => s.trim())
            .filter(s => s.length > 3);
    } catch (e) {
        return [soru];
    }
}

/* 2. ADIM: SERPER ile veri toplama */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular.slice(0, 3)) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr" },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 6000 }
            );
            if (res.data?.organic) {
                kaynaklar += res.data.organic.slice(0, 5).map(r => `[Bilgi]: ${r.snippet}`).join("\n") + "\n\n";
            }
        } catch (e) {
            // sessiz geç
        }
    }
    return kaynaklar.trim();
}

/* 3. ADIM: Cevap sentezi */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    let hamBilgi = "";
    let plan = [];

    // Normal sohbet değilse → Serper kullan
    if (!isNormalSohbet(soru)) {
        plan = await arastirmaPlaniHazirla(soru);
        hamBilgi = await veriTopla(plan);
    }

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `Kullanıcı: ${h.user}\nBot: ${h.bot}`).join("\n---\n");

    const synthesisPrompt = `
GÜNCEL TARİH: ${tarihBilgisi}

ÖNCEKİ KONUŞMALAR:
${historyText || "Henüz yok"}

\( {hamBilgi ? `İNTERNET'TEN DOĞRULANMIŞ BİLGİLER:\n \){hamBilgi}\n---\n` : ""}

KULLANICI SORUSU: ${soru}

Kurallar:
- @everyone @here gibi mention'lara cevap verme (zaten dinleyici bunu engelliyor)
- Kısa selamlaşmalara doğal ve kısa cevap ver
- Bilgi içeren sorularda sadece en güncel ve mantıklı veriyi kullan
- Matematik, dizi bölüm sayısı, tarih gibi konularda mantıksal hata yapma
`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "Doğru, kısa, güncel ve doğal konuşan bir yardımcı ol. Gereksiz açıklama yapma." },
                    { role: "user", content: synthesisPrompt }
                ],
                temperature: 0.15,
                max_tokens: 2048
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const botCevap = res.data.choices[0].message.content.trim();

        // Hafıza güncelle (son 3 konuşma)
        history.push({ user: soru, bot: botCevap });
        if (history.length > 3) history.shift();
        userContexts.set(userId, history);

        return botCevap;
    } catch (e) {
        console.error(e);
        return "Şu an cevap veremiyorum, birazdan tekrar dene.";
    }
}

/* ========== MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    // Botun kendisi ve everyone/here mention'larını tamamen yok say
    if (msg.author.bot) return;

    // @everyone veya @here içeren mesajlara cevap verme
    if (msg.mentions.everyone || msg.content.includes("@everyone") || msg.content.includes("@here")) {
        return;
    }

    // Botu mention etmemişse cevap verme
    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    try {
        await msg.channel.sendTyping();
        const cevap = await dogrulanmisCevap(msg.author.id, temizSoru);

        if (cevap.length > 1900) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g);
            for (const chunk of chunks) {
                await msg.reply(chunk);
            }
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        await msg.reply("Bir hata oluştu.").catch(() => {});
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} → 2026 mod aktif`);
});

client.login(DISCORD_TOKEN);