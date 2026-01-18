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

/* 1. ARAMA TERİMİ ÜRETİCİ - Soruya göre çok daha akıllı ve güncel odaklı */
async function arastirmaPlaniHazirla(soru) {
    const simdi = getCurrentTurkishDate();
    const yil = getCurrentYear();
    const ayGun = getCurrentMonthDay();

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `Kullanıcının sorusunu dikkatle oku ve tam olarak ne istediğini anla.
EN GÜNCEL bilgiyi almak için Google'da aranacak 4-5 tane TERİM üret.
Her zaman şu anki tarihi (\( {simdi}) ve yılı ( \){yil}) ekle.
Soru ne hakkında ise (dizi bölüm sayısı, maç sonucu, hava durumu, fiyat, haber vs.) o konuya özel güncel terimler üret.
Her satıra bir tane terim yaz. Kısa, net, kesin ol.`
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.25,
                max_tokens: 200
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let terimler = res.data.choices[0].message.content
            .split("\n")
            .map(s => s.trim())
            .filter(s => s.length > 8 && !s.startsWith('-') && !s.startsWith('*'));

        // Eğer çok az çıktıysa fallback
        if (terimler.length < 3) {
            terimler = [
                soru,
                `${soru} ${yil}`,
                `${soru} ${ayGun} ${yil}`,
                `${soru} güncel`,
                `${soru} son durum`
            ];
        }

        return terimler.slice(0, 5);
    } catch (e) {
        return [
            soru,
            `${soru} ${yil}`,
            `${soru} ${simdi}`,
            `${soru} güncel`
        ];
    }
}

/* ÖZETLEME - En güncel bilgileri öne çıkar */
async function ozetleBilgi(hamBilgi) {
    if (hamBilgi.length < 2800) return hamBilgi;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Bu arama sonuçlarını oku. En güncel tarihli bilgileri öne çıkar. Çelişkili veriler varsa hangisinin daha yeni olduğunu belirt. Maksimum 2000 karaktere indirge. Türkçe yaz."
                    },
                    { role: "user", content: hamBilgi }
                ],
                temperature: 0.1,
                max_tokens: 650
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return res.data.choices[0].message.content.trim();
    } catch {
        return hamBilgi.substring(0, 6500) + "\n(kısaltıldı)";
    }
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

    const plan = await arastirmaPlaniHazirla(soru);
    let hamBilgi = await veriTopla(plan);
    hamBilgi = await ozetleBilgi(hamBilgi);

    let history = userContexts.get(userId) || [];
    let historyText = history.map(h => `K: ${h.user}\nB: ${h.bot}`).join("\n───\n");

    const prompt = `
ŞU ANKİ TARİH: ${simdi} (Türkiye saati) ── CEVABINI MUTLAKA BU TARİHE EN YAKIN BİLGİLERE DAYANDIR!

Önceki konuşma:
${historyText || "Henüz yok"}

KURALLAR:
1. Arama sonuçlarını AYRI AYRI oku ve değerlendir.
2. Farklı kaynaklarda çelişki varsa: en yeni tarihli olanı, en resmi/otomatik olanı önceliklendir.
3. Kullanıcı tam olarak ne istediğini anla ve SADECE ona odaklan.
4. Güncel veri yoksa veya çelişkiliyse bunu açıkça söyle.
5. Cevabı kısa, net ve doğrudan tut (800-2200 karakter arası ideal).
6. Kaynak belirtmek faydalıysa kısaça belirt.

ARAMA SONUÇLARI (en güncel olanlar öne çıksın):
${hamBilgi || "Yeterli veri alınamadı."}

Soru: ${soru}

Cevap:`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "Soruyu tam anla. Ayrı ayrı bilgileri sentezle. En güncel veriyi kullan. Kısa, doğru, net cevap ver. Gereksiz laf kalabalığı yapma."
                    },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
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
        console.error("Groq hatası:", e.message);
        return `Şu anda (${simdi}) cevap üretilemiyor. Lütfen biraz sonra tekrar dene.`;
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
    if (now - last < 2000) return;
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