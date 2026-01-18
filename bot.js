const { Client, GatewayIntentBits } = require('discord.js');
const { chromium } = require('playwright');
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot çalışıyor (Gemini web - Playwright)');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let browser = null;
let context = null;
let page = null;

async function initBrowser() {
    if (page) return;

    browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process'
        ]
    });

    context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul'
    });

    page = await context.newPage();
    console.log('→ Gemini sayfasına gidiliyor...');
    await page.goto('https://gemini.google.com/', { waitUntil: 'networkidle', timeout: 60000 });
}

const userContexts = new Map();

client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (!soru) return;

    try {
        await msg.channel.sendTyping();
        await initBrowser();

        let history = userContexts.get(msg.author.id) || [];
        const fullPrompt = history.length
            ? `Önceki konuşma:\n${history.join('\n')}\n\nYeni soru: ${soru}`
            : soru;

        // Playwright selector (2026'da değişebilir, gerekirse F12 ile güncelle)
        await page.waitForSelector('textarea[placeholder*="Gemini" i], textarea[aria-label*="Gemini" i]', { timeout: 30000 });
        await page.fill('textarea[placeholder*="Gemini" i], textarea[aria-label*="Gemini" i]', fullPrompt);
        await page.press('textarea', 'Enter');

        // Cevap gelene kadar bekle (son model mesajı)
        await page.waitForFunction(() => {
            const replies = document.querySelectorAll('[data-message-author="model"], [role="assistant"], .model-response');
            return replies.length > 0 && replies[replies.length - 1].innerText.trim().length > 20;
        }, { timeout: 120000 });

        const cevap = await page.evaluate(() => {
            const replies = document.querySelectorAll('[data-message-author="model"], [role="assistant"], .model-response');
            return replies[replies.length - 1]?.innerText?.trim() || 'Cevap alınamadı.';
        });

        history.push(`Kullanıcı: ${soru}`, `Gemini: ${cevap.slice(0, 700)}...`);
        if (history.length > 8) history = history.slice(-8);
        userContexts.set(msg.author.id, history);

        if (cevap.length > 1900) {
            const parçalar = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const parça of parçalar) await msg.reply(parça);
        } else {
            await msg.reply(cevap || 'Cevap gelmedi.');
        }

    } catch (err) {
        console.error('Hata:', err?.message || err);
        await msg.reply('Bağlantı sorunu çıktı (CAPTCHA / yavaşlık / engel olabilir). 1-2 dk sonra tekrar dene kanka.');
    }
});

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} → Playwright ile Gemini web çalışıyor`);
    await initBrowser().catch(e => console.error('Başlangıç hatası:', e));
});

client.login(process.env.DISCORD_TOKEN);