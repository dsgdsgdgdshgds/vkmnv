const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');

http.createServer((req, res) => res.end('Bot çalışıyor - Gemini Güncel')).listen(process.env.PORT || 8080);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'BURAYA_KEY_YAZ'); // ← Render'dan ekle

// Güncel ve hızlı model (2026 başı stabil)
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  // Grounding ile Google Search aç (güncel veri için) - ücretsizde sınırlı olabilir, çalışmazsa kaldır
  tools: [{ googleSearchRetrieval: {} }]
});

const userHistories = new Map();

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
  if (!soru) return;

  await msg.channel.sendTyping();

  try {
    let history = userHistories.get(msg.author.id) || [];

    const chat = model.startChat({
      history: history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    });

    const result = await chat.sendMessage(soru);
    const cevap = result.response.text().trim();

    history.push({ role: "user", text: soru });
    history.push({ role: "model", text: cevap });
    if (history.length > 10) history = history.slice(-10);
    userHistories.set(msg.author.id, history);

    if (cevap.length > 1900) {
      for (const chunk of cevap.match(/[\s\S]{1,1900}/g) || []) {
        await msg.reply(chunk);
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      await msg.reply(cevap || 'Cevap yok');
    }
  } catch (err) {
    console.error(err);
    let msg = 'Hata çıktı';
    if (err.message?.includes('429')) msg = 'Kota doldu (429), biraz bekle';
    if (err.message?.includes('404') || err.message?.includes('not found')) msg = 'Model adı değişmiş, gemini-2.5-flash dene';
    await msg.reply(msg + ', tekrar sor');
  }
});

client.once('ready', () => console.log(`Aktif → ${client.user.tag}`));

client.login(process.env.DISCORD_TOKEN);