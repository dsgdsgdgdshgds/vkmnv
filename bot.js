const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http'); // 7/24 Aktif tutmak için gerekli modül

// --- PORT SUNUCU KODU (Render vb. platformlar için) ---
http.createServer((req, res) => {
    res.write("Bot 7/24 Aktif!");
    res.end();
}).listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ANAHTARLAR (Render Environment Variables kısmından ayarlanmalıdır)
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
                hamBilgi += `\n[Kaynak - ${terim}]: ${snippets}`;
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
    Sen Gemini mimarisine sahip, gelişmiş bir analiz asistanısın.
    
    ÖNEMLİ BİLGİ (GÜNCEL YEREL ZAMAN): ${guncelZaman} (Türkiye Saati)
    
    TALİMATLAR:
    1. Kullanıcı saat veya tarih sorduğunda, yukarıdaki GÜNCEL YEREL ZAMAN bilgisini DOĞRUDAN kullan. 
    2. Sakın üzerine saat ekleme veya çıkarma yapma; sana verilen zaman zaten nihai Türkiye saatidir.
    3. İnternetten gelen verileri (aşağıda) analiz et ve kullanıcı sorusuyla harmanla.
    4. Yanıtlarını Markdown (başlıklar, kalın yazılar) ile düzenle.
    5. Yanıtın 1900 karakteri geçmesin.

    İNTERNET VERİLERİ:
    ---
    ${bulunanVeriler}
    ---
    `;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: systemPrompt },
                ...history.slice(-4), 
                { role: "user", content: userMesaj }
            ],
            temperature: 0.5 
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

        const botCevap = response.data.choices[0].message.content;
        history.push({ role: "user", content: userMesaj }, { role: "assistant", content: botCevap });
        userMemory.set(userId, history.slice(-6)); 
        
        return botCevap;
    } catch (e) {
        return "Verileri işlerken bir sorun oluştu, lütfen tekrar deneyin.";
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
    console.log(`✅ BOT AKTİF: Port 3000 dinleniyor ve zaman sapması düzeltildi.`);
});

client.login(DISCORD_TOKEN);
