const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot çalışıyor!");
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

/* ====== SOHBET GEÇMİŞİ + COOLDOWN ====== */
const userContexts = new Map();
const userLastProcess = new Map();

/* Güncel tarih helper */
function getCurrentTurkishDate() {
    const now = new Date();
    return now.toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        dateStyle: 'full',
        timeStyle: 'short'
    });
}

function getCurrentYear() {
    return new Date().getFullYear().toString();
}

function getCurrentMonthDay() {
    const now = new Date();
    return now.toLocaleDateString('tr-TR', { month: 'long', day: 'numeric' });
}

/* VERİ TOPLAMA */
async function veriTopla(altSorular) {
    let kaynaklar = "";
    for (const altSoru of altSorular) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 10 },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 10000 }
            );

            if (res.data?.organic) {
                kaynaklar += `Arama: ${altSoru}\n` +
                    res.data.organic.slice(0, 7).map(r => 
                        `• \( {r.title} ( \){r.date || 'Tarih yok'}) - ${r.snippet.substring(0, 220)}...`
                    ).join("\n") + "\n\n";
            }
        } catch (e) {
            // sessiz geç
        }
    }
    return kaynaklar.trim() || "Arama sonuçları alınamadı.";
}

/* TEK Groq çağrısı ile tüm işlem (arama terimi + özet + final cevap) */
async function dogrulanmisCevap(userId, soru) {
    const simdi = getCurrentTurkishDate();
    const yil = getCurrentYear();
    const ayGun = getCurrentMonthDay();

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `K: ${h.user}\nB: ${h.bot}`).join("\n───\n");

    const prompt = `
ŞU ANKİ TARİH: ${simdi} (Türkiye saati)

Önceki konuşma:
${historyText || "Henüz yok"}

KULLANICI SORUSU: ${soru}

TALİMATLAR:
1. Önce soruyu dikkatle oku ve tam olarak ne istendiğini anla.
2. Bu soruya EN GÜNCEL cevap verebilmek için Google'da aranması gereken 4-5 tane kısa ve etkili arama terimi üret. 
   Her zaman ${yil} yılını, ${ayGun} ay-gün bilgisini ve ${simdi} tam tarihini terimlere ekle.
   Her terimi ayrı satıra yaz.

3. Şimdi aşağıdaki gibi DÜŞÜN:
   - Bu terimlerle arama yapılsa en güncel bilgiler neler olurdu?
   - Hangi kaynak daha güvenilir ve yeni görünüyor?
   - Çelişkili bilgi varsa hangisi daha mantıklı / güncel?

4. En güncel bilgiye dayanarak KISA, NET ve DOĞRU bir cevap yaz.
   Cevap 800-1800 karakter arası olsun.
   Gereksiz giriş, selam, emoji kullanma.
   Eğer bilgi çelişkili veya eksikse bunu açıkça belirt.

CEVAP FORMATI:
[Arama Terimleri]
terim 1
terim 2
...

[Sentezlenmiş Cevap]
buraya nihai cevabı yaz

Şimdi başla:`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Soruyu tam anla. Önce 4-5 güncel arama terimi üret. Sonra bu terimlere dayanarak en güncel bilgiyi sentezle. Kısa, doğru, doğrudan cevap ver. Gereksiz laf kalabalığı yapma."
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.15,
                max_tokens: 1400
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let fullResponse = res.data.choices[0].message.content.trim();

        // Cevabı iki kısma ayır: terimler ve nihai cevap
        let cevap = fullResponse;
        if (fullResponse.includes("[Sentezlenmiş Cevap]")) {
            const parts = fullResponse.split("[Sentezlenmiş Cevap]");
            if (parts.length > 1) {
                cevap = parts[1].trim();
            }
        }

        // Hafıza güncelle
        history.push({ user: soru, bot: cevap });
        if (history.length > 5) history.shift();
        userContexts.set(userId, history);

        return cevap;
    } catch (e) {
        if (e.response && e.response.status === 429) {
            const retryAfter = parseInt(e.response.headers['retry-after'] || '10', 10);
            console.log(`Rate limit (429) → ${retryAfter} saniye bekleniyor...`);
            await new Promise(r => setTimeout(r, (retryAfter + 2) * 1000));
            
            // Tekrar dene (sadece 1 retry)
            try {
                const retryRes = await axios.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    // aynı body'yi tekrar gönder
                    {
                        model: "llama-3.1-8b-instant",
                        messages: [
                            { role: "system", content: "Soruyu tam anla. Önce 4-5 güncel arama terimi üret. Sonra bu terimlere dayanarak en güncel bilgiyi sentezle. Kısa, doğru, doğrudan cevap ver." },
                            { role: "user", content: prompt }
                        ],
                        temperature: 0.15,
                        max_tokens: 1400
                    },
                    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
                );
                let retryCevap = retryRes.data.choices[0].message.content.trim();
                if (retryCevap.includes("[Sentezlenmiş Cevap]")) {
                    retryCevap = retryCevap.split("[Sentezlenmiş Cevap]")[1]?.trim() || retryCevap;
                }
                return retryCevap;
            } catch (retryErr) {
                console.error("Retry da başarısız:", retryErr.message);
            }
        }

        console.error("Groq hatası:", e.message);
        return `Şu anda (${simdi}) Groq yoğun, lütfen 10-30 saniye sonra tekrar dene.`;
    }
}

/* MESAJ DİNLEYİCİ */
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (msg.mentions.everyone || msg.content.includes("@everyone") || msg.content.includes("@here")) return;
    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    const now = Date.now();
    const last = userLastProcess.get(msg.author.id) || 0;
    if (now - last < 4000) return; // 4 saniye cooldown
    userLastProcess.set(msg.author.id, now);

    try {
        await msg.channel.sendTyping();
        const cevap = await dogrulanmisCevap(msg.author.id, temizSoru);

        if (cevap.length > 2000) {
            const chunks = [];
            let rest = cevap;
            while (rest.length > 0 && chunks.length < 5) {
                let end = rest.lastIndexOf('\n', 1900) || 1900;
                chunks.push(rest.substring(0, end).trim());
                rest = rest.substring(end).trim();
            }
            if (rest.length > 0) chunks.push("... (çok uzun, kesildi)");

            for (let i = 0; i < chunks.length; i++) {
                if (i === 0) {
                    await msg.reply(chunks[i]);
                } else {
                    await msg.channel.send(chunks[i]);
                }
                if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 900));
            }
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        await msg.reply("Bir hata oluştu, lütfen tekrar dene.").catch(() => {});
    }
});

client.once("ready", () => {
    console.log(`Bot aktif → ${client.user.tag} | ${getCurrentTurkishDate()}`);
});

client.login(DISCORD_TOKEN).catch(err => console.error("Login hatası:", err));