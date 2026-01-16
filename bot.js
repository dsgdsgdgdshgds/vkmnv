const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SERVER AYARLARI (Render 7/24 Aktif Tutmak İçin) ---
const app = express();
const PORT = process.env.PORT || 8080; // Render otomatik port atar, yoksa 8080 kullanır.

app.get('/', (req, res) => {
    res.send('Bot aktif ve 7/24 çalışıyor!');
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda dinleniyor.`);
});

// --- DISCORD BOT AYARLARI ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Ortam Değişkenleri (Render Dashboard -> Environment kısmına eklenmelidir)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const userMemory = new Map();

async function aramaTerimleriniBelirle(soru) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "Sen bir araştırma asistanısın. Kullanıcının sorusunu yanıtlamak için gereken en mantıklı 3 farklı arama terimini virgülle ayırarak yaz. Sadece terimleri ver." },
                { role: "user", content: soru }
            ]
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
        return response.data.choices[0].message.content.split(',').map(s => s.trim());
    } catch (e) { return [soru]; }
}

async function veriTopla(terimler) {
    let hamBilgi = "";
    for (const terim of terimler.slice(0, 3)) {
        try {
            const res = await axios.post('https://google.serper.dev/search', 
                { "q": terim, "gl": "tr", "hl": "tr" },
                { headers: { 'X-API-KEY': SERPER_API_KEY }, timeout: 5000 }
            );
            if (res.data.organic) {
                const snippets = res.data.organic.slice(0, 3).map(i => i.snippet).join(" ");
                hamBilgi += `\n${snippets}`;
            }
        } catch (e) { continue; }
    }
    return hamBilgi;
}

async function geminiSistemi(userId, userMesaj) {
    // Kurumsal Kimlik Bilgisi
    const lowerMesaj = userMesaj.toLowerCase();
    if (lowerMesaj.includes("sahibin") || lowerMesaj.includes("yapımcın") || lowerMesaj.includes("creator") || lowerMesaj.includes("geliştiricin")) {
        return "Batuhan Aktaş Giresun/Bulancak KAFMTAL\nhata";
    }

    let history = userMemory.get(userId) || [];
    const simdi = new Date();
    const guncelZaman = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full', timeStyle: 'medium' });

    const terimler = await aramaTerimleriniBelirle(userMesaj);
    const bulunanVeriler = await veriTopla(terimler);

    const systemPrompt = `Sen Gemini tabanlı bir asistansın. GÜNCEL YEREL ZAMAN: ${guncelZaman}. Kısa, net ve doğrudan cevap ver.`;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: systemPrompt },
                ...history.slice(-10), 
                { role: "user", content: userMesaj }
            ],
            temperature: 0.3 
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

        const botCevap = response.data.choices[0].message.content;
        history.push({ role: "user", content: userMesaj }, { role: "assistant", content: botCevap });
        userMemory.set(userId, history.slice(-4)); 
        
        return botCevap;
    } catch (e) {
        return "Sistemde bir hata oluştu.";
    }
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;
    try {
        await msg.channel.sendTyping();
        const temizMesaj = msg.content.replace(/<@!?[^>]+>/g, '').trim();
        const finalYanit = await geminiSistemi(msg.author.id, temizMesaj || "Merhaba");
        await msg.reply(finalYanit.length > 2000 ? finalYanit.substring(0, 1900) + "..." : finalYanit);
    } catch (err) { console.error("Hata:", err.message); }
});

client.once('ready', () => {
    console.log(`✅ BOT AKTİF: ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
