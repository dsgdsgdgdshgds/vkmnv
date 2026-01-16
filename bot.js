const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

// Render'da çalışırken 8080 portunu dinlemesi lazım
app.get('/', (req, res) => {
  res.send('Discord bot aktif çalışıyor.');
});

app.listen(port, () => {
  console.log(`🌐 HTTP sunucu ${port} portunda çalışıyor (Render için zorunlu)`);
});

// Environment variables'dan çekiyoruz (Render → Environment sekmesinden ekleyeceksin)
const GROQ_API_KEY    = process.env.GROQ_API_KEY;
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const SERPER_API_KEY  = process.env.SERPER_API_KEY;

if (!DISCORD_TOKEN || !GROQ_API_KEY || !SERPER_API_KEY) {
  console.error("HATA: Gerekli environment variable'lardan biri veya daha fazlası eksik!");
  process.exit(1);
}

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

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
    let history = userMemory.get(userId) || [];

    const simdi = new Date();
    const guncelZaman = simdi.toLocaleString('tr-TR', { 
        timeZone: 'Europe/Istanbul', 
        dateStyle: 'full', 
        timeStyle: 'medium'
    });

    const terimler = await aramaTerimleriniBelirle(userMesaj);
    const bulunanVeriler = await veriTopla(terimler);

    const systemPrompt = `
    Sen Gemini tabanlı bir asistansın.
    GÜNCEL YEREL ZAMAN: ${guncelZaman}
    
    KRİTİK TALİMATLAR:
    1. Sadece doğrudan cevabı ver. Giriş cümleleri (Örn: "Bulduğum bilgilere göre...", "Merhaba!") kullanma.
    2. Cevapların içinde asla "Kaynak:", "[Kaynak]", "Snippet" veya internet sitesi linkleri gibi referanslar bulundurma.
    3. Bilgiyi ham ve temiz bir şekilde sun.
    4. Cevabı olabildiğince kısa, öz ve net tut. 
    5. Markdown kullanarak başlık veya kalın yazım yapabilirsin ama lafı uzatma.

    ANALİZ EDİLECEK VERİ:
    ---
    ${bulunanVeriler}
    ---
    `;

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
        console.error("Gemini hatası:", e.message);
        return "Sistemde bir hata oluştu.";
    }
}

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
    } catch (err) {
        console.error("Mesaj işleme hatası:", err.message);
    }
});

client.once('ready', () => {
    console.log(`✅ BOT AKTİF: ${client.user.tag} hazır ve kısa cevap modunda.`);
});

client.login(DISCORD_TOKEN).catch(err => {
    console.error("Discord login başarısız:", err.message);
    process.exit(1);
});