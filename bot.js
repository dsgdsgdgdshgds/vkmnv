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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Render Environment'a ekle
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY eksik!");

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // veya gemini-1.5-pro

// Her kullanıcıya özel hafıza (son 10 mesaj)
const userHistories = new Map();

client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (!soru) return;

    await msg.channel.sendTyping();

    try {
        let history = userHistories.get(msg.author.id) || [];

        // Gemini'ye gönderilecek chat history
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
        const cevap = result.response.text().trim();

        // Hafızayı güncelle (user + model)
        history.push({ role: "user", parts: [{ text: soru }] });
        history.push({ role: "model", parts: [{ text: cevap }] });

        // Son 10 mesajı tut (hafıza taşmasın)
        if (history.length > 10) history = history.slice(-10);

        userHistories.set(msg.author.id, history);

        // Cevap uzun olursa parçala
        if (cevap.length > 1900) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
                await msg.reply(chunk);
            }
        } else {
            await msg.reply(cevap || "Cevap alınamadı.");
        }

    } catch (err) {
        console.error(err);
        let hata = "Bir hata çıktı.";
        if (err.status === 429) {
            hata = "Kota doldu (429) – biraz bekleyelim.";
        } else if (err.message.includes('API key')) {
            hata = "API key geçersiz.";
        }
        await msg.reply(hata + " Tekrar dene.");
    }
});

client.once('ready', () => {
    console.log(`Bot aktif: ${client.user.tag} | Gemini API ile`);
});

client.login(process.env.DISCORD_TOKEN);