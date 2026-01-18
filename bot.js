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

/* 1. ADIM: ARAMA PLANI */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Sen bir veri madencisisin. 2026 yılındayız. Soru için güncel dizi/haber terimleri üret. Sohbetse 'GEREKSIZ' yaz."
                    },
                    { role: "user", content: soru }
                ],
                max_tokens: 50,
                temperature: 0.1
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        const text = res.data.choices[0].message.content.trim();
        if (text.includes("GEREKSIZ")) return null;
        return text.split("\n").filter(s => s.trim().length > 2);
    } catch (e) { return null; }
}

/* 2. ADIM: VERİ TOPLAMA */
async function veriTopla(altSorular) {
    if (!altSorular) return "";
    let kaynaklar = "";
    for (const altSoru of altSorular.slice(0, 2)) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr" },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 5000 }
            );
            if (res.data?.organic) {
                kaynaklar += res.data.organic.slice(0, 4).map(r => `[Bilgi]: ${r.snippet.substring(0, 200)}`).join("\n") + "\n";
            }
        } catch (e) { console.log("Arama hatası."); }
    }
    return kaynaklar.trim();
}

/* 3. ADIM: SENTEZ VE ZAMAN ALGISI */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    // Botun her zaman 2026'da olduğunu bilmesi için sabit tarih bilgisi
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    
    const plan = await arastirmaPlaniHazirla(soru);
    const hamBilgi = await veriTopla(plan);

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `K: ${h.user}\nB: ${h.bot.substring(0, 100)}...`).join("\n---\n");

    const synthesisPrompt = `
ŞU ANKİ TARİH: ${tarihBilgisi}
ZAMAN ALGISI: Şu an 2026 yılındayız. Tüm hesaplamaları buna göre yap.

HAFIZA: ${historyText || "Yok"}
İNTERNET VERİLERİ:
---
${hamBilgi}
---

KESİN KURALLAR:
1. **Zaman:** Eğer internet verisi 2024/2025 diyorsa, o verinin üzerine 2026 yılına kadar geçen süreyi/bölümleri rasyonel olarak ekle.
2. **Arka Sokaklar:** Bölüm sayılarını ve 130 dk kuralını asla unutma.
3. **İç Ses Yasağı:** Cevapta "Düşünüyorum, 2026 yılındayız o yüzden..." gibi açıklamalar yapma. Direkt sonucu söyle.
4. **Etiket:** @everyone/@here etiketlerine asla takılma.

KULLANICI SORUSU: ${soru}`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Sen 2026 yılında yaşayan rasyonel bir bilgi uzmanısın. Sadece net cevap ver." },
                    { role: "user", content: synthesisPrompt }
                ],
                temperature: 0.1,
                max_tokens: 800,
                stop: ["KULLANICI SORUSU:", "Düşünce:"]
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
    if (msg.author.bot || !msg.mentions.has(client.user) || msg.mentions.everyone) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    try {
        await msg.channel.sendTyping();
        const cevap = await dogrulanmisCevap(msg.author.id, temizSoru);
        
        if (cevap.length > 2000) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) await msg.reply(chunk);
        } else {
            msg.reply(cevap);
        }
    } catch (err) {
        msg.reply("Bir sorun oluştu.");
    }
});

client.once("ready", () => {
    console.log(`✅ Bot 2026 zaman algısı ve Arka Sokaklar kurallarıyla aktif.`);
});

client.login(DISCORD_TOKEN);
