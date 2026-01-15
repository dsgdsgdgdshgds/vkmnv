const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Render Uyumluluğu: Port dinleme (Botun kapanmaması için)
http.createServer((req, res) => {
    res.write("Bot is running!");
    res.end();
}).listen(process.env.PORT || 8080);

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Değişkenler Environment Variables (Ortam Değişkenleri) üzerinden alınır
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const userMemory = new Map();

// ... (Geri kalan fonksiyonların: aramaTerimleriniBelirle, veriTopla, geminiSistemi aynı kalacak)

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;
    try {
        await msg.channel.sendTyping();
        const temizMesaj = msg.content.replace(/<@!?[^>]+>/g, '').trim();
        const finalYanit = await geminiSistemi(msg.author.id, temizMesaj || "Merhaba");
        
        if (finalYanit.length > 2000) {
            await msg.reply(finalYanit.substring(0, 1900) + "...");
        } else {
            await msg.reply(finalYanit);
        }
    } catch (err) { console.error("Hata:", err.message); }
});

client.once('ready', () => {
    console.log(`✅ BOT AKTİF: ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);