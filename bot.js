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

/* Arama terimleri üret - daha akıllı terimler için prompt güçlendirildi */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Kullanıcının sorusuna EN GÜNCEL cevabı verecek 3 kısa Google arama terimi üret. 'şu an', 'son bölüm', 'bugün', '2026' gibi kelimeler ekle. Her terim yeni satırda. Sadece terimleri yaz, açıklama yok."
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.2,
                max_tokens: 100
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").filter(s => s.trim()).slice(0, 4); // 4'e çıkardım
    } catch (e) {
        console.log("Plan hatası:", e.message);
        return [soru, soru + " 2026", soru + " güncel"];
    }
}

/* Veri toplama - snippet'leri zenginleştir + link + tarih ekle */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 8 }, // num=8 → daha fazla sonuç
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 7000 }
            );

            if (res.data?.organic) {
                kaynaklar += `Arama: "${altSoru}"\n`;
                kaynaklar += res.data.organic.slice(0, 6).map(r => {
                    let snippet = r.snippet || "İçerik yok";
                    if (snippet.length > 300) snippet = snippet.slice(0, 280) + "...";
                    return `[${r.source || "Kaynak"} - ${r.date || ""}]: \( {snippet} ( \){r.link})`;
                }).join("\n") + "\n\n";
            }
        } catch (e) {
            console.log(`Serper hata (${altSoru}):`, e.message);
        }
    }
    return kaynaklar.trim() || "Hiçbir arama sonucundan veri alınamadı.";
}

/* Ana cevap fonksiyonu - prompt çok daha katı ve net */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { 
        timeZone: 'Europe/Istanbul', 
        dateStyle: 'full', 
        timeStyle: 'short' 
    });

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-2).map(h => `K: ${h.user.slice(0,180)}\nC: ${h.bot.slice(0,250)}`).join("\n---\n");

    const plan = await arastirmaPlaniHazirla(soru);
    console.log("Arama planı:", plan);

    const hamBilgi = await veriTopla(plan);
    console.log("Toplanan veri uzunluğu:", hamBilgi.length, "karakter");

    const systemPrompt = `
Sen SADECE aşağıdaki web snippet'lerinden ve geçmişten bilgi çıkaran bir asistansın.
Uydurma, tahmin, genel bilgi verme. Verilen snippet'lerde yoksa "Güncel veri bulunamadı, lütfen başka kaynak kontrol et" de.
Soru hava durumu ise sıcaklık, nem, yağış durumunu ver.
Soru dizi ise son bölüm numarası, yayın tarihi ve kısa özet ver.
Matematik/dizi süresi ise 130 dk ortalama kullan.

TARİH: ${tarihBilgisi}

GEÇMİŞ:
${historyText || "Yok"}

WEB VERİLERİ (EN GÜNCEL KAYNAKLAR):
---
${hamBilgi || "Veri toplanamadı - arama sonuçları boş veya yetersiz."}
---

SORU: ${soru}

Cevap kısa, doğrudan ve sadece verilere dayalı olsun.`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Cevap ver." }
                ],
                temperature: 0.0,          // Daha az yaratıcılık → daha güvenilir
                max_tokens: 700,
                top_p: 0.95
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let botCevap = res.data.choices[0].message.content.trim();

        // Hafıza güncelle
        history.push({ user: soru, bot: botCevap });
        if (history.length > 3) history.shift(); // 3'e çıkardım, biraz daha bağlam
        userContexts.set(userId, history);

        return botCevap || "Cevap üretilemedi - veri yetersiz.";

    } catch (e) {
        console.error("Groq hatası:", e.response?.data || e);
        if (e.response?.status === 429) {
            return "Groq rate limit doldu. 20-60 saniye bekleyip tekrar dene.";
        }
        return "Teknik hata oluştu. Lütfen tekrar dene.";
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
        console.error("Mesaj işleme hatası:", err);
        msg.reply("Bir hata oluştu, tekrar dene.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} aktif - Güncel veri modu güçlendirildi (2026)`);
});

client.login(DISCORD_TOKEN);