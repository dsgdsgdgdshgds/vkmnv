const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* Render port */
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

/* API KEYS */
const GROQ_API_KEY = process.env.API;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERPER_API_KEY = "d5b0d101f822182dd67294e6612b511eb1c797bd";

/* Hafıza */
const userContexts = new Map();

/* Arama terimleri üret */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Soruya EN GÜNCEL ve ANLIK cevabı verecek 4-6 kısa Google terimi üret. 'şu an', 'anlık', 'bugün saat', 'canlı', 'güncel', 'son dakika', '2026' gibi kelimeler ekle. Her terim yeni satır. Sadece terimler."
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.25,
                max_tokens: 160
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").filter(s => s.trim()).slice(0, 7);
    } catch {
        return [soru + " anlık güncel", soru + " şu an", soru + " bugün", soru];
    }
}

/* Veri toplama - answerBox ve knowledgeGraph öncelikli */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 15 },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 9000 }
            );

            // En değerli kısımlar önce
            if (res.data?.answerBox) {
                kaynaklar += `Google Cevap Kutusu (yüksek güvenilir): ${JSON.stringify(res.data.answerBox)}\n\n`;
            }
            if (res.data?.knowledgeGraph) {
                kaynaklar += `Bilgi Grafiği (güncel veri): ${JSON.stringify(res.data.knowledgeGraph)}\n\n`;
            }

            if (res.data?.organic) {
                kaynaklar += `Arama: "${altSoru}"\n`;
                kaynaklar += res.data.organic.slice(0, 9).map(r => {
                    const title = r.title ? r.title.slice(0, 110) + "..." : "";
                    let desc = r.description || r.snippet || "";
                    if (desc.length > 500) desc = desc.slice(0, 480) + "...";
                    return `[${r.source || ""} ${r.date ? r.date : ""}]: ${title} | \( {desc} ( \){r.link})`;
                }).join("\n") + "\n\n";
            }
        } catch (e) {
            console.log(`Serper hata (${altSoru}):`, e.message);
        }
    }
    return kaynaklar.trim() || "Arama sonuçları yetersiz.";
}

/* Ana cevap */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full', timeStyle: 'medium' });

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-3).map(h => `K: ${h.user.slice(0,220)}\nC: ${h.bot.slice(0,320)}`).join("\n---\n");

    const plan = await arastirmaPlaniHazirla(soru);
    console.log("Arama planı:", plan);

    const hamBilgi = await veriTopla(plan);
    console.log("Veri uzunluğu:", hamBilgi.length, "| İlk kısım:", hamBilgi.substring(0, 400));

    const systemPrompt = `
Sen SADECE verilen web verilerinden (özellikle Google answerBox, knowledgeGraph, snippet) bilgi çıkaran asistansın.
Uydurma veya kendi bilginle doldurma. Eğer net güncel/anlık veri yoksa veya snippet'ler yetersizse: "Anlık/güncel değerler snippet'lerde net görünmüyor, MGM/Kanal D/AccuWeather gibi resmi kaynaklara bakabilirsin" de.

Mümkünse en yakın veriyi belirt (tahmin varsa onu da ekle).
Her konuda EN GÜNCEL olanı seç:
- Hava: sıcaklık, hissedilen, nem, rüzgar, durum, saat
- Dizi: son bölüm, tarih
- Diğer: en yeni rakam/saat/tarih

TARİH/SAAT: ${tarihBilgisi}
GEÇMİŞ: ${historyText || "Yok"}

WEB VERİLERİ:
---
${hamBilgi || "Veri alınamadı."}
---

SORU: ${soru}

Kısa, net cevap ver. Rakamları tam yaz.`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Cevap ver." }],
                temperature: 0.0,
                max_tokens: 650
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let botCevap = res.data.choices[0].message.content.trim();

        history.push({ user: soru, bot: botCevap });
        if (history.length > 3) history.shift();
        userContexts.set(userId, history);

        return botCevap || "Veri yetersiz kaldı.";

    } catch (e) {
        console.error("Groq hata:", e);
        if (e.response?.status === 429) return "Rate limit doldu, biraz bekle kanka.";
        return "Teknik sorun çıktı.";
    }
}

/* Dinleyici */
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
                await new Promise(r => setTimeout(r, 800));
            }
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        msg.reply("Hata çıktı, tekrar dene.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} aktif - Güncel veri modu yumuşatıldı`);
});

client.login(DISCORD_TOKEN);