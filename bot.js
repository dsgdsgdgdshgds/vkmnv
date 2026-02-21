const { 
    Client, 
    GatewayIntentBits, 
    Events, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    EmbedBuilder 
} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ] 
});

// --- AYARLAR ---
const HEDEF_ROL_ID = "TETIKLEYICI_ROL_ID"; // Formu tetikleyecek rol ID
const LOG_KANAL_ID = "1447604632577904760"; // "Partnerlik Yapıldı" logu

client.once(Events.ClientReady, () => {
    console.log(`✅ ${client.user.tag} hazır ve veritabanı bağlandı!`);
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;

    // 1. SİSTEM KANALI AYARLAMA (Etikete cevap verilecek yer)
    if (message.content.startsWith('#partner-sistem')) {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) return message.reply("⚠️ Lütfen bir kanal etiketleyin! Örn: `#partner-sistem #kanal`").then(m => setTimeout(() => m.delete(), 5000));
        
        await db.set(`sistemKanal_${message.guild.id}`, targetChannel.id);
        return message.reply(`✅ Partnerlik sistemi artık <#${targetChannel.id}> kanalında çalışacak.`);
    }

    // 2. REKLAM KANALI AYARLAMA (Formun gönderileceği yer)
    if (message.content.startsWith('#partner-kanal')) {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) return message.reply("⚠️ Lütfen bir kanal etiketleyin! Örn: `#partner-kanal #kanal`").then(m => setTimeout(() => m.delete(), 5000));
        
        await db.set(`reklamKanal_${message.guild.id}`, targetChannel.id);
        return message.reply(`✅ Form doldurulduğunda metinler <#${targetChannel.id}> kanalına gönderilecek.`);
    }

    // 3. ROL ETİKETLEME KONTROLÜ
    if (message.mentions.roles.has(HEDEF_ROL_ID)) {
        const ayarliSistemKanal = await db.get(`sistemKanal_${message.guild.id}`);
        if (!ayarliSistemKanal || message.channel.id !== ayarliSistemKanal) return;

        const embed = new EmbedBuilder()
            .setTitle("🤝 Partnerlik Başvurusu")
            .setDescription(`Partnerlik başvurusu yapmak için aşağıdaki butona tıklayın ve formu doldurun. <@${message.author.id}>`)
            .setColor("#5865F2");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('p_basvuru')
                .setLabel('Başvuru Yap')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    // 4. BUTONA BASINCA MODAL AÇ
    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder()
            .setCustomId('p_modal')
            .setTitle('Partnerlik Başvurusu');

        const partnerInput = new TextInputBuilder()
            .setCustomId('p_text')
            .setLabel("Sunucu Tanıtım Metni")
            .setPlaceholder("Sunucunuzun textini buraya yapıştırın...")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(partnerInput));
        await interaction.showModal(modal);
    }

    // 5. FORM GÖNDERİLİNCE
    if (interaction.isModalSubmit() && interaction.customId === 'p_modal') {
        const text = interaction.fields.getTextInputValue('p_text');
        const reklamKanalId = await db.get(`reklamKanal_${interaction.guild.id}`);

        // Reklam kanalına gönder
        if (reklamKanalId) {
            const rChannel = interaction.client.channels.cache.get(reklamKanalId);
            if (rChannel) await rChannel.send({ content: text });
        }

        // Onay loguna gönder
        const lChannel = interaction.client.channels.cache.get(LOG_KANAL_ID);
        if (lChannel) {
            await lChannel.send({ content: `<@${interaction.user.id}>, **✅ Partnerlik Başarıyla Yapıldı.**` });
        }

        // Gizli Mesaj
        const hosgeldinMesaji = `🌟🎉 𝐇𝐨𝐬̧ 𝐆𝐞𝐥𝐝𝐢𝐧 𝐓𝐨𝐩𝐥𝐮𝐠̆𝐮𝐦𝐮𝐳𝐚! 🎉🌟\nSohbete dahil olmayı unutma! 🫶🔥\n\nlink: https://discord.gg/hFuWBhNrfR\n||@everyone | @here||`;

        await interaction.reply({ content: hosgeldinMesaji, ephemeral: true });
    }
});

client.login(process.env.token);
