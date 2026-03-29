const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

const DISCORD_TOKEN = 'BURAYA_DISCORD_BOT_TOKENINI_YAZ';
const MESHY_API_KEY = 'BURAYA_MESHY_API_KEYINI_YAZ';

const CHARACTERS = [
    // Demon Slayer
    "Muichiro Tokito, Mist Hashira, long black hair turquoise tips, demon slayer uniform, anime style 3d model",
    "Tanjiro Kamado, green checkered haori, hanafuda earrings, anime style 3d model",
    "Nezuko Kamado, pink kimono, bamboo muzzle, anime style 3d model",
    // Naruto
    "Naruto Uzumaki, orange jumpsuit, yellow spiky hair, hidden leaf headband, anime style 3d model",
    "Sasuke Uchiha, uchiha clan outfit, sharingan eye, black hair, anime style 3d model",
    "Kakashi Hatake, silver hair, ninja mask, jonin vest, anime style 3d model",
    // FMAB
    "Edward Elric, red cloak, blonde braided hair, automail arm, anime style 3d model",
    "Alphonse Elric, giant silver armor, blue loincloth, anime style 3d model",
    "Roy Mustang, amestris military uniform, black hair, flame alchemy gloves, anime style 3d model"
];

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const headers = { 'Authorization': `Bearer ${MESHY_API_KEY}` };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Tek bir karakterin tüm sürecini (Oluştur -> Bekle -> Gönder) yöneten fonksiyon
async function processAvatar(message, prompt) {
    const charName = prompt.split(',')[0];
    
    try {
        // 1. Görevi Başlat
        const res = await axios.post('https://api.meshy.ai/v1/text-to-3d', {
            prompt: prompt, art_style: 'anime', mode: 'preview'
        }, { headers });

        const taskId = res.data.result;
        console.log(`[BAŞLADI] ${charName} için görev ID: ${taskId}`);

        // 2. Durum Kontrolü (Polling)
        let glbUrl = null;
        while (true) {
            await sleep(20000); // API'yi yormamak için 20sn bekle
            const statusRes = await axios.get(`https://api.meshy.ai/v1/text-to-3d/${taskId}`, { headers });
            
            if (statusRes.data.status === 'SUCCEEDED') {
                glbUrl = statusRes.data.model_url;
                break;
            } else if (statusRes.data.status === 'FAILED') {
                throw new Error("API hatası.");
            }
        }

        // 3. İndir ve Discord'a Gönder
        const fileName = `${charName.replace(/\s+/g, '_')}.glb`;
        const response = await axios({ url: glbUrl, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(fileName);
        response.data.pipe(writer);

        await new Promise((resolve) => writer.on('finish', resolve));

        const attachment = new AttachmentBuilder(fileName);
        await message.channel.send({ content: `✅ **${charName}** hazır!`, files: [attachment] });
        
        fs.unlinkSync(fileName); // Dosyayı sil
        console.log(`[BİTTİ] ${charName} gönderildi.`);

    } catch (err) {
        console.error(`Hata (${charName}):`, err.message);
        await message.channel.send(`❌ **${charName}** oluşturulamadı.`);
    }
}

client.on('messageCreate', async (message) => {
    if (message.content === '!oluştur' && !message.author.bot) {
        message.reply(`🚀 **9 karakter için istekler aynı anda gönderildi!** Modeller hazır oldukça buraya düşecek.`);
        
        // TÜM KARAKTERLERİ AYNI ANDA BAŞLAT (Paralel)
        // Promise.all yerine tek tek başlatıyoruz ki biri hata alsa da diğerleri devam etsin
        CHARACTERS.forEach(char => {
            processAvatar(message, char);
        });
    }
});

client.login(process.env.token);