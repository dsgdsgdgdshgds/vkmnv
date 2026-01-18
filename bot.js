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

const userContexts = new Map();

async function getGeminiPage() {
    if (!process.env.BROWSERLESS_TOKEN) {
        throw new Error("BROWSERLESS_TOKEN ortam değişkeni eksik! Render Environment Variables bölümünden ekleyin.");
    }

    const endpoint = `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`;

    console.log('Browserless bağlantısı deneniyor...');

    const browser = await puppeteer.connect({
        browserWSEndpoint: endpoint,
        ignoreHTTPSErrors: true,
        defaultViewport: null
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'tr-TR,tr;q=0.9'
    });

    await page.goto('https://gemini.google.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
    });

    // Sayfanın biraz daha yüklenmesini bekle (hydration için)
    await page.waitForTimeout(4000);

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
        const fullPrompt = history.length > 0
            ? `Önceki konuşma:\n${history.join('\n')}\n\nYeni soru: ${soru}`
            : soru;

        // 2025-2026 Gemini input alanı (contenteditable div çok yaygın)
        const inputSelector = [
            'div[contenteditable="true"][role="textbox"]',
            'div[role="textbox"]',
            'div[contenteditable="true"]',
            'div[data-placeholder*="Gemini" i]',
            'div[aria-label*="Gemini" i]'
        ].join(', ');

        await page.waitForSelector(inputSelector, { timeout: 45000 });

        // Focus yap ve yaz
        await page.click(inputSelector);
        await page.keyboard.type(fullPrompt, { delay: 8 });  // biraz yavaş yaz ki algılasın

        // Enter
        await page.keyboard.press('Enter');

        // Cevap bekleme (2026 selector varyasyonları)
        await page.waitForFunction(() => {
            const selectors = [
                '[data-message-author="model"]',
                '[role="assistant"]',
                'div.model-response',
                'div.prose',
                'div.markdown',
                '.response-container',
                'div[data-testid*="response"]'
            ].join(', ');
            
            const replies = document.querySelectorAll(selectors);
            if (replies.length === 0) return false;
            
            const lastReply = replies[replies.length - 1];
            const text = lastReply.innerText.trim();
            return text.length > 30 && !text.includes('Generating');
        }, { timeout: 180000 });  // 3 dk'ya kadar bekle (yavaş günlerde gerekli)

        const cevap = await page.evaluate(() => {
            const selectors = [
                '[data-message-author="model"]',
                '[role="assistant"]',
                'div.model-response',
                'div.prose',
                'div.markdown',
                '.response-container',
                'div[data-testid*="response"]'
            ].join(', ');
            
            const replies = document.querySelectorAll(selectors);
            const last = replies[replies.length - 1];
            return last ? last.innerText.trim() : 'Cevap alınamadı.';
        });

        // Hafıza güncelle
        history.push(`Kullanıcı: ${soru}`);
        history.push(`Gemini: ${cevap.substring(0, 900)}...`);
        if (history.length > 10) history = history.slice(-10);
        userContexts.set(msg.author.id, history);

        // Cevabı gönder (Discord 2000 karakter sınırı)
        if (cevap.length > 1900) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
                await msg.reply(chunk);
                await new Promise(r => setTimeout(r, 800)); // flood önlemek için kısa bekleme
            }
        } else {
            await msg.reply(cevap || 'Cevap alınamadı, siteyi kontrol et.');
        }

    } catch (err) {
        console.error('Hata:', err.message || err);
        
        let hataMesaj = 'Bağlantı veya sayfa yüklenmesi sırasında sorun çıktı.';
        
        if (err.message.includes('BROWSERLESS_TOKEN')) {
            hataMesaj = 'BROWSERLESS_TOKEN eksik veya yanlış. Render Environment Variables\'dan kontrol et.';
        } else if (err.message.includes('401')) {
            hataMesaj = '401 Unauthorized – Browserless token geçersiz veya süresi dolmuş.';
        } else if (err.message.includes('waiting for selector')) {
            hataMesaj = 'Gemini sayfası input alanı bulunamadı (arayüz değişmiş olabilir).';
        } else if (err.message.includes('timeout')) {
            hataMesaj = 'Gemini çok yavaş cevap verdi veya timeout oldu.';
        }

        await msg.reply(hataMesaj + '\nBiraz bekleyip tekrar dene.');
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
});

client.once('ready', () => {
    console.log(`Bot aktif: ${client.user.tag}`);
    console.log('Browserless + Gemini web entegrasyonu çalışıyor');
});

client.login(process.env.DISCORD_TOKEN);