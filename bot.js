const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot çalışıyor - Gemini API');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY ortam değişkeni eksik! Render'dan ekle.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Güncel model (2026 başı için en stabil ve hızlı seçeneklerden biri)
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash"  // Alternatifler: "gemini-2.0-flash", "gemini-3-flash", "gemini-2.5-pro"
});

// Her kullanıcıya özel hafıza (son 10 mesaj çifti)
const userHistories = new Map();

client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (!soru) return;

    await msg.channel.sendTyping();

    try {
        let history = userHistories.get(msg.author.id) || [];

        const chat = model.startChat({
            history: history.map(h => ({
                role: h.role,
                parts: [{ text: h.parts[0].text }]
            })),
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
            }
        });

        const result = await chat.sendMessage(soru);
        const cevap = await result.response.text();  // .trim() yerine await text() kullan (SDK gereği)

        // Hafızayı güncelle
        history.push({ role: "user", parts: [{ text: soru }] });
        history.push({ role: "model", parts: [{ text: cevap }] });

        if (history.length > 10) history = history.slice(-10);

        userHistories.set(msg.author.id, history);

        // Cevap uzun olursa parçala + flood önleme
        if (cevap.length > 1900) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
                await msg.reply(chunk);
                await new Promise(r => setTimeout(r, 800));  // rate-limit koruması
            }
        } else {
            await msg.reply(cevap || "Cevap alınamadı.");
        }

    } catch (err) {
        console.error("Hata:", err);

        let hataMesaj = "Bir hata çıktı, tekrar dene.";
        
        if (err.status === 429) {
            hataMesaj = "Kota doldu (429) – biraz bekleyelim.";
        } else if (err.message?.includes('404') || err.message?.includes('not found')) {
            hataMesaj = "Model bulunamadı (404) – Model adı değişmiş olabilir. Şu an gemini-2.5-flash kullanıyorum, çalışmıyorsa API key veya kota kontrol et.";
        } else if (err.message?.includes('API key') || err.message?.includes('unauthorized')) {
            hataMesaj = "API key geçersiz veya erişim yok.";
        }

        await msg.reply(hataMesaj);
    }
});

client.once('ready', () => {
    console.log(`Bot aktif: ${client.user.tag} | Gemini API ile (model: gemini-2.5-flash)`);
});

client.login(process.env.DISCORD_TOKEN);