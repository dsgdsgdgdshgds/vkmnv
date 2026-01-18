const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer-core');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot çalışıyor - Browserless ile Gemini');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const userContexts = new Map(); // kullanıcı başına basit hafıza

async function getGeminiPage() {
    if (!process.env.BROWSERLESS_TOKEN) {
        throw new Error("BROWSERLESS_TOKEN ortam değişkeni eksik! Render'dan ekle.");
    }

    const endpoint = `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`;

    console.log('Browserless\'e bağlanılıyor... (token gizli)');

    const browser = await puppeteer.connect({
        browserWSEndpoint: endpoint,
        ignoreHTTPSErrors: true,
        defaultViewport: null
    });

    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
        'Accept-Language': 'tr-TR,tr;q=0.9'
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    console.log('Gemini sayfasına gidiliyor...');
    await page.goto('https://gemini.google.com/', {
        waitUntil: 'networkidle2',
        timeout: 60000
    });

    return { page, browser };
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (soru.length === 0) return;

    let page, browser;
    try {
        await msg.channel.sendTyping();

        ({ page, browser } = await getGeminiPage());

        let history = userContexts.get(msg.author.id) || [];
        let fullPrompt = history.length > 0
            ? `Önceki konuşma:\n${history.join('\n')}\n\nYeni soru: ${soru}`
            : soru;

        // Gemini input alanı (2026 selector'ı – gerekirse F12 ile kontrol et)
        await page.waitForSelector('textarea[placeholder*="Gemini" i], textarea[aria-label*="Gemini" i]', { timeout: 30000 });
        await page.type('textarea[placeholder*="Gemini" i], textarea[aria-label*="Gemini" i]', fullPrompt);
        await page.keyboard.press('Enter');

        // Cevap gelmesini bekle (son model yanıtı)
        await page.waitForFunction(() => {
            const replies = document.querySelectorAll('[data-message-author="model"], [role="assistant"], div.model-response, .response-container');
            return replies.length > 0 && replies[replies.length - 1].innerText.trim().length > 20;
        }, { timeout: 120000 });

        const cevap = await page.evaluate(() => {
            const replies = document.querySelectorAll('[data-message-author="model"], [role="assistant"], div.model-response, .response-container');
            return replies[replies.length - 1]?.innerText?.trim() || 'Cevap alınamadı.';
        });

        // Hafızayı güncelle (son 6-8 mesaj yeter)
        history.push(`Kullanıcı: ${soru}`);
        history.push(`Gemini: ${cevap.substring(0, 800)}...`);
        if (history.length > 8) history = history.slice(-8);
        userContexts.set(msg.author.id, history);

        // Cevabı Discord'a gönder (2000 karakter sınırı)
        if (cevap.length > 1900) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
                await msg.reply(chunk);
            }
        } else {
            await msg.reply(cevap || 'Cevap gelmedi, siteyi kontrol et kanka.');
        }

    } catch (err) {
        console.error('Hata:', err.message || err);
        let hataMesaj = 'Bir sorun çıktı (timeout, CAPTCHA veya bağlantı hatası olabilir).';

        if (err.message.includes('401')) {
            hataMesaj = '401 Unauthorized – BROWSERLESS_TOKEN yanlış veya eksik. Dashboard\'dan kontrol et.';
        } else if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
            hataMesaj = 'Browserless bağlantısı başarısız. Token veya internet kontrol et.';
        }

        await msg.reply(hataMesaj + '\nBiraz bekleyip tekrar dene.');
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
});

client.once('ready', () => {
    console.log(`✅ Bot giriş yaptı: ${client.user.tag}`);
    console.log('Browserless ile Gemini web üzerinden çalışıyor');
});

client.login(process.env.DISCORD_TOKEN);