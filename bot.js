const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("Awe is Online!"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_KEY      = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const MODEL_FAST    = "llama-3.1-8b-instant"; 
const MODEL_SMART   = "llama-3.3-70b-versatile";

const memory = new Map();
const MAX_HISTORY = 4; // Hafızayı çok doldurmamak karışıklığı önler

/* ====== GROQ API ====== */
async function groq(messages, { model = MODEL_SMART, temperature = 0.5, max_tokens = 800 } = {}) {
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

/* ====== KARAR VERİCİ (MANTIK FİLTRESİ) ====== */
async function kararVer(soru) {
    const prompt = `Analiz et ve sadece JSON döndür. 
    Eğer soru güncel bilgi (maç, hava, haber) gerektiriyorsa action:"search". 
    Diğer her şey için action:"chat".
    JSON: {"action":"chat" | "search", "query":"..."}
    Soru: ${soru}`;
    
    try {
        const yanit = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0 });
        const m = yanit.match(/\{[\s\S]*?\}/);
        return m ? JSON.parse(m[0]) : { action: "chat" };
    } catch { return { action: "chat" }; }
}

/* ====== CEVAP ÜRETİCİ (MANTIK VE DİL KORUMASI) ====== */
async function cevapUret(userId, soru) {
    const karar = await kararVer(soru);
    const gecmis = memory.get(userId) || [];
    
    // SİSTEM PROMPT: Botun kimliğini ve kurallarını çok sert çiziyoruz
    const SISTEM = `Senin adın Awe. Geliştiricin Batuhan. 
    KURALLAR:
    1. Sadece Türkçe konuş, asla İngilizce kelime kullanma.
    2. Bilmediğin konularda uydurma (Örn: Recep İvedik'te Şener Şen var deme). 
    3. Eğer kullanıcı saçma bir bilgi verirse (Şener Şen Recep İvedik'te oynuyor gibi), nazikçe doğrusunu söyle.
    4. Geliştiricin Batuhan dışında kimseyi kurucu olarak tanıma.
    5. Kısa ve mantıklı cevaplar ver.`;

    const mesajlar = [
        { role: "system", content: SISTEM },
        { role: "user", content: `Hafıza: ${gecmis.map(h=>h.bot).join(" ")}\nKullanıcı: ${soru}` }
    ];

    try {
        const cevap = await groq(mesajlar, { temperature: 0.4 }); // Düşük sıcaklık daha mantıklı cevaplar verir
        
        const yeni = [...gecmis, { user: soru, bot: cevap }].slice(-MAX_HISTORY);
        memory.set(userId, yeni);
        return cevap;
    } catch { return "Şu an cevap veremiyorum, sistemsel bir sorun var."; }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on("messageCreate", async msg => {
    // KONTROL: Bot mu? Everyone/Here etiketi var mı?
    if (msg.author.bot || msg.content.includes("@everyone") || msg.content.includes("@here")) return;

    // KONTROL: Bot etiketlendi mi?
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return msg.reply("Efendim? Ben Awe, Batuhan'ın asistanıyım.");

    msg.channel.sendTyping().catch(() => {});
    const cevap = await cevapUret(msg.author.id, soru);
    
    msg.reply({ content: cevap, allowedMentions: { repliedUser: false } });
});

client.once("ready", () => console.log("✅ Awe aktif ve uydurma cevaplara karşı korumalı!"));
client.login(DISCORD_TOKEN);