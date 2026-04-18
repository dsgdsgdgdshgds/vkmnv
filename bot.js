const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("Awe Bot is Active!"); }).listen(process.env.PORT || 8080);

/* ====== AYARLAR ====== */
const GROQ_KEY      = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const MODEL_FAST    = "llama-3.1-8b-instant";
const MODEL_SMART   = "llama-3.3-70b-versatile";

const memory = new Map();
const MAX_HISTORY = 6;

/* ====== GROQ API ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.7, max_tokens = 800 } = {}) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature, max_tokens },
        {
            headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
            timeout: 25000,
        }
    );
    return res.data.choices[0].message.content.trim();
}

/* ====== GÜVENLİ JSON PARSING (Parsing Hatası Çözümü) ====== */
function temizleVeParseEt(metin) {
    try {
        // Regex ile sadece { } arasındaki kısmı alıyoruz
        const jsonMatch = metin.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) return { action: "chat" };
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.log("⚠️ Parsing hatası, düz metin geldi.");
        return { action: "chat" };
    }
}

/* ====== ÜCRETSİZ ARAMA ====== */
async function webAra(sorgu) {
    try {
        const res = await axios.get("https://searx.be/search", {
            params: { q: sorgu, format: "json", language: "tr" },
            timeout: 8000,
        });
        if (res.data?.results?.length > 0) {
            return res.data.results.slice(0, 3).map(r => `${r.title}: ${r.content}`).join("\n\n");
        }
    } catch (e) { return "Bilgi bulunamadı."; }
    return "Arama sonucu boş.";
}

/* ====== KARAR VERİCİ ====== */
async function kararVer(soru) {
    const prompt = `Kullanıcı mesajını analiz et. Sadece JSON döndür.
    Format: {"action": "chat" | "search" | "weather", "query": "arama", "city": "sehir"}
    Kullanıcı: ${soru}`;

    try {
        const yanit = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0 });
        return temizleVeParseEt(yanit); // Güvenli parse
    } catch { return { action: "chat" }; }
}

/* ====== ANA CEVAP ÜRETİCİ ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.map(h => `Kullanıcı: ${h.user}\nAwe: ${h.bot}`).join("\n");

    const karar = await kararVer(soru);
    let ekBilgi = "";

    if (karar.action === "search") {
        ekBilgi = await webAra(karar.query || soru);
    }

    // İsim Awe, Geliştirici Batuhan
    const SISTEM_PROMPT = `Senin adın Awe. Sen bir Discord botusun. 
    Geliştiricin Batuhan'dır. Eğer 'kim yaptı', 'yapımcın kim' gibi sorular gelirse 'Beni Batuhan geliştirdi' veya 'Yapımcım Batuhan' de. 
    Karakterin: Zeki, bazen esprili, samimi ve kısa cevaplar veren bir asistan.
    Sadece Türkçe konuş. Tarih: ${tarih}`;

    const mesajlar = [
        { role: "system", content: SISTEM_PROMPT },
        { role: "user", content: `Önceki Sohbet:\n${gecmisMetin}\n\nİnternet Verisi:\n${ekBilgi}\n\nKullanıcı: ${soru}` }
    ];

    try {
        const cevap = await groq(mesajlar);
        
        const yeniGecmis = [...gecmis, { user: soru, bot: cevap }].slice(-MAX_HISTORY);
        memory.set(userId, yeniGecmis);
        
        return cevap;
    } catch (e) {
        return "Şu an bir teknik aksaklık yaşıyorum, Batuhan'a haber ver! 🛠️";
    }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return msg.reply("Efendim? Ben Awe, sana nasıl yardımcı olabilirim?");

    msg.channel.sendTyping().catch(() => {});
    const cevap = await cevapUret(msg.author.id, soru);
    
    if (cevap.length > 2000) {
        const parcalar = cevap.match(/[\s\S]{1,1900}/g);
        for (const parca of parcalar) await msg.reply({ content: parca, allowedMentions: { repliedUser: false } });
    } else {
        msg.reply({ content: cevap, allowedMentions: { repliedUser: false } });
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} (Awe) aktif! Geliştirici: Batuhan`);
});

client.login(DISCORD_TOKEN);