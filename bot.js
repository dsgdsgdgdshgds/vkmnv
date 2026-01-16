const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

// Render sağlık kontrolü için basit endpoint
app.get('/', (req, res) => {
  res.status(200).send('Discord bot çalışıyor ✓');
});

app.listen(port, () => {
  console.log(`HTTP sunucu ${port} portunda aktif (Render için gerekli)`);
});

// Environment variable'lardan alıyoruz → Render'da Environment sekmesine ekleyeceksin
const GROQ_API_KEY    = process.env.GROQ_API_KEY;
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const SERPER_API_KEY  = process.env.SERPER_API_KEY;

if (!DISCORD_TOKEN || !GROQ_API_KEY || !SERPER_API_KEY) {
  console.error('HATA: En az bir environment variable eksik!');
  console.error('Gerekli: GROQ_API_KEY, DISCORD_TOKEN, SERPER_API_KEY');
  process.exit(1);
}

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const userMemory = new Map();

/**
 * 1. ADIM: SORUYU PARÇALARA BÖLME
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
 */
async function geminiSistemi(userId, userMesaj) {
    let history = userMemory.get(userId) || [];

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
        
        history.push({ role: "user", content: userMesaj }, { role: "assistant", content: botCevap });
        userMemory.set(userId, history.slice(-6)); 
        
        return botCevap;
    } catch (e) {
        console.error("LLM hatası:", e.message);
        return "Verileri işlerken bir sorun oluştu, lütfen tekrar deneyin.";
    }
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;
    try {
        await msg.channel.sendTyping();
        const temizMesaj = msg.content.replace(/<@!?[^>]+>/g, '').trim();
        const finalYanit = await geminiSistemi(msg.author.id, temizMesaj || "Merhaba");

        // Discord 2000 karakter sınırı için basit kırpma
        if (finalYanit.length > 2000) {
            await msg.reply(finalYanit.substring(0, 1950) + "... (devamı için tekrar sor)");
        } else {
            await msg.reply(finalYanit);
        }
    } catch (err) {
        console.error("Mesaj işleme hatası:", err.message);
    }
});

client.once('ready', () => {
    console.log(`✅ BOT HAZIR: ${client.user.tag} → Parçalı arama + Gemini tarzı analiz aktif`);
});

client.login(DISCORD_TOKEN).catch(err => {
    console.error("Discord'a bağlanılamadı:", err.message);
    process.exit(1);
});