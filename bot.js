const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot çalışıyor kanka!");
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
const SERPER_API_KEY = "d5b0d101f822182dd67294e6612b511eb1c797bd"; // sadece gerektiğinde kullanılır

/* ====== SOHBET GEÇMİŞİ (daha uzun hafıza) ====== */
const userContexts = new Map(); // userId → array of {user, bot}

/* ========== ANA SOHBET FONKSİYONU ========== */
async function samimiCevapVer(userId, soru) {
    const simdi = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-6).map(h => `Sen: ${h.user}\nBen: ${h.bot}`).join("\n\n");

    // Sistem prompt'u → ChatGPT gibi doğal, samimi, arkadaşça
    const systemPrompt = `
Şu an ${simdi} yılındayız, Türkiye'deyiz.

Sen çok doğal, samimi, esprili bir arkadaşsın. İnsan gibi konuşuyorsun:
- Kısa ve öz olabiliyorsun ama gerektiğinde detay veriyorsun
- Arada emoji kullanıyorsun 😄👍
- Soru soruyorsun, sohbeti devam ettiriyorsun
- Resmi kelimelerden kaçın (yani "sayın kullanıcı" yok, "kanka", "ya", "valla" falan serbest)
- Bilmediğin şeyi uydurma ama "tam hatırlamıyorum, bi bakayım mı?" diyebilirsin
- Her soruya illa internetten bakma; bildiğin şeyleri direkt söyle
- Sadece gerçekten güncel/spesifik/şüpheli bir şeyse (mesela "bugün dolar kaç?", "dün maç sonucu ne oldu?") araştırma yap

Önceki konuşma:
${historyText || "Henüz sohbetimiz yok, tanışalım mı? 😏"}

Şimdi kullanıcı dedi ki: ${soru}

Cevap ver (doğal Türkçe, arkadaş gibi):
`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile", // veya mixtral-large, daha doğal için
                messages: [
                    { role: "system", content: systemPrompt },
                    // son kullanıcı mesajı zaten prompt içinde
                ],
                temperature: 0.85,          // biraz yaratıcılık + doğal akış
                max_tokens: 900,
                top_p: 0.92
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let cevap = res.data.choices[0].message.content.trim();

        // Araştırma ihtiyacı var mı? (basit kural)
        const araştırmaGerektirenKelime = ["kaç", "güncel", "son", "bugün", "dün", "2026", "sonuç", "fiyat", "haber", "skor"];
        const araştırmaGerekli = araştırmaGerektirenKelime.some(k => soru.toLowerCase().includes(k)) && 
                                !soru.toLowerCase().includes("bana göre") && 
                                !soru.toLowerCase().includes("sence");

        if (araştırmaGerekli) {
            // Hafif araştırma ekle (opsiyonel, kısa tut)
            cevap += "\n\nBi' saniye taze bakayım mı durumuna... 😎";
            // burada istersen Serper çağırıp ek bilgi katabilirsin, ama kısa tut
        }

        // Hafızayı güncelle (son 8-10 tutalım ki sohbet akışı bozulmasın)
        history.push({ user: soru, bot: cevap });
        if (history.length > 10) history.shift();
        userContexts.set(userId, history);

        return cevap;
    } catch (e) {
        console.error(e);
        return "Off ya, bi an takıldım kanka 😅 Tekrar söyler misin?";
    }
}

/* ========== MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return msg.reply("Ne diyon kanka? 😄");

    try {
        await msg.channel.sendTyping();
        const cevap = await samimiCevapVer(msg.author.id, temizSoru);

        // Cevap uzun olursa parçala
        if (cevap.length > 2000) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) await msg.reply(chunk);
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        await msg.reply("Bir şey oldu ya, kusura bakma bi daha dene 🙏");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} online – artık kanka modundayım! 🚀`);
});

client.login(DISCORD_TOKEN).catch(err => {
    console.error("Login olmadı:", err);
});