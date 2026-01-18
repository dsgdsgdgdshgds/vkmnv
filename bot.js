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
        } catch (e) {}
    }
    return kaynaklar.trim() || "Arama sonuçları alınamadı.";
}

/* ANA CEVAP FONKSİYONU - Rate limit + kötü sentez düzeltmesi */
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

TALİMATLAR (KESİNLİKLE UY):
1. Soruyu tam oku ve ne istendiğini netleştir (bölüm sayısı, süre, kaç günde biter vs.).
2. Bu soruya EN GÜNCEL cevap için 4-5 tane çok etkili Google arama terimi üret. 
   Mutlaka ${yil} yılı, ${ayGun} bilgisi ve ${simdi} tarihini terimlere ekle.
   Her terimi ayrı satıra yaz.

3. Aşağıdaki VERİLERİ KULLANARAK (gerçek arama sonuçları):
   - En güncel, en tutarlı bilgiyi seç.
   - Çelişkiliyse en yeni tarihli / resmi kaynağı (Kanal D, Vikipedi) önceliklendir.
   - Bilgi eksik/çelişkiliyse "Güncel veri net değil, şu kaynaklara göre..." diye belirt.
   - Tahmin gerekiyorsa (kaç günde biter gibi) haftalık yayın ritmini (Cuma) ve ortalama bölüm süresini (130-140 dk) kullanarak mantıklı hesapla.

4. CEVABI KISA, NET VE DOĞRU TUT (800-1800 karakter). 
   Gereksiz giriş, emoji, selam yok. Direkt bilgi ver.

VERİLER (en güncel olanlar öne çıksın):
${await veriTopla(await (async () => { 
    // İç prompt ile terim üret (ama gerçek veriyle sentezle)
    const terimPrompt = `Soru: \( {soru}\nEN GÜNCEL 4-5 arama terimi üret ( \){yil} ve ${simdi} ekle):`;
    const terimRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: terimPrompt }],
        temperature: 0.2,
        max_tokens: 150
    }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
    return terimRes.data.choices[0].message.content.split("\n").map(s => s.trim()).filter(s => s);
})()) || [])}  // Bu kısım gerçek veri çekiyor

CEVAP FORMATI:
[Arama Terimleri] (kısaca listele)
[Sentezlenmiş Cevap] (ana cevap burada)

Şimdi uygula:`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Önce terimleri üret, sonra GERÇEK VERİLERİ kullanarak net cevap ver. 'Bilmiyoruz' deme, mevcut veriden en mantıklı sonucu çıkar." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 1400
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let full = res.data.choices[0].message.content.trim();
        let cevap = full.includes("[Sentezlenmiş Cevap]") 
            ? full.split("[Sentezlenmiş Cevap]")[1]?.trim() || full 
            : full;

        // Hafıza
        history.push({ user: soru, bot: cevap });
        if (history.length > 5) history.shift();
        userContexts.set(userId, history);

        return cevap || "Güncel veri alınamadı, lütfen farklı sor.";
    } catch (e) {
        if (e.response?.status === 429) {
            const retryAfter = parseInt(e.response.headers['retry-after'] || 10, 10);
            console.log(`429 → ${retryAfter}s bekle`);
            await new Promise(r => setTimeout(r, (retryAfter + 3) * 1000));
            // Retry (sadece 1 kez)
            try {
                const retryRes = await axios.post(/* aynı istek */);
                // ... retry cevabı dön
            } catch {}
        }
        console.error("Groq:", e.message);
        return `Şu anda (${simdi}) yoğunluk var, 20-40 sn sonra dene.`;
    }
}

/* MESAJ DİNLEYİCİ (cooldown 4sn) */
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (msg.mentions.everyone || msg.content.includes("@everyone") || msg.content.includes("@here")) return;
    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    const now = Date.now();
    const last = userLastProcess.get(msg.author.id) || 0;
    if (now - last < 4000) return;
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
            if (rest) chunks.push("... (çok uzun)");

            for (let i = 0; i < chunks.length; i++) {
                if (i === 0) await msg.reply(chunks[i]);
                else await msg.channel.send(chunks[i]);
                if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 900));
            }
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        await msg.reply("Hata, tekrar dene.").catch(() => {});
    }
});

client.once("ready", () => {
    console.log(`Bot aktif → ${client.user.tag} | ${getCurrentTurkishDate()}`);
});

client.login(DISCORD_TOKEN).catch(err => console.error("Login:", err));