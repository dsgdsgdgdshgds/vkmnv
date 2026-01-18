const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer-core');
const http = require('http');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot çalışıyor');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const userContexts = new Map();
let globalBrowser = null;

async function getBrowser() {
    if (globalBrowser && globalBrowser.isConnected()) return globalBrowser;

    if (!process.env.BROWSERLESS_TOKEN) throw new Error("BROWSERLESS_TOKEN eksik!");

    const endpoint = `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`;

    globalBrowser = await puppeteer.connect({
        browserWSEndpoint: endpoint,
        ignoreHTTPSErrors: true,
        defaultViewport: null
    });

    globalBrowser.on('disconnected', () => {
        console.log('Browser disconnected, temizleniyor...');
        globalBrowser = null;
    });

    console.log('Browser bağlandı');
    return globalBrowser;
}

async function processQueryWithRetry(soru, history, maxRetries = 1) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let page = null;
        try {
            const browser = await getBrowser();
            page = await browser.newPage();

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });

            await page.goto('https://gemini.google.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
            await sleep(2500); // minimum hydration

            const fullPrompt = history.length ? `Önceki:\n${history.join('\n')}\n\nSoru: ${soru}` : soru;

            const inputSel = 'div[contenteditable="true"][role="textbox"], div[role="textbox"], div[contenteditable="true"]';
            await page.waitForSelector(inputSel, { timeout: 30000 });
            await page.click(inputSel);
            await page.keyboard.type(fullPrompt, { delay: 4 });

            await page.keyboard.press('Enter');

            await page.waitForFunction(() => {
                const sel = '[data-message-author="model"], [role="assistant"], div.prose, div.markdown, .response-container';
                const reps = document.querySelectorAll(sel);
                if (reps.length === 0) return false;
                const txt = reps[reps.length - 1].innerText.trim();
                return txt.length > 25 && !txt.includes('Generating') && !txt.includes('…');
            }, { timeout: 120000 });

            const cevap = await page.evaluate(() => {
                const sel = '[data-message-author="model"], [role="assistant"], div.prose, div.markdown, .response-container';
                const reps = document.querySelectorAll(sel);
                return reps[reps.length - 1]?.innerText?.trim() || 'Yok';
            });

            return cevap;

        } catch (err) {
            if (attempt < maxRetries && err.message.includes('Target closed')) {
                console.log(`Target closed, retry \( {attempt + 1}/ \){maxRetries + 1}`);
                await sleep(3000 * (attempt + 1));
                if (page) await page.close().catch(() => {});
                continue;
            }
            throw err;
        } finally {
            if (page) {
                await page.close().catch(() => {});
            }
        }
    }
    throw new Error('Retry limit aşıldı');
}

client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (!soru) return;

    await msg.channel.sendTyping();

    try {
        let history = userContexts.get(msg.author.id) || [];
        const cevap = await processQueryWithRetry(soru, history);

        history.push(`K: ${soru}`, `G: ${cevap.substring(0, 800)}...`);
        if (history.length > 10) history = history.slice(-10);
        userContexts.set(msg.author.id, history);

        if (cevap.length > 1900) {
            for (const chunk of cevap.match(/[\s\S]{1,1900}/g) || []) {
                await msg.reply(chunk);
                await sleep(800);
            }
        } else {
            await msg.reply(cevap || 'Cevap yok');
        }
    } catch (err) {
        console.error('Hata:', err.message);

        let text = 'Sorun çıktı';
        if (err.message.includes('Target closed')) {
            text = 'Bağlantı koptu (Target closed) – Browserless tarafında oturum erken kapandı. Tekrar dene.';
        } else if (err.message.includes('429')) {
            text = '429 – Kullanım limiti doldu, 5-10 dk bekle.';
        } else if (err.message.includes('timeout')) {
            text = 'Gemini çok yavaş, timeout oldu.';
        }

        await msg.reply(text + '\nTekrar sor bakalım.');
    }
});

client.once('ready', () => {
    console.log(`Aktif: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
