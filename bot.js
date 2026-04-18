const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT (7/24 Aktif Tutmak İçin) ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("BatuBot is Running!"); }).listen(process.env.PORT || 8080);

/* ====== YAPILANDIRMA ====== */
const GROQ_KEY      = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const MODEL_FAST    = "llama-3.1-8b-instant";
const MODEL_SMART   = "llama-3.3-70b-versatile";

const memory = new Map();
const MAX_HISTORY = 6;

/* ====== GROQ API FONKSİYONU ====== */
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

/* ====== ÜCRETSİZ WEB ARAMA (Key Gerektirmez) ====== */
async function webAra(sorgu) {
    try {
        // SearXNG public instance kullanarak Google/Bing sonuçlarını çeker
        const res = await axios.get("https://searx.be/search", {
            params: { q: sorgu, format: "json", language: "tr" },
            timeout: 8000,
        });
        if (res.data?.results?.length > 0) {
            return res.data.results.slice(0, 3)
                .map(r => `${r.title}: ${r.content}`)
                .join("\n\n");
        }
    } catch (e) {
        console.log(`⚠️ Arama yapılamadı: ${e.message}`);
    }
    return "Güncel internet verisine şu an ulaşılamıyor.";
}

/* ====== HAVA DURUMU (Open-Meteo) ====== */
async function getHavaDurumu(sehir) {
    try {
        const geo = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
            params: { name: sehir, count: 1, language: "tr", format: "json" },
            timeout: 5000,
        });
        if (!geo.data.results?.length) return null;
        const { latitude, longitude, name } = geo.data.results[0];

        const w = await axios.get("https://api.open-meteo.com/v1/forecast", {
            params: {
                latitude, longitude,
                current: "temperature_2m,weather_code",
                timezone: "auto"
            },
            timeout: 5000,
        });
        return { sehir: name, derece: Math.round(w.data.current.temperature_2m) };
    } catch (e) { return null; }
}

/* ====== KARAR MEKANİZMASI (Llama-8B) ====== */
async function kararVer(soru) {
    const prompt = `Kullanıcı mesajını analiz et. Sadece JSON döndür.
    {"action": "chat" | "search" | "weather", "query": "arama sorgusu", "city": "şehir"}
    Kullanıcı: ${soru}`;

    try {
        const yanit = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0 });
        const m = yanit.match(/\{[\s\S]*?\}/);
        return m ? JSON.parse(m[0]) : { action: "chat" };
    } catch { return { action: "chat" }; }
}

/* ====== ANA CEVAP ÜRETİCİ ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const gecmis = memory.get(userId) || [];
    const gecmisMetin = gecmis.map(h => `K: ${h.user} | B: ${h.bot}`).join("\n");

    const karar = await kararVer(soru);
    let ekBilgi = "";

    if (karar.action === "search") {
        ekBilgi = await webAra(karar.query || soru);
    } else if (karar.action === "weather") {
        const h = await getHavaDurumu(karar.city);
        ekBilgi = h ? `${h.sehir} şu an ${h.derece}°C.` : "Hava durumu alınamadı.";
    }

    // Botun kimliği ve geliştiricisi buraya sabitlendi
    const SISTEM_PROMPT = `Sen BatuBot isminde eğlenceli ve zeki bir Discord botusun. 
    Geliştiricin Batuhan'dır. Eğer kimin yaptığı sorulursa 'Geliştiricim Batuhan' de. 
    Kısa, öz ve samimi cevaplar ver. Sadece Türkçe konuş.
    Güncel Tarih: ${tarih}`;

    const mesajlar = [
        { role: "system", content: SISTEM_PROMPT },
        { role: "user", content: `Geçmiş:\n${gecmisMetin}\n\nEk Bilgi:\n${ekBilgi}\n\nSoru: ${soru}` }
    ];

    try {
        let cevap = await groq(mesajlar);
        
        // Belleği güncelle
        const yeniGecmis = [...gecmis, { user: soru, bot: cevap }].slice(-MAX_HISTORY);
        memory.set(userId, yeniGecmis);
        
        return cevap;
    } catch (e) {
        console.error(e);
        return "Bir sorun oluştu, sonra tekrar deneyebilir misin? 🙄";
    }
}

/* ====== DISCORD EVENTLERİ ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return msg.reply("Efendim? Bir şey mi soracaktın?");

    msg.channel.sendTyping().catch(() => {});
    const cevap = await cevapUret(msg.author.id, soru);
    
    if (cevap.length > 2000) {
        msg.reply(cevap.slice(0, 1900) + "...");
    } else {
        msg.reply({ content: cevap, allowedMentions: { repliedUser: false } });
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
});

client.login(DISCORD_TOKEN);