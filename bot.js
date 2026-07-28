const { Client } = require('discord.js-selfbot-v13');

const TOKEN = process.env.token;
const TRIGGER_WORD = 'partnerkee';
const TARGET_CHANNEL_ID = '1425226279279657112';

const client = new Client({ checkUpdate: false });

const randomDelay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
const fixedDelay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let isRunning = false;

client.on('message', async (message) => {
    // Eğer mesaj hedef kanaldan geldiyse ve herhangi bir bottan (veya dışarıdan) "real" kelimesini içeriyorsa
    if (message.channel.id === TARGET_CHANNEL_ID && message.author.id !== client.user.id) {
        if (message.content.toLowerCase().includes('real')) {
            if (isRunning) {
                isRunning = false;
                console.log(`🚨 [DOĞRULAMA / CAPTCHA ALGILANDI] Mesajda "real" kelimesi yakalandı! Güvenlik için döngü otomatik olarak durduruldu. Mesaj: "${message.content}"`);
            }
        }
    }

    if (message.author.id !== client.user.id) return; 
    
    const content = message.content.trim().toLowerCase();

    if (content.includes(TRIGGER_WORD)) {
        if (isRunning) {
            console.log("⚠️ Döngü zaten çalışıyor!");
            return;
        }

        const targetChannel = client.channels.cache.get(TARGET_CHANNEL_ID);
        if (!targetChannel) {
            console.log("⚠️ Belirtilen ID'ye sahip kanal bulunamadı veya bot bu kanala erişemiyor!");
            return;
        }

        isRunning = true;
        console.log(`✅ Gelişmiş mod aktif: ${targetChannel.name}. Döngü başlatıldı!`);

        let loopCount = 0;

        try {
            while (isRunning) {
                loopCount++;

                if (loopCount % Math.floor(Math.random() * 3 + 5) === 0) {
                    const breakTime = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
                    console.log(`☕ İnsan taklidi: Uzun süreli kullanım algılandı, güvenlik için ${(breakTime / 1000).toFixed(1)} saniye mola veriliyor...`);
                    await randomDelay(breakTime, breakTime);
                    if (!isRunning) break;
                }

                const dynamicWait = Math.floor(Math.random() * (19000 - 14000 + 1)) + 14000;
                console.log(`⏳ Bekleme süresi: ${(dynamicWait / 1000).toFixed(1)} saniye bekleniyor...`);
                await randomDelay(14000, 19000);
                if (!isRunning) break;

                await targetChannel.sendTyping().catch(() => {});
                await fixedDelay(Math.floor(Math.random() * 1000) + 800);
                if (!isRunning) break;

                await targetChannel.send('owo');
                console.log(`[BAŞARILI] ${targetChannel.name} -> owo gönderildi.`);

                await fixedDelay(Math.floor(Math.random() * 600) + 1200);
                if (!isRunning) break;

                await targetChannel.send('wb');
                console.log(`[BAŞARILI] ${targetChannel.name} -> wb gönderildi.`);

                await fixedDelay(Math.floor(Math.random() * 600) + 1200);
                if (!isRunning) break;

                await targetChannel.send('wh');
                console.log(`[BAŞARILI] ${targetChannel.name} -> wh gönderildi.`);
            }
        } catch (error) {
            console.error(`[HATA] Döngü sırasında hata oluştu: ${error.message}`);
            isRunning = false;
        }
    } 
    else if (content === 'durdur') {
        if (!isRunning) {
            console.log("⚠️ Zaten çalışan bir döngü yok.");
            return;
        }
        isRunning = false;
        console.log("🛑 Döngü durduruldu.");
    }
});

client.on('ready', () => {
    console.log(`✅ Gelişmiş Selfbot aktif: ${client.user.tag}`);
    console.log("Hazır! Başlatmak için 'partnerkee', durdurmak için 'durdur' yazabilirsiniz.");
});

process.on('unhandledRejection', error => {
    console.error('Beklenmeyen hata (Rejection):', error);
});

process.on('uncaughtException', error => {
    console.error('Kritik hata (Exception):', error);
});

client.login(TOKEN);