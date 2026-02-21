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
const fs = require('fs');
const http = require('http');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- JSON VERİTABANI ---
const dbPath = path.join(__dirname, 'kanal-ayar.json');

if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({}));
}

function dbSet(key, value) {
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    data[key] = value;
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function dbGet(key) {
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return data[key] || null;
}

// --- HOSTING (render vb. için) ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif 🚀');
}).listen(PORT, () => {
    console.log(`[✓] Hosting port açık: ${PORT}`);
});

// --- KOMUTLAR ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = message.content.trim().split(/ +/)[0].toLowerCase();
    const args = message.content.trim().split(/ +/).slice(1);

    // 1. Sistem kanalı ayarlama
    if (prefix === '#partner-sistem') {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) {
            return message.reply("⚠️ Lütfen bir kanal etiketleyin! Örn: `#partner-sistem #kanal`")
                .then(m => setTimeout(() => m.delete(), 5000));
        }
        dbSet(`sistemKanal_${message.guild.id}`, targetChannel.id);
        return message.reply(`✅ Partnerlik sistemi artık <#${targetChannel.id}> kanalında çalışacak.`);
    }

    // 2. Reklam (form sonucu) kanalı ayarlama
    if (prefix === '#partner-kanal') {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) {
            return message.reply("⚠️ Lütfen bir kanal etiketleyin! Örn: `#partner-kanal #kanal`")
                .then(m => setTimeout(() => m.delete(), 5000));
        }
        dbSet(`reklamKanal_${message.guild.id}`, targetChannel.id);
        return message.reply(`✅ Form doldurulduğunda metinler <#${targetChannel.id}> kanalına gönderilecek.`);
    }

    // 3. Log kanalı ayarlama (yeni)
    if (prefix === '#partner-log') {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) {
            return message.reply("⚠️ Lütfen bir kanal etiketleyin! Örn: `#partner-log #log-kanalı`")
                .then(m => setTimeout(() => m.delete(), 5000));
        }
        dbSet(`logKanal_${message.guild.id}`, targetChannel.id);
        return message.reply(`✅ Partnerlik onay logu artık <#${targetChannel.id}> kanalına gidecek.`);
    }

    // 4. Hedef rol ayarlama (yeni)
    if (prefix === '#partner-rol') {
        const targetRole = message.mentions.roles.first();
        if (!targetRole) {
            return message.reply("⚠️ Lütfen bir rol etiketleyin! Örn: `#partner-rol @Partner`")
                .then(m => setTimeout(() => m.delete(), 5000));
        }
        dbSet(`hedefRol_${message.guild.id}`, targetRole.id);
        return message.reply(`✅ Artık ${targetRole} rolü etiketlendiğinde partnerlik başvuru ekranı açılacak.`);
    }

    // 5. Rol etiketlenince başvuru embedi gönderme
    const hedefRolId = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRolId && message.mentions.roles.has(hedefRolId)) {
        const sistemKanalId = dbGet(`sistemKanal_${message.guild.id}`);
        if (!sistemKanalId || message.channel.id !== sistemKanalId) return;

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
    // Butona basınca modal
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

    // Modal submit
    if (interaction.isModalSubmit() && interaction.customId === 'p_modal') {
        const text = interaction.fields.getTextInputValue('p_text');
        const reklamKanalId = dbGet(`reklamKanal_${interaction.guild.id}`);
        const logKanalId = dbGet(`logKanal_${interaction.guild.id}`);

        // 1. Reklam kanalına tanıtım metni
        if (reklamKanalId) {
            const rChannel = interaction.client.channels.cache.get(reklamKanalId);
            if (rChannel) await rChannel.send({ content: text }).catch(() => {});
        }

        // 2. Log kanalına onay mesajı
        if (logKanalId) {
            const lChannel = interaction.client.channels.cache.get(logKanalId);
            if (lChannel) {
                await lChannel.send({
                    content: `<@${interaction.user.id}>, **✅ Partnerlik Başarıyla Yapıldı.**`
                }).catch(() => {});
            }
        }

        // 3. Kullanıcıya ephemeral hoş geldin mesajı
        const hosgeldinMesaji = `# 🌿 ★ Vinland Saga \~Anime^Manga ☆ — huzur arayan savaşçının sığınağı

**Kılıçların gölgesinde değil, kalbinin huzurunda yaşamak istiyorsan…
Vinland seni bekliyor. ⚔️
Savaşın yorgunluğunu atmak, dostlukla yoğrulmuş bir topluluğun parçası olmak isteyen herkese kapımız açık.
Thorfinn’in aradığı toprakları biz burada bulduk — sen de bize katıl.
Gif:https://tenor.com/view/askeladd-gif-19509516

---

✦ Neler var bizde?

🛡️ Estetik & Viking temalı tasarım
⚔️ Anime sohbetleri (özellikle Vinland Saga üzerine derin muhabbetler)
🌄 Etkinlikler: anime/film geceleri, bilgi yarışmaları, oyunlar
🗡️ Rol ve seviye sistemi (klanlar & savaşçılar seni bekliyor)
🍃 Chill ses kanalları, aktif sohbetler
Samimi, saygılı ve toksik olmayan bir topluluk**
|| @everyone @here ||
Pins:https://discord.gg/FzZBhH3tnF`;

        await interaction.reply({ content: hosgeldinMesaji, ephemeral: true });
    }
});

client.once(Events.ClientReady, () => {
    console.log(`✅ ${client.user.tag} hazır ve JSON veritabanı aktif!`);
});

client.login(process.env.token);