const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { HfInference } = require('@huggingface/inference');
const fs = require('fs');

// --- AYARLAR ---
const DISCORD_TOKEN = 'BURAYA_DISCORD_TOKEN';
const HF_TOKEN = process.env.meshy; // Tamamen ücretsiz aldığın token

const hf = new HfInference(HF_TOKEN);
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const CHARACTERS = [
    "Muichiro Tokito anime character, mist hashira, detailed 3d model",
    "Naruto Uzumaki, sage mode, spiky hair, 3d avatar",
    "Edward Elric, fullmetal alchemist, 3d model"
    // Buraya istediğin kadar ekle, Hugging Face kredi istemez (sadece bazen sıra bekletir)
];

async function generateFree3D(message, prompt) {
    const charName = prompt.split(',')[0];
    try {
        console.log(`[BAŞLADI] ${charName} oluşturuluyor...`);
        
        // Hugging Face üzerinden ücretsiz model çağırma (Örn: StableFast3D)
        // Not: Model ismi güncelliğe göre değişebilir, 'stabilityai/stable-fast-3d' şu an en iyilerinden.
        const response = await hf.textTo3D({
            model: 'stabilityai/stable-fast-3d',
            inputs: prompt,
        });

        // Gelen veriyi (Blob) dosyaya çevir
        const buffer = Buffer.from(await response.arrayBuffer());
        const fileName = `${charName.replace(/\s+/g, '_')}.glb`;
        fs.writeFileSync(fileName, buffer);

        await message.channel.send({
            content: `✅ **${charName}** tamamen ücretsiz oluşturuldu!`,
            files: [new AttachmentBuilder(fileName)]
        });

        fs.unlinkSync(fileName);
    } catch (err) {
        console.error(err);
        await message.channel.send(`❌ **${charName}** sırasında Hugging Face sunucusu yoğun olabilir, tekrar dene.`);
    }
}

client.on('messageCreate', async (msg) => {
    if (msg.content === '!oluştur' && !msg.author.bot) {
        msg.reply("🚀 **Açık kaynaklı modellerle ücretsiz üretim başladı!**");
        CHARACTERS.forEach(char => generateFree3D(msg, char));
    }
});

client.login(process.env.token);