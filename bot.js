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

/* Arama terimleri üret - anlık vurgu artırıldı */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Soruya EN ANLIK ve GÜNCEL cevabı verecek 5 kısa Google arama terimi üret. 'şu an saat', 'anlık', 'canlı', 'bugün güncel', 'son dakika', '2026 şimdi' gibi kelimeler mutlaka ekle. Her terim yeni satır. Sadece terimler yaz."
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.25,
                max_tokens: 180
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").filter(s => s.trim()).slice(0, 7);
    } catch {
        return [soru + " anlık şu an", soru + " güncel bugün", soru + " canlı", soru];
    }
}

/* Veri toplama - answerBox/knowledgeGraph öncelikli, snippet zengin */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 15 },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 9000 }
            );

            // En değerli veriler önce
            if (res.data?.answerBox) {
                kaynaklar += `Google Hızlı Cevap (answerBox - çok güvenilir): ${JSON.stringify(res.data.answerBox, null, 2)}\n\n`;
            }
            if (res.data?.knowledgeGraph) {
                kaynaklar += `Bilgi Grafiği (knowledgeGraph - güncel veri): ${JSON.stringify(res.data.knowledgeGraph, null, 2)}\n\n`;
            }

            if (res.data?.organic) {
                kaynaklar += `Arama sorgusu: "${altSoru}"\n`;
                kaynaklar += res.data.organic.slice(0, 10).map(r => {
                    const title = r.title ? r.title.slice(0, 120) + "..." : "";
                    let desc = r.description || r.snippet || "";
                    if (desc.length > 550) desc = desc.slice(0, 530) + "...";
                    return `[${r.source || ""} ${r.date ? r.date : ""}]: ${title} | \( {desc} ( \){r.link || "link yok"})`;
                }).join("\n") + "\n\n";
            }
        } catch (e) {
            console.log(`Serper hatası (${altSoru}):`, e.message);
        }
    }
    return kaynaklar.trim() || "Arama sonuçları yetersiz veya boş döndü.";
}

/* Ana cevap fonksiyonu - prompt esnetildi, veri yetersizse daha akıllı yönlendirme */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full', timeStyle: 'medium' });

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-3).map(h => `K: ${h.user.slice(0,220)}\nC: ${h.bot.slice(0,320)}`).join("\n---\n");

    const plan = await arastirmaPlaniHazirla(soru);
    console.log("Arama planı:", plan.join(" | "));

    const hamBilgi = await veriTopla(plan);
    console.log("Toplanan veri uzunluğu:", hamBilgi.length, "karakter | İlk 400:", hamBilgi.substring(0, 400));

    const systemPrompt = `
Sen SADECE verilen web verilerinden (özellikle answerBox, knowledgeGraph, snippet, title) bilgi çıkaran bir asistansın.
Kendi bilginle veya tahminle doldurma. Verilerde net anlık/güncel değer yoksa veya yetersizse: "Anlık değerler snippet'lerde net görünmüyor, resmi kaynaklara (MGM, AccuWeather, Kanal D vs.) bakabilirsin" de.

Eğer answerBox veya knowledgeGraph varsa onları KESİNLİKLE öncelikli kullan – bunlar en güncel veriyi taşır.
Yaklaşık değer veya tahmin varsa belirt (ama net değilse söyle).

TARİH/SAAT (Türkiye): ${tarihBilgisi}
GEÇMİŞ: ${historyText || "Yok"}

WEB VERİLERİ:
---
${hamBilgi || "Veri alınamadı veya boş."}
---

SORU: ${soru}

Cevap kısa, net olsun. Rakam/saat/tarih tam yaz.`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Şimdi soruya cevap ver." }],
                temperature: 0.0,
                max_tokens: 700,
                top_p: 0.92
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let botCevap = res.data.choices[0].message.content.trim();

        history.push({ user: soru, bot: botCevap });
        if (history.length > 3) history.shift();
        userContexts.set(userId, history);

        return botCevap || "Veri yetersiz kaldı.";

    } catch (e) {
        console.error("Groq hatası:", e.response?.data || e.message);
        if (e.response?.status === 429) return "Groq limitine takıldık, 30-90 saniye bekle.";
        return "Teknik hata çıktı, tekrar dene.";
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
        msg.reply("Bir hata çıktı, tekrar dene.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} aktif - Veri çekimi yumuşatıldı, answerBox öncelikli`);
});

client.login(DISCORD_TOKEN);