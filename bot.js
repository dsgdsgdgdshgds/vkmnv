const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot çalışıyor!");
    res.end();
}).listen(8080 || process.env.PORT || 3000);

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

/* Güncel tarih yardımcı fonksiyonları */
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

/* ANA CEVAP FONKSİYONU */
async function dogrulanmisCevap(userId, soru) {
    const simdi = getCurrentTurkishDate();
    const yil = getCurrentYear();
    const ayGun = getCurrentMonthDay();

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `K: ${h.user}\nB: ${h.bot}`).join("\n───\n");

    // Arama terimleri üret
    let terimler = [];
    try {
        const terimRes = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "user",
                        content: `Soru: ${soru}\nTarih: \( {simdi}\nEN GÜNCEL 4-5 Google arama terimi üret ( \){yil} ve ${ayGun} ekle):`
                    }
                ],
                temperature: 0.2,
                max_tokens: 150
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        terimler = terimRes.data.choices[0].message.content
            .split("\n")
            .map(s => s.trim())
            .filter(s => s.length > 5);
    } catch (e) {
        terimler = [soru, `${soru} \( {yil}`, ` \){soru} ${simdi}`];
    }

    // Gerçek veriyi çek
    const hamBilgi = await veriTopla(terimler);

    const prompt = `
ŞU ANKİ TARİH: ${simdi} (Türkiye saati)

Önceki konuşma:
${historyText || "Henüz yok"}

KULLANICI SORUSU: ${soru}

GERÇEK ARAMA SONUÇLARI:
${hamBilgi || "Veri alınamadı."}

TALİMATLAR:
1. Yukarıdaki gerçek verileri oku ve değerlendir.
2. En güncel ve tutarlı bilgiyi seç.
3. Çelişkili bilgi varsa en yeni tarihli olanı önceliklendir ve belirt.
4. Kısa, net, doğrudan cevap ver (ideal 800-1800 karakter).
5. Tahmin gerekiyorsa mantıklı hesaplama yap (örneğin haftalık yayın ritmi Cuma, bölüm süresi ~130 dk).
6. "Bilmiyoruz" deme, mevcut veriden en iyi sonucu çıkar.

CEVAP:`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Verilen gerçek arama sonuçlarını kullanarak net ve güncel cevap ver. Kısa ve doğru ol. Gereksiz laf kalabalığı yapma."
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.12,
                max_tokens: 1200
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let cevap = res.data.choices[0].message.content.trim();

        // Hafıza güncelle
        history.push({ user: soru, bot: cevap });
        if (history.length > 5) history.shift();
        userContexts.set(userId, history);

        return cevap;
    } catch (e) {
        if (e.response?.status === 429) {
            const retryAfter = parseInt(e.response.headers['retry-after'] || '10', 10);
            console.log