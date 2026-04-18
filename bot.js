const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

const GROQ_KEY = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const MODEL_FAST = "llama-3.1-8b-instant";
const MODEL_SMART = "llama-3.3-70b-versatile";

const memory = new Map();
const MAX_HISTORY = 8;

async function groq(messages, options = {}) {
    const { model = MODEL_SMART, temperature = 0.7, max_tokens = 800 } = options;
    const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
        model, messages, temperature, max_tokens
    }, {
        headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        timeout: 30000,
    });
    return res.data.choices[0].choices[0].message.content.trim();
}

// ÜCRETSİZ WEB ARAMA (DuckDuckGo)
async function webAra(sorgu) {
    try {
        const response = await axios.get(`https://api.duckduckgo.com/`, {
            params: { q: sorgu, format: 'json', no_html: 1, skip_disambig: 1 },
            timeout: 10000
        });
        
        if (response.data.AbstractText) {
            return response.data.AbstractText;
        }
        
        if (response.data.RelatedTopics && response.data.RelatedTopics[0]) {
            const ilk = response.data.RelatedTopics[0];
            if (ilk.Text) return ilk.Text;
        }
        
        // Fallback: Google Custom Search API'siz
        return `"${sorgu}" hakkında güncel bilgiye ulaşılamadı.`;
    } catch (e) {
        return "";
    }
}

// HAVA DURUMU (Open-Meteo - ücretsiz)
async function getHavaDurumu(sehir) {
    try {
        const geo = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
            params: { name: sehir, count: 1, language: "tr", format: "json" }
        });
        if (!geo.data.results?.length) return null;
        
        const { latitude, longitude, name, country } = geo.data.results[0];
        const weather = await axios.get("https://api.open-meteo.com/v1/forecast", {
            params: { latitude, longitude, current: "temperature_2m,weather_code", timezone: "auto" }
        });
        
        const codes = { 0:"☀️ Açık", 1:"🌤️ Az bulutlu", 2:"⛅ Parçalı", 3:"☁️ Kapalı", 45:"🌫️ Sisli", 61:"🌧️ Yağmur", 71:"🌨️ Kar" };
        
        return {
            sehir: name,
            sicaklik: Math.round(weather.data.current.temperature_2m),
            durum: codes[weather.data.current.weather_code] || "🌡️ Bilinmiyor"
        };
    } catch (e) {
        return null;
    }
}

// KARAR VERİCİ
async function kararVer(soru) {
    const prompt = `Sadece JSON: {"action":"chat/search/weather","query":"..."}
    chat=sohbet, search=güncel bilgi, weather=hava durumu
    Soru: ${soru}`;
    
    try {
        const res = await groq([{ role: "user", content: prompt }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 80 });
        const match = res.match(/\{[\s\S]*?\}/);
        return match ? JSON.parse(match[0]) : { action: "chat" };
    } catch {
        return { action: "chat" };
    }
}

// ANA CEVAP
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR');
    const karar = await kararVer(soru);
    let ekVeri = "";
    
    if (karar.action === "search") {
        ekVeri = await webAra(karar.query || soru);
    } else if (karar.action === "weather") {
        const hava = await getHavaDurumu(karar.city || "İstanbul");
        if (hava) ekVeri = `${hava.sehir}: ${hava.sicaklik}°C ${hava.durum}`;
    }
    
    const sistem = ekVeri ? 
        `Güncel veri: ${ekVeri}. Buna göre doğal Türkçe cevap ver.` :
        "Sohbet et, kısa ve samimi ol.";
    
    const cevap = await groq([
        { role: "system", content: sistem },
        { role: "user", content: `${tarih} - Kullanıcı: ${soru}` }
    ]);
    
    // Hafızaya kaydet
    const gecmis = memory.get(userId) || [];
    gecmis.push({ user: soru, bot: cevap });
    if (gecmis.length > MAX_HISTORY) gecmis.shift();
    memory.set(userId, gecmis);
    
    return cevap;
}

// DISCORD BOT
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;
    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return msg.reply("Ne sormak istersin?");
    
    await msg.channel.sendTyping();
    const cevap = await cevapUret(msg.author.id, soru);
    msg.reply(cevap);
});

client.once("ready", () => console.log(`✅ Bot aktif: ${client.user.tag}`));
client.login(DISCORD_TOKEN);