const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

// --- RENDER PORT DESTEĞİ (ZORUNLU) ---
http.createServer((req, res) => {
    res.write("Bot Aktif!");
    res.end();
}).listen(process.env.PORT || 8080);

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Değişkenler (Render Panelinden girilmelidir, tırnak kullanmayın)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const userMemory = new Map();

async function aramaTerimleriniBelirle(soru) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "Sen bir araştırma asistanısın. En mantıklı 3 arama terimini virgülle ayırarak yaz." },
                { role: "user", content: soru }
            ]
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, timeout: 5000 });
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
                const snippets = res.data.organic.slice(0, 2).map(i => i.snippet).join(" ");
                hamBilgi += `\n${snippets}`;
            }
        } catch (e) { continue; }
    }
    return hamBilgi;
}

async function geminiSistemi(userId, userMesaj) {
    let history = userMemory.get(userId) || [];
    const terimler = await aramaTerimleriniBelirle(userMesaj);
    const bulunanVeriler = await veriTopla(terimler);

    const systemPrompt = `Sen Gemini tabanlı bir asistansın. Kısa ve net cevap ver. Bilgi: ${bulunanVeriler}`;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: systemPrompt },
                ...history.slice(-4), 
                { role: "user", content: userMesaj }
            ],
            temperature: 0.5
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, timeout: 10000 });

        const botCevap = response.data.choices[0].message.content;
        history.push({ role: "user", content: userMesaj }, { role: "assistant", content: botCevap });
        userMemory.set(userId, history.slice(-6)); 
        return botCevap;
    } catch (e) {
        console.error("Hata Detayı:", e.message);
        return "Şu an yanıt veremiyorum, lütfen tekrar deneyin.";
    }
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;
    try {
        await msg.channel.sendTyping();
        const temizMesaj = msg.content.replace(/<@!?[^>]+>/g, '').trim();
        const finalYanit = await geminiSistemi(msg.author.id, temizMesaj || "Merhaba");
        await msg.reply(finalYanit);
    } catch (err) { console.error("Mesaj Hatası:", err.message); }
});

client.once('ready', () => {
    console.log(`✅ BOT AKTİF: ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
