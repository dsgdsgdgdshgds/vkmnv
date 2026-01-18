const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const http = require('http');

puppeteer.use(StealthPlugin());

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot çalışıyor (Gemini web üzerinden)');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let browser = null;
let page = null;

async function initGeminiBrowser() {
    if (browser) return;

    // Render.com için en güvenli launch ayarları
    browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, // boş bırakırsan otomatik bulur
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',           // Render gibi düşük kaynaklı yerlerde faydalı
            '--window-size=1280,800',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ],
        ignoreHTTPSErrors: true,
        defaultViewport: { width: 1280, height: 800 }
    });

    page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });

    console.log('→ Gemini sayfasına gidiliyor...');
    await page.goto('https://gemini.google.com/', { waitUntil: 'networkidle2', timeout: 60000 });
}

client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (!soru) return;

    try {
        await msg.channel.sendTyping();
        await initGeminiBrowser();

        let history = userContexts.get(msg.author.id) || [];
        const fullPrompt = history.length
            ? `Önceki konuşma:\n${history.join('\n')}\n\nŞimdi yeni soru: ${soru}`
            : soru;

        // Textarea seçici (2026'da değişebilir, gerekirse güncelle)
        await page.waitForSelector('textarea[placeholder*="Gemini" i], textarea[aria-label*="Gemini" i]', { timeout: 20000 });
        await page.type('textarea[placeholder*="Gemini" i], textarea[aria-label*="Gemini" i]', fullPrompt);
        await page.keyboard.press('Enter');

        await page.waitForFunction(
            () => {
                const msgs = document.querySelectorAll('div[data-message-author="model"], [role="assistant"]');
                return msgs.length > 0 && msgs[msgs.length - 1].innerText.trim().length > 15;
            },
            { timeout: 120000 }
        );

        const cevap = await page.evaluate(() => {
            const msgs = document.querySelectorAll('div[data-message-author="model"], [role="assistant"]');
            return msgs[msgs.length - 1]?.innerText?.trim() || 'Cevap alınamadı.';
        });

        history.push(`K: ${soru}`, `G: ${cevap.slice(0, 800)}...`);
        if (history.length > 8) history = history.slice(-8);
        userContexts.set(msg.author.id, history);

        if (cevap.length > 1900) {
            for (const parça of cevap.match(/[\s\S]{1,1900}/g)) {
                await msg.reply(parça);
            }
        } else {
            await msg.reply(cevap || '→ Cevap gelmedi.');
        }
    } catch (err) {
        console.error('Hata:', err.message);
        await msg.reply('Siteye bağlanılamadı (CAPTCHA / engel / timeout olabilir). 1-2 dk sonra tekrar dene.');
    }
});

const userContexts = new Map();

client.once('ready', async () => {
    console.log(`Giriş yapıldı → ${client.user.tag}`);
    await initGeminiBrowser().catch(e => console.error('Başlangıç browser hatası:', e));
});

client.login(process.env.DISCORD_TOKEN);