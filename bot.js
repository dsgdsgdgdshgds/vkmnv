import { Client, GatewayIntentBits, Events } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import http from 'http';

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot çalışıyor - Gemini 2.0 Flash');
}).listen(process.env.PORT || 8080);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Ortam değişkenlerinden al
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY ortam değişkeni eksik!");
  process.exit(1);
}

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN ortam değişkeni eksik!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Gemini 2.0 Flash modeli
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.7,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
  }
});

// Hafıza (kullanıcı başına son 12 mesaj)
const userHistories = new Map();

client.on(Events.MessageCreate, async msg => {
  if (msg.author.bot) return;
  if (!msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
  if (!soru) return;

  await msg.channel.sendTyping();

  try {
    let history = userHistories.get(msg.author.id) || [];

    const chat = model.startChat({
      history: history.map(h => ({
        role: h.role,
        parts: [{ text: h.text }]
      })),
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });

    const result = await chat.sendMessage(soru);
    const cevap = result.response.text().trim();

    // Hafızaya ekle
    history.push({ role: "user", text: soru });
    history.push({ role: "model", text: cevap });

    // Son 12 mesajı tut (6 diyalog çifti)
    if (history.length > 12) {
      history = history.slice(-12);
    }

    userHistories.set(msg.author.id, history);

    // Cevabı gönder (2000 karakter sınırı)
    if (cevap.length > 1900) {
      const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
      for (const chunk of chunks) {
        await msg.reply(chunk);
        await new Promise(r => setTimeout(r, 1000)); // flood koruması
      }
    } else {
      await msg.reply(cevap || "Cevap alınamadı.");
    }

  } catch (err) {
    console.error("Hata:", err);

    let hataMesaj = "Bir hata çıktı, lütfen tekrar dene.";
    
    if (err.status === 429) {
      hataMesaj = "Kota sınırına ulaştık (429). Biraz bekleyip tekrar deneyelim.";
    } else if (err.message?.includes('model') || err.message?.includes('not found')) {
      hataMesaj = "Model şu an erişilemiyor. API key veya kota durumunu kontrol et.";
    } else if (err.message?.includes('API key') || err.message?.includes('unauthorized')) {
      hataMesaj = "API anahtarı geçersiz görünüyor.";
    }

    await msg.reply(hataMesaj);
  }
});

client.once(Events.ClientReady, () => {
  console.log(`Bot aktif → ${client.user.tag}`);
  console.log(`Model: gemini-2.0-flash | Tarih: ${new Date().toLocaleString('tr-TR')}`);
});

client.login(DISCORD_TOKEN);