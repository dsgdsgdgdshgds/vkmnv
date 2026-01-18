const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer-core');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot çalışıyor - Browserless ile');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const userContexts = new Map();

async function getGeminiPage() {
    // Browserless token'ı environment variable'dan al
    // Ücretsiz token: https://www.browserless.io/ → Sign up → Free tier
    const browser = await puppeteer.connect({
        browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
        // Alternatif: token olmadan da deneyebilirsin ama limit düşük: wss://chrome.browserless.io
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto('https://gemini.google.com/', { waitUntil: 'networkidle2', timeout: 45000 });

    return { page, browser };
}

client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (!soru) return;

    let page, browser;
    try {
        await msg.channel.sendTyping();

        ({ page, browser } = await getGeminiPage());

        let history = userContexts.get(msg.author.id) || [];
        const fullPrompt = history.length 
            ? `Önceki konuşma:\n${history.join('\n')}\n\nYeni soru: ${soru}`
            : soru;

        // Gemini chat alanı (2026'da selector değişirse F12 ile güncelle)
        await page.waitForSelector('textarea[placeholder*="Gemini" i]', { timeout: 30000 });
        await page.type('textarea[placeholder*="Gemini" i]', fullPrompt);
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const replies = [...document.querySelectorAll('[data-message-author="model"], .model-response, [role="assistant"]')];
            return replies.length > 0 && replies.at(-1).innerText.trim().length > 15;
        }, { timeout: 90000 });

        const cevap = await page.evaluate(() => {
            const replies = [...document.querySelectorAll('[data-message-author="model"], .model-response, [role="assistant"]')];
            return replies.at(-1)?.innerText?.trim() || 'Cevap alınamadı';
        });

        history.push(`S: ${soru}`, `C: ${cevap.slice(0, 600)}...`);
        if (history.length > 10) history = history.slice(-10);
        userContexts.set(msg.author.id, history);

        if (cevap.length > 1900) {
            for (const chunk of cevap.match(/[\s\S]{1,1900}/g)) {
                await msg.reply(chunk);
            }
        } else {
            await msg.reply(cevap || '→ Cevap gelmedi kanka');
        }

    } catch (err) {
        console.error('Hata:', err.message);
        await msg.reply('Bağlantı patladı (timeout / CAPTCHA / limit olabilir). Biraz bekle tekrar dene.');
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
});

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} → Browserless ile Gemini web çalışıyor`);
});

client.login(process.env.DISCORD_TOKEN);