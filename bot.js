const { Client, GatewayIntentBits } = require('discord.js');
const puppeteer = require('puppeteer-core');
const http = require('http');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot çalışıyor');
}).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const userContexts = new Map();

// Global browser (reuse için – concurrency'yi düşürür)
let globalBrowser = null;
let globalPagePool = []; // birden fazla page reuse için

async function getBrowser() {
    if (globalBrowser && globalBrowser.isConnected()) return globalBrowser;

    if (!process.env.BROWSERLESS_TOKEN) throw new Error("BROWSERLESS_TOKEN eksik!");

    const endpoint = `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`;

    globalBrowser = await puppeteer.connect({
        browserWSEndpoint: endpoint,
        ignoreHTTPSErrors: true,
        defaultViewport: null
    });

    console.log('Browser bağlandı (reuse modu)');
    return globalBrowser;
}

async function getPageWithRetry(retries = 3, delay = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const browser = await getBrowser();
            const page = await browser.newPage();

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });

            await page.goto('https://gemini.google.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
            await sleep(3000); // hydration

            return page;
        } catch (err) {
            if (err.message.includes('429') || err.message.includes('Too Many Requests')) {
                console.log(`429 hatası - \( {attempt}/ \){retries} deneme, ${delay}ms bekleniyor...`);
                await sleep(delay);
                delay *= 2; // exponential backoff
            } else {
                throw err;
            }
        }
    }
    throw new Error('429 retry limit aşıldı - Browserless limitine takıldın, biraz bekle veya upgrade et.');
}

client.on('messageCreate', async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?[^>]+>/g, '').trim();
    if (!soru) return;

    let page;
    try {
        await msg.channel.sendTyping();

        page = await getPageWithRetry();

        let history = userContexts.get(msg.author.id) || [];
        const fullPrompt = history.length > 0
            ? `Önceki konuşma:\n${history.join('\n')}\n\nYeni soru: ${soru}`
            : soru;

        const inputSelector = 'div[contenteditable="true"][role="textbox"], div[role="textbox"], div[contenteditable="true"]';

        await page.waitForSelector(inputSelector, { timeout: 45000 });
        await page.click(inputSelector);
        await page.keyboard.type(fullPrompt, { delay: 5 });

        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const replies = document.querySelectorAll('[data-message-author="model"], [role="assistant"], div.prose, div.markdown');
            if (replies.length === 0) return false;
            const last = replies[replies.length - 1];
            const text = last.innerText.trim();
            return text.length > 30 && !text.includes('Generating') && !text.includes('…');
        }, { timeout: 180000 });

        const cevap = await page.evaluate(() => {
            const replies = document.querySelectorAll('[data-message-author="model"], [role="assistant"], div.prose, div.markdown');
            return replies[replies.length - 1]?.innerText?.trim() || 'Cevap alınamadı.';
        });

        history.push(`K: ${soru}`, `G: ${cevap.substring(0, 800)}...`);
        if (history.length > 10) history = history.slice(-10);
        userContexts.set(msg.author.id, history);

        if (cevap.length > 1900) {
            for (const chunk of cevap.match(/[\s\S]{1,1900}/g) || []) {
                await msg.reply(chunk);
                await sleep(1000);
            }
        } else {
            await msg.reply(cevap);
        }

    } catch (err) {
        console.error('Hata:', err.message);

        let msgText = 'Bir sorun çıktı.';
        if (err.message.includes('429')) {
            msgText = '429 Too Many Requests – Browserless limitine takıldık (ücretsiz planda concurrent oturum sınırı var). 5-10 dk bekle veya upgrade et.';
        } else if (err.message.includes('timeout') || err.message.includes('waiting')) {
            msgText = 'Gemini sayfası yavaş veya input bulunamadı.';
        }

        await msg.reply(msgText + '\nTekrar dene.');
    } finally {
        if (page) {
            await page.close().catch(() => {});
        }
    }
});

client.once('ready', async () => {
    console.log(`Bot aktif: ${client.user.tag}`);
    // Başlangıçta browser'ı hazırla (reuse için)
    try {
        await getBrowser();
    } catch (e) {
        console.error('Başlangıç browser hatası:', e);
    }
});

client.login(process.env.DISCORD_TOKEN);