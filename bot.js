const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot Calisiyor!");
    res.end();
}).listen(8080);

const client = new Client({
    intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ]
});

/* ====== API AYARLARI ====== */
const GROQ_API_KEY = process.env.API;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; 
const SERPER_API_KEY = "d5b0d101f822182dd67294e6612b511eb1c797bd";

/* ====== SOHBET GEÇMİŞİ ====== */
const userContexts = new Map();

/* 1. ADIM: DİNAMİK ARAMA SORGUSU */
async function arastirmaPlaniHazirla(soru, suAnkiTarih) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `Sistem Tarihi: ${suAnkiTarih}. Kullanıcı dizi/güncel bilgi soruyorsa bu tarihe en yakın veriyi bulmak için 2 terim üret. Sohbetse 'GEREKSIZ' yaz.`
                    },
                    { role: "user", content: soru }
                ],
                max_tokens: 50,
                temperature: 0.1
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        const text = res.data.choices[0].message.content.trim();
        return text.includes("GEREKSIZ") ? null : text.split("\n").filter(s => s.trim().length > 2);
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
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 6000 }
            );
            if (res.data?.organic) {
                kaynaklar += res.data.organic.slice(0, 4).map(r => `[Bilgi]: ${r.snippet}`).join("\n") + "\n";
            }
        } catch (e) { console.log("Arama hatası."); }
    }
    return kaynaklar.trim();
}

/* 3. ADIM: SENTEZ VE CEVAP */
async function dogrulanmisCevap(userId, soru) {
    // Gerçek zamanlı tarih alımı
    const simdi = new Date();
    const suAnkiTarih = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    
    const plan = await arastirmaPlaniHazirla(soru, suAnkiTarih);
    const hamBilgi = await veriTopla(plan);

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `U: ${h.user}\nB: ${h.bot.substring(0, 100)}`).join("\n---\n");

    const synthesisPrompt = `
SİSTEM ZAMANI: ${suAnkiTarih}
İNTERNET VERİLERİ:
${hamBilgi}

KURALLAR:
1. **Zaman Uyumu:** İnternet verileri sistem zamanından eskiyse, aradaki farkı (haftalık bölüm yayını vb.) mantıksal olarak hesapla ve bugüne uyarla.
2. **Matematik:** Arka Sokaklar gibi dizilerde toplam bölüm sayısını 130 dakika ile çarp.
3. **Sadelik:** Sorulmadığı sürece cevaba "Bugün şu tarihteyiz" veya "Verileri kontrol ettim" gibi cümleler ekleme. Direkt cevabı ver.
4. **İç Ses:** Analizlerini dışa vurma.

HAFIZA: ${historyText || "Yok"}
SORU: ${soru}`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Sen rasyonel bir bilgi uzmanısın. Sistem zamanını kullanarak en güncel sonucu hesapla ve sadece cevabı söyle." },
                    { role: "user", content: synthesisPrompt }
                ],
                temperature: 0.1,
                max_tokens: 800,
                stop: ["SORU:", "SİSTEM ZAMANI:"]
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const botCevap = res.data.choices[0].message.content.trim();
        history.push({ user: soru, bot: botCevap });
        if (history.length > 2) history.shift();
        userContexts.set(userId, history);

        return botCevap;
    } catch (e) {
        return "Şu an cevap veremiyorum.";
    }
}

/* ========== DISCORD MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    // Bot engeli, Etiketsiz mesaj engeli ve everyone/here engeli
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
        msg.reply("Bir hata oluştu.");
    }
});

client.once("ready", () => {
    console.log(`✅ Bot dinamik tarih algısıyla aktif.`);
});

client.login(DISCORD_TOKEN);
