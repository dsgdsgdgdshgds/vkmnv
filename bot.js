const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* Render port ayarı */
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

/* Arama terimleri üret - tamamen doğal ve güncel odaklı */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Kullanıcının sorusuna EN GÜNCEL, ANLIK ve DOĞRU cevabı verecek 4-5 kısa Google arama terimi üret. 'şu an', 'anlık', 'bugün', 'son dakika', 'güncel 2026', 'canlı' gibi kelimeler ekle. Her terim yeni satırda. Sadece terimler yaz, açıklama yok."
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.2,
                max_tokens: 140
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").filter(s => s.trim()).slice(0, 6);
    } catch (e) {
        console.log("Plan hatası:", e.message);
        return [soru + " anlık güncel", soru + " bugün", soru + " 2026", soru];
    }
}

/* Veri toplama - knowledgeGraph + answerBox + organic hepsini al */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 12 },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 8000 }
            );

            // KnowledgeGraph ve AnswerBox varsa direkt ekle (çok değerli)
            if (res.data?.knowledgeGraph) {
                kaynaklar += `Hızlı Bilgi (Knowledge Graph): ${JSON.stringify(res.data.knowledgeGraph, null, 2)}\n\n`;
            }
            if (res.data?.answerBox) {
                kaynaklar += `Cevap Kutusu: ${JSON.stringify(res.data.answerBox, null, 2)}\n\n`;
            }

            if (res.data?.organic) {
                kaynaklar += `Arama: "${altSoru}"\n`;
                kaynaklar += res.data.organic.slice(0, 8).map(r => {
                    const title = r.title ? r.title.slice(0, 100) + (r.title.length > 100 ? "..." : "") : "";
                    let desc = r.description || r.snippet || "Veri yok";
                    if (desc.length > 450) desc = desc.slice(0, 430) + "...";
                    return `[${r.source || "Kaynak"} ${r.date ? `- ${r.date}` : ""}]: ${title} | \( {desc} ( \){r.link || "link yok"})`;
                }).join("\n") + "\n\n";
            }
        } catch (e) {
            console.log(`Serper hata (${altSoru}):`, e.message);
        }
    }
    return kaynaklar.trim() || "Arama sonuçları boş veya yetersiz kaldı.";
}

/* Ana cevap fonksiyonu */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full', timeStyle: 'medium' });

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-3).map(h => `K: ${h.user.slice(0,220)}\nC: ${h.bot.slice(0,320)}`).join("\n---\n");

    const plan = await arastirmaPlaniHazirla(soru);
    console.log("Arama planı:", plan);

    const hamBilgi = await veriTopla(plan);
    console.log("Toplanan veri uzunluğu:", hamBilgi.length, " | İlk 300 char:", hamBilgi.substring(0, 300));

    const systemPrompt = `
Sen SADECE verilen web verilerinden (knowledgeGraph, answerBox, snippet, title, description) bilgi çıkaran bir asistansın.
Kendi bilginle veya tahminle cevap verme. Verilerde net güncel bilgi yoksa "Güncel veri snippet'lerde görünmüyor, başka kaynaktan bakabilirsin" de.

Her konuda EN GÜNCEL veriyi seç:
- Hava durumu: anlık sıcaklık, hissedilen, nem, rüzgar, durum, güncelleme saati
- Dizi/film: son bölüm no, yayın tarihi, özet
- Spor/maç: canlı skor, dakika, olaylar
- Diğer: en yeni rakam/tarih/saat

TARİH/SAAT (Türkiye): ${tarihBilgisi}
GEÇMİŞ:
${historyText || "Yok"}

WEB VERİLERİ:
---
${hamBilgi || "Hiç veri alınamadı."}
---

SORU: ${soru}

Cevap kısa, net, rakam/saat/tarih tam olsun.`;
 
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Cevap ver." }],
                temperature: 0.0,
                max_tokens: 700,
                top_p: 0.9
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let botCevap = res.data.choices[0].message.content.trim();

        history.push({ user: soru, bot: botCevap });
        if (history.length > 3) history.shift();
        userContexts.set(userId, history);

        return botCevap || "Veri yetersiz.";

    } catch (e) {
        console.error("Groq hatası:", e.response?.data || e.message);
        if (e.response?.status === 429) return "Rate limit doldu kanka, 30-90 sn bekle.";
        return "Teknik bi aksilik oldu.";
    }
}

/* Mesaj dinleyici */
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
        console.error("Mesaj hatası:", err);
        msg.reply("Bi hata çıktı, tekrar dene kanka.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} aktif - Genel güncel veri modu (site kısıtlaması yok)`);
});

client.login(DISCORD_TOKEN);