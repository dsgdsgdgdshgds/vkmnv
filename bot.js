const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Render Port Desteği (Botun kapanmaması için)
http.createServer((req, res) => {
    res.write("Bot Aktif!");
    res.end();
}).listen(process.env.PORT || 8080);

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// API Anahtarları (Render Environment Variables'dan çekilir)
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

    // GÜNCELLENMİŞ SİSTEM TALİMATLARI (Kimlik bilgisi çıkarıldı)
    const systemPrompt = `
    Sen akıllı ve öz bir asistansın.
    
    ÖNEMLİ KURALLAR:
    1. Asla 'Gemini', 'Google' veya hangi yapay zeka modelini kullandığını söyleme.
    2. Cevaplarında kendini tanıtma, doğrudan soruya odaklan.
    3. İnternetten bulunan şu güncel bilgileri kullanarak yanıt ver: ${bulunanVeriler}
    4. Cevapların kısa, net ve anlaşılır olsun.
    `;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: systemPrompt },
                ...history.slice(-4), 
                { role: "user", content: userMesaj }
            ],
            temperature: 0.6
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, timeout: 10000 });

        const botCevap = response.data.choices[0].message.content;
        history.push({ role: "user", content: userMesaj }, { role: "assistant", content: botCevap });
        userMemory.set(userId, history.slice(-6)); 
        return botCevap;
    } catch (e) {
        return "Şu an bir bağlantı sorunu yaşıyorum.";
    }
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;
    try {
        await msg.channel.sendTyping();
        const temizMesaj = msg.content.replace(/<@!?[^>]+>/g, '').trim();
        const finalYanit = await geminiSistemi(msg.author.id, temizMesaj || "Merhaba");
        await msg.reply(finalYanit);
    } catch (err) { console.error("Hata:", err.message); }
});

client.once('ready', () => {
    console.log(`✅ BOT HAZIR: ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
