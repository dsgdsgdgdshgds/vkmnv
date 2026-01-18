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

/* ====== SOHBET GEÇMİŞİ (HAFIZA) ====== */
const userContexts = new Map();

/* 1. ADIM: ARAMA TERİMLERİ ÜRET */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Sen bir veri madencisisin. Kullanıcının sorusu için Google'da aratılacak en güncel ve teknik 3 terimi üret. Her terimi yeni satıra yaz. Kısa ve net ol."
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.1,
                max_tokens: 120
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").filter(s => s.trim().length > 2).slice(0, 3);
    } catch (e) {
        return [soru];
    }
}

/* 2. ADIM: SERPER İLE VERİ TOPLA */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr" },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 6000 }
            );
            if (res.data?.organic) {
                kaynaklar += res.data.organic.slice(0, 4).map(r => `[Kaynak]: ${r.snippet}`).join("\n") + "\n\n";
            }
        } catch (e) {}
    }
    return kaynaklar.trim();
}

/* 3. ADIM: TEK ÇAĞRI → SENTEZ + CEVAP */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `Kullanıcı: ${h.user}\nCevap: ${h.bot}`).join("\n---\n");

    const plan = await arastirmaPlaniHazirla(soru);
    const hamBilgi = await veriTopla(plan);

    const systemPrompt = `
Sen güncel, rasyonel ve matematiksel olarak tutarlı bir bilgi uzmanısın.
Sadece verilen internet verilerine ve geçmiş konuşmalara dayan.
Uydurma bilgi verme. Sayısal verilerde en güncel ve mantıklı olanı seç.
Soru dizi, bölüm sayısı, süre hesabı içeriyorsa 130 dk ortalama bölüm süresi kullan.

GÜNCEL TARİH: ${tarihBilgisi}

GEÇMİŞ KONUŞMA:
${historyText || "Henüz yok."}

İNTERNET'TEN GELEN EN GÜNCEL BİLGİLER:
---
${hamBilgi || "Bu konuda yeterli veri toplanamadı."}
---

KULLANICI SORUSU: ${soru}

Cevabını kısa, net ve doğrudan ver. Gereksiz giriş/sonuç cümleleri kullanma.
`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: "Şimdi soruya cevap ver." }
                    ],
                    temperature: 0.1,
                    max_tokens: 900,
                },
                { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
            );

            const botCevap = res.data.choices[0].message.content.trim();

            // Hafızayı güncelle (max 2 tur)
            history.push({ user: soru, bot: botCevap });
            if (history.length > 2) history.shift();
            userContexts.set(userId, history);

            return botCevap;

        } catch (e) {
            if (e.response?.status === 429 && attempt === 1) {
                await new Promise(r => setTimeout(r, 14000)); // 14 saniye bekle
                continue;
            }
            console.error("Groq hata:", e.response?.data || e.message);
            return "Şu an Groq limitine takıldık veya teknik bir sorun var. 30 saniye–1 dk sonra tekrar dene.";
        }
    }

    return "Rate limit nedeniyle cevap üretilemedi. Biraz bekleyip tekrar sorabilir misin?";
}

/* ========== MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    try {
        await msg.channel.sendTyping();
        const cevap = await dogrulanmisCevap(msg.author.id, temizSoru);

        if (cevap.length > 3800) {
            const chunks = cevap.match(/[\s\S]{1,3900}/g) || [];
            for (const chunk of chunks) {
                await msg.reply(chunk);
                await new Promise(r => setTimeout(r, 700));
            }
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        msg.reply("Bir hata oluştu, lütfen tekrar dene.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} → 2026 modunda aktif`);
    console.log(`Geliştirici: Batuhan Aktaş - Giresun/Bulancak`);
});

client.login(DISCORD_TOKEN);