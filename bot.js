const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// SENİN ANAHTARLARIN
const GROQ_API_KEY = process.env.api;
const DISCORD_TOKEN = "O";
const SERPER_API_KEY = "d5b0d101f822182dd67294e6612b511eb1c797bd";

const userMemory = new Map();

/**
 * 1. ADIM: SORUYU PARÇALARA BÖLME
 * Soruyu doğrudan aratmaz, neyi araştırması gerektiğini belirler.
 */
async function aramaTerimleriniBelirle(soru) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant",
            messages: [
                { 
                    role: "system", 
                    content: "Sen bir araştırma asistanısın. Kullanıcının sorusunu yanıtlamak için gereken en mantıklı 3 farklı arama terimini virgülle ayırarak yaz. Sadece terimleri ver." 
                },
                { role: "user", content: soru }
            ]
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

        return response.data.choices[0].message.content.split(',').map(s => s.trim());
    } catch (e) { return [soru]; }
}

/**
 * 2. ADIM: VERİ TOPLAMA
 * Belirlenen terimlerle Google'dan ham bilgileri çeker.
 */
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

/**
 * 3. ADIM: GEMINI TARZI SENTEZ
 * Toplanan her türlü veriyi alır, mantık süzgecinden geçirir ve cevaplar.
 */
async function geminiSistemi(userId, userMesaj) {
    let history = userMemory.get(userId) || [];

    // Stratejiyi belirle ve verileri çek
    const terimler = await aramaTerimleriniBelirle(userMesaj);
    const bulunanVeriler = await veriTopla(terimler);

    const systemPrompt = `
    Sen Gemini gibi çalışan, yüksek analiz yeteneğine sahip bir yapay zekasın.
    
    İNTERNETTEN GELEN HAM VERİLER:
    ---
    ${bulunanVeriler}
    ---
    
    GÖREVİN:
    1. Yukarıdaki verileri oku ve kullanıcının sorusuyla eşleştir.
    2. Verilerde sayısal değerler (bölüm sayısı, süre, fiyat, mesafe vb.) varsa bunlar üzerinden mantıksal hesaplamalar yap.
    3. Bilgiyi doğrudan kopyalamak yerine, anlamlı bir bütün haline getirerek anlat.
    4. Markdown kullanarak (Başlıklar, kalın yazılar, listeler) şık bir sunum yap.
    5. Eğer veriler birbiriyle çelişiyorsa, en mantıklı ve tutarlı olanı öne çıkar.
    6. Yanıtın 1900 karakter sınırını geçmesin.
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
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

        const botCevap = response.data.choices[0].message.content;
        
        // Bellek yönetimi
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
    console.log(`✅ BOT HAZIR: Parçalı arama ve Gemini tarzı analiz aktif.`);
});

client.login(process.env.token);