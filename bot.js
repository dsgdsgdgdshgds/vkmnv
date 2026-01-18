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
const SERPER_API_KEY = "d5b0d101f822182dd67294e6612b511eb1c797bd";

/* ====== SOHBET GEÇMİŞİ ====== */
const userContexts = new Map();

/* Hızlı güncel veri çekme fonksiyonu (dolar, saat vs. için) */
async function guncelVeriCek(query) {
    try {
        const res = await axios.post(
            "https://google.serper.dev/search",
            { q: query, gl: "tr", hl: "tr", num: 6 },
            { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 5000 }
        );
        if (res.data?.organic?.length > 0) {
            return res.data.organic
                .slice(0, 4)
                .map(r => r.snippet || r.title)
                .join(" | ");
        }
        return "";
    } catch {
        return "";
    }
}

/* ========== ANA SOHBET FONKSİYONU ========== */
async function samimiCevapVer(userId, soru) {
    const yerelSimdi = new Date();
    const sistemTarihSaat = yerelSimdi.toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        dateStyle: 'full',
        timeStyle: 'short'
    });

    let tarihSaatSorusuMu = /(saat kaç|saaat|kaçta|bugün tarih|şimdi tarih|kaç yılındayız|kaçıncı ay|günlerden ne)/i.test(soru);
    let guncelKurSorusuMu = /(dolar|dolar kuru|usd try|kaç tl|kur ne kadar)/i.test(soru);

    let ekBilgi = "";
    if (tarihSaatSorusuMu) {
        ekBilgi = `(Şu an Türkiye saatiyle ${sistemTarihSaat})`;
    } else if (guncelKurSorusuMu) {
        const veri = await guncelVeriCek("dolar kuru şu an Türkiye serbest piyasa");
        if (veri) {
            ekBilgi = `(Güncel veri: ${veri})`;
        }
    }

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-8).map(h => `Sen: ${h.user}\nBen: ${h.bot}`).join("\n\n");

    const systemPrompt = `
Şu an Türkiye saatiyle yaklaşık \( {sistemTarihSaat} civarı \){ekBilgi ? ' → ' + ekBilgi : ''}.

Sen samimi, doğal, esprili bir kankasın. Türkçe'de "kanka", "ya", "valla", "haha" falan kullan.
- Kısa ve net olabildiğin kadar kısa ol, gerektiğinde detay ver
- Emoji kullan 👍😄🔥
- Sohbeti devam ettir ama zorlama
- Güncel veri (dolar, saat, maç sonucu, haber vs.) gereken sorularda LAFLA UZATMA, direkt net bilgi ver
- Bilmiyorsan veya veri eskiyse "En güncel hali şöyle görünüyor" deyip kaynağı belirt
- Tahmin etme, uydurma
- Genel sohbet, espri, tavsiye vs. için araştırma yapma, bildiğinle devam et

Önceki sohbet:
${historyText || "Yeni başladık kanka, naber? 😏"}

Soru: ${soru}

Cevap ver (doğal, arkadaş gibi, net):
`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }],
                temperature: 0.8,
                max_tokens: 800,
                top_p: 0.92
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let cevap = res.data.choices[0].message.content.trim();

        // Hafızayı güncelle
        history.push({ user: soru, bot: cevap });
        if (history.length > 10) history.shift();
        userContexts.set(userId, history);

        return cevap;
    } catch (e) {
        console.error(e);
        return "Ya bi an takıldım kanka 😅 Tekrar söyler misin?";
    }
}

/* ========== MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (temizSoru.length < 1) return msg.reply("Ne diyon ya? 😆");

    try {
        await msg.channel.sendTyping();
        const cevap = await samimiCevapVer(msg.author.id, temizSoru);

        if (cevap.length > 2000) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) await msg.reply(chunk);
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        await msg.reply("Bir tuhaflık oldu, kusura bakma bi daha dene 🙏");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} kanka modunda aktif – ${new Date().toLocaleString('tr-TR')}`);
});

client.login(DISCORD_TOKEN).catch(err => {
    console.error("Login fail:", err);
});