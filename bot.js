// ================= RENDER 7/24 AKTİF SUNUCU =================
const express = require("express");
const app = express();

app.get("/", (req, res) => {
    res.send("Bot aktif ve çalışıyor 🚀");
});

app.listen(8080, () => {
    console.log("🌐 Sunucu 8080 portunda aktif");
});
// ===========================================================


const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

// ================= API & TOKENLER (RENDER ENV) =================
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
// ===============================================================

const userMemory = new Map();

async function aramaTerimleriniBelirle(soru) {
    try {
        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama3-8b-8192",
                messages: [
                    { role: "system", content: "Kullanıcının sorusuna uygun Google arama terimlerini üret." },
                    { role: "user", content: soru }
                ],
                max_tokens: 60
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return response.data.choices[0].message.content.trim();
    } catch (err) {
        console.error("Arama terimi hatası:", err.message);
        return soru;
    }
}

async function googleAramaYap(terim) {
    try {
        const response = await axios.post(
            "https://google.serper.dev/search",
            { q: terim, num: 3 },
            {
                headers: {
                    "X-API-KEY": SERPER_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        return response.data.organic
            .map(r => `${r.title}: ${r.snippet}`)
            .join("\n");
    } catch (err) {
        console.error("Google arama hatası:", err.message);
        return "";
    }
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    try {
        const soru = msg.content;

        const aramaTerimi = await aramaTerimleriniBelirle(soru);
        const aramaSonucu = await googleAramaYap(aramaTerimi);

        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama3-8b-8192",
                messages: [
                    { role: "system", content: "Kısa, net ve anlaşılır cevap ver." },
                    { role: "user", content: `Soru: ${soru}\n\nBilgi:\n${aramaSonucu}` }
                ],
                max_tokens: 500
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const finalYanit = response.data.choices[0].message.content;

        if (finalYanit.length > 2000) {
            await msg.reply(finalYanit.substring(0, 1900) + "...");
        } else {
            await msg.reply(finalYanit);
        }

    } catch (err) {
        console.error("Hata:", err.message);
    }
});

client.once('ready', () => {
    console.log(`✅ BOT AKTİF: ${client.user.tag} hazır.`);
});

client.login(DISCORD_TOKEN);