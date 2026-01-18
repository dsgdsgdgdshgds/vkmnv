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

/* Zamanı hızlı teyit etmek için (gerektiğinde) */
async function gercekZamaniTeyitEt() {
    try {
        const res = await axios.post(
            "https://google.serper.dev/search",
            { q: "saat kaç Türkiye şu an", gl: "tr", hl: "tr" },
            { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 4000 }
        );

        if (res.data?.organic?.[0]?.snippet) {
            const snippet = res.data.organic[0].snippet.toLowerCase();
            const saatMatch = snippet.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m|öğlen|akşam|gece)?)/i);
            const tarihMatch = snippet.match(/(?:pazar|cumartesi|...|ocak|şubat|...)\s*\d{1,2},\s*\d{4}/i) ||
                               snippet.match(/\d{1,2}\s*(?:ocak|şubat|mart|...)\s*\d{4}/i);

            if (saatMatch || tarihMatch) {
                return {
                    bulundu: true,
                    saat: saatMatch ? saatMatch[0] : null,
                    tarih: tarihMatch ? tarihMatch[0] : null,
                    kaynak: res.data.organic[0].link || "serper"
                };
            }
        }
        return { bulundu: false };
    } catch {
        return { bulundu: false };
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

    let tarihSaatSorusuMu = /(saat kaç|saaat|kaçta|bugün tarih|şimdi tarih|kaç yılındayız|kaçıncı ay|günlerden ne|kaç ocak|kaç şubat|202[56])/i.test(soru);

    let gercekZamanBilgisi = "";
    if (tarihSaatSorusuMu) {
        // Sistem saati genellikle yeterlidir, ama şüpheli durumlarda teyit
        const teyit = await gercekZamaniTeyitEt();
        if (teyit.bulundu) {
            gercekZamanBilgisi = `\n(Sistem saati: ${sistemTarihSaat} — teyit: ${teyit.tarih || ''} ${teyit.saat || ''})`;
        } else {
            gercekZamanBilgisi = `\n(Sistem saati: ${sistemTarihSaat})`;
        }
    }

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-8).map(h => `Sen: ${h.user}\nBen: ${h.bot}`).join("\n\n");

    const systemPrompt = `
Şu an Türkiye saatiyle yaklaşık \( {sistemTarihSaat} civarı \){gercekZamanBilgisi}.

Sen samimi, esprili, doğal bir arkadaşsın. Türkçe konuşurken "kanka", "ya", "valla", "haha" falan kullanabilirsin.
- Kısa cevap verebiliyorsun, gerektiğinde uzatıyorsun
- Emoji severim 😄🔥👍
- Sohbeti devam ettir, soru sor
- Bilmediğin şeyi uydurma, serperden al.
- Her şeye internetten bakma; genel bilgi, sohbet, espri, tavsiye vs. için kendi bildiğinle devam et
- Sadece gerçekten güncel/dizi/spesifik/para/maç/haber v.b gibi konularda araştırma yap (ama tarih-saat sorularında sistem saatini kullan, gerekirse teyit et)

Önceki sohbet:
${historyText || "Yeni başladık, naber? 😏"}

Şimdi soru: ${soru}

Cevap ver (doğal, arkadaş gibi):
`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }],
                temperature: 0.9,
                max_tokens: 1000,
                top_p: 0.95
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let cevap = res.data.choices[0].message.content.trim();

        // Hafızayı güncelle
        history.push({ user: soru, bot: cevap });
        if (history.length > 12) history.shift();
        userContexts.set(userId, history);

        return cevap;
    } catch (e) {
        console.error(e);
        return "Ya bi an dondu her şey kanka 😅 Tekrar yazar mısın?";
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