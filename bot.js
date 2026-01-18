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
                        content: "Sen bir veri madencisisin. Kullanıcının sorusu için en güncel 3 arama terimi üret."
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.1,
                max_tokens: 100
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.split("\n").filter(s => s.trim().length > 2);
    } catch (e) { return [soru]; }
}

/* 2. ADIM: GENİŞLETİLMİŞ VERİ TOPLAMA */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular.slice(0, 3)) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr" },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 5000 }
            );
            if (res.data?.organic) {
                kaynaklar += res.data.organic.slice(0, 2).map(r => `[Bilgi]: ${r.snippet.substring(0, 300)}`).join("\n") + "\n";
            }
        } catch (e) { console.log("Arama başarısız."); }
    }
    return kaynaklar.trim();
}

/* 3. ADIM: MANTIKSAL SENTEZ VE CEVAP */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = await arastirmaPlaniHazirla(soru);
    const hamBilgi = await veriTopla(plan);

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `Kullanıcı: ${h.user}\nBot: ${h.bot}`).join("\n---\n");

    const synthesisPrompt = `
GÜNCEL SİSTEM TARİHİ: ${tarihBilgisi}

HAFIZA:
${historyText || "Henüz geçmiş yok."}

İNTERNET VERİLERİ:
---
${hamBilgi}
---

KULLANICI SORUSU: ${soru}

SİSTEM KURALLARI (GİZLİ):
1. Sayısal verilerde en güncel ve rasyonel olanı seç.
2. Matematiksel hesaplamaları arka planda hatasız yap.
3. Yanıtında asla "Kuralımıza göre", "Hesaplamalarıma göre" gibi teknik açıklamalar yapma.
4. Sadece doğrudan cevabı ver.
`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Sen matematiksel hata yapmayan, rasyonel ve sadece sonuca odaklanan bir bilgi uzmanısın. İç mantığını kullanıcıya açıklama, sadece sonucu söyle." },
                    { role: "user", content: synthesisPrompt }
                ],
                temperature: 0,
                max_tokens: 800,
                stop: ["KULLANICI SORUSU:", "GÜNCEL SİSTEM TARİHİ:"]
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const botCevap = res.data.choices[0].message.content.trim();

        history.push({ user: soru, bot: botCevap });
        if (history.length > 2) history.shift();
        userContexts.set(userId, history);

        return botCevap;
    } catch (e) {
        return "Şu an teknik bir aksaklık nedeniyle cevap veremiyorum.";
    }
}

/* ========== DISCORD MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();

    try {
        await msg.channel.sendTyping();
        const cevap = await dogrulanmisCevap(msg.author.id, temizSoru);

        if (cevap.length > 2000) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g).slice(0, 2); 
            for (const chunk of chunks) await msg.reply(chunk);
        } else {
            msg.reply(cevap);
        }
    } catch (err) {
        msg.reply("Bir sorun oluştu.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} sistemi 2026 zaman algısıyla başlatıldı.`);
    console.log(`Geliştirici: Batuhan Aktaş Giresun/Bulancak KAFMTAL`);
});

client.login(DISCORD_TOKEN);
