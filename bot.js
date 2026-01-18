const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const http = require('http');

puppeteer.use(StealthPlugin());

// Render port ayarı
http.createServer((req, res) => {
    res.write("Bot çalışıyor (Gemini web üzerinden)");
    res.end();
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Hafıza (basit, son 6 mesaj)
const userContexts = new Map();

// Tek browser instance (paylaşarak kullanıyoruz - dikkatli ol)
let browser = null;
let page = null;

async function initGeminiBrowser() {
    if (browser) return;

    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,800',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ],
        defaultViewport: { width: 1280, height: 800 }
    });

    page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });

    // Gemini ana sayfaya git
    await page.goto('https://gemini.google.com/', { waitUntil: 'networkidle2', timeout: 45000 });

    // Eğer login ekranı çıkarsa → manuel login yapman gerekir (tek seferlik)
    // await page.waitForSelector('input[type="email"]', { timeout: 10000 }).catch(() => {});
    // Buraya kendi hesabınla login kodunu ekleyebilirsin (ama riskli!)
}

client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!soru) return;

    const userId = msg.author.id;

    try {
        await msg.channel.sendTyping();

        await initGeminiBrowser();

        // Hafızayı al
        let history = userContexts.get(userId) || [];
        const fullPrompt = history.length > 0 
            ? `Önceki konuşma:\n${history.join("\n")}\n\nŞimdi yeni soru: ${soru}`
            : soru;

        // Textarea'ya yaz
        await page.waitForSelector('textarea[placeholder*="Gemini"], textarea[aria-label*="Gemini"]', { timeout: 15000 });
        await page.type('textarea[placeholder*="Gemini"], textarea[aria-label*="Gemini"]', fullPrompt);
        await page.keyboard.press('Enter');

        // Cevabı bekle (son mesajın bot kısmı)
        await page.waitForFunction(() => {
            const messages = document.querySelectorAll('[data-message-author="model"]');
            return messages.length > 0 && messages[messages.length-1].innerText.trim().length > 20;
        }, { timeout: 90000 });

        // Son bot cevabını çek
        const cevap = await page.evaluate(() => {
            const messages = document.querySelectorAll('[data-message-author="model"]');
            return messages[messages.length-1]?.innerText?.trim() || "Cevap alınamadı.";
        });

        // Hafızayı güncelle (son 3 çift)
        history.push(`Kullanıcı: ${soru}`);
        history.push(`Gemini: ${cevap}`);
        if (history.length > 6) history = history.slice(-6);
        userContexts.set(userId, history);

        // Cevabı Discord'a gönder
        if (cevap.length > 2000) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) await msg.reply(chunk);
        } else {
            await msg.reply(cevap || "Cevap gelmedi, siteyi kontrol et.");
        }

    } catch (err) {
        console.error("Gemini web hatası:", err);
        await msg.reply("Gemini sitesine bağlanırken sorun çıktı.\nCAPTCHA çıkmış olabilir, ya da geçici engel var.\nBiraz bekleyip tekrar dene.");
    }
});

client.once("ready", async () => {
    console.log(`✅ ${client.user.tag} → Gemini WEB üzerinden çalışıyor`);
    await initGeminiBrowser(); // bot başlar başlamaz browser'ı hazırla
});

client.login(process.env.DISCORD_TOKEN);