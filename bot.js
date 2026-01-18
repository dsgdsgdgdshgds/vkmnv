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

/* 1. ADIM: ARAMA GEREKLİLİK KONTROLÜ VE TERİM ÜRETİCİ */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Sen bir veri madencisisin. Kullanıcının sorusu güncel bilgi (Arka Sokaklar vb.) gerektiriyorsa 2 teknik terim üret. Sohbet ise 'GEREKSIZ' yaz."
                    },
                    { role: "user", content: soru }
                ],
                max_tokens: 50,
                temperature: 0.1
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        const text = res.data.choices[0].message.content;
        if (text.includes("GEREKSIZ")) return null;
        return text.split("\n").filter(s => s.trim().length > 2);
    } catch (e) { return null; }
}

/* 2. ADIM: VERİ TOPLAMA (TOKEN TASARRUFLU) */
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
                // Snippet'ları kırparak token sınırı bugını çözüyoruz
                kaynaklar += res.data.organic.slice(0, 3).map(r => `[Bilgi]: ${r.snippet.substring(0, 200)}`).join("\n") + "\n";
            }
        } catch (e) { console.log("Arama başarısız."); }
    }
    return kaynaklar.trim();
}

/* 3. ADIM: MANTIKSAL SENTEZ, GEÇMİŞ VE ARKA SOKAKLAR HESAPLAMA */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    
    const plan = await arastirmaPlaniHazirla(soru);
    const hamBilgi = await veriTopla(plan);

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `Kullanıcı: ${h.user}\nBot: ${h.bot.substring(0, 150)}...`).join("\n---\n");

    const synthesisPrompt = `
GÜNCEL SİSTEM TARİHİ: ${tarihBilgisi}

ÖNCEKİ KONUŞMALAR (HAFIZA):
${historyText || "Henüz geçmiş yok."}

HATA DENETİMİ VE KURALLAR:
1. **Sayısal Karşılaştırma:** Eğer bir dizi (özellikle Arka Sokaklar) hakkında farklı sayılar varsa, kronolojik olarak en mantıklı ve yüksek olanı seç.
2. **Matematik:** Hesaplamalarda (gün/saat) toplam bölüm ve 130 dk ortalamayı baz al.
3. **Bağlam:** Eğer kullanıcı "o", "onu", "önceki" gibi ifadeler kullanırsa hafızadaki bilgilere bak.
4. **Sınır:** Sadece soruyu cevapla, 50 kere tekrar yapma, rasyonel ol.

İNTERNET VERİLERİ:
---
${hamBilgi}
---

KULLANICI SORUSU: ${soru}
`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b",
                messages: [
                    { role: "system", content: "Sen rasyonel, matematiksel hataları engelleyen ve sadece en güncel veriye odaklanan bir bilgi uzmanısın." },
                    { role: "user", content: synthesisPrompt }
                ],
                temperature: 0.2, // Bug/tekrara girmemesi için 0.2 ideal
                max_tokens: 1000,
                stop: ["KULLANICI SORUSU:", "ÖNCEKİ KONUŞMALAR:"]
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const botCevap = res.data.choices[0].message.content;

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
    // Bot engeli, Etiket kontrolü ve @everyone/@here ENGELLEME
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
        msg.reply("Bir sorun oluştu. Lütfen tekrar deneyin.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} sistemi 2026 zaman algısı ve Arka Sokaklar kurallarıyla aktif.`);
});

client.login(DISCORD_TOKEN);
