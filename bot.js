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

// --- HOSTING ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif 🚀');
}).listen(PORT, () => {
    console.log(`[✓] Hosting port açık: ${PORT}`);
});

// Kurulum sırası hatırlatma metni
const KURULUM_SIRASI = `**Kurulum sırası önerisi:**
1. #partner-rol @Partner  
   → Hangi rol etiketlenince sistem açılsın?
2. #partner-sistem #kanal  
   → Butonun görüneceği kanal
3. #partner-kanal #kanal  
   → Onaylanan tanıtım metninin gönderileceği kanal
4. #partner-log #kanal  
   → Başarılı başvuru logu kanalı
5. #partner-mesaj  
   → Kullanıcıya gönderilecek davet mesajı (isteğe bağlı)

Tüm ayarları yaptıktan sonra test etmek için o role sahip biriyle rolü etiketleyin!`;

// --- KOMUTLAR ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = message.content.trim().split(/ +/)[0].toLowerCase();
    const args = message.content.trim().split(/ +/).slice(1).join(' ');

    // Yardım komutu
    if (prefix === '#yardım' || prefix === '#help') {
        const embed = new EmbedBuilder()
            .setTitle('🤝 Partner Bot Yardım Menüsü')
            .setColor('#5865F2')
            .setDescription('Aşağıdaki komutlarla partnerlik sistemini tamamen özelleştirebilirsiniz.')
            .addFields(
                { name: '#partner-sistem #kanal', value: 'Başvuru butonunun görüneceği kanalı ayarlar', inline: true },
                { name: '#partner-kanal #kanal', value: 'Onaylanan tanıtım metninin gönderileceği kanal', inline: true },
                { name: '#partner-log #kanal', value: 'Başarılı başvuru logunun gideceği kanal', inline: true },
                { name: '#partner-rol @rol', value: 'Hangi rol etiketlenince sistem çalışsın', inline: true },
                { name: '#partner-mesaj', value: 'Onaylandıktan sonra kullanıcıya gönderilecek davet/tanıtım mesajını ayarlar\n(İkinci satırdan itibaren metni yazın)', inline: false },
                { name: 'Kullanım örneği:', value: '```#partner-mesaj\nSunucumuza hoş geldin!\nBurası çok eğlenceli bir yer...\nDavet link: discord.gg/abc```', inline: false }
            )
            .addFields({ name: 'Kurulum Sırası Hatırlatma', value: KURULUM_SIRASI, inline: false })
            .setFooter({ text: 'Tüm ayarlar sunucuya özeldir • Partner Bot' });

        return message.channel.send({ embeds: [embed] });
    }

    // 1. Hedef rol (sıralamada ilk öneri)
    if (prefix === '#partner-rol') {
        const target = message.mentions.roles.first();
        if (!target) return message.reply('⚠️ Bir rol etiketlemelisiniz! Örn: `#partner-rol @Partner`').then(m => setTimeout(() => m.delete(), 8000));
        dbSet(`hedefRol_${message.guild.id}`, target.id);
        return message.reply(`✅ Tetikleyici rol → \( {target}\n\n**Sonraki adım:**\n#partner-sistem #kanal yazarak butonun görüneceği kanalı belirleyin.\n\n \){KURULUM_SIRASI}`);
    }

    // 2. Sistem kanalı
    if (prefix === '#partner-sistem') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketlemelisiniz!').then(m => setTimeout(() => m.delete(), 8000));
        dbSet(`sistemKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Sistem kanalı → <#\( {target.id}>\n\n**Sonraki adım:**\n#partner-kanal #kanal yazarak tanıtım metninin gideceği kanalı ayarlayın.\n\n \){KURULUM_SIRASI}`);
    }

    // 3. Reklam / tanıtım kanalı
    if (prefix === '#partner-kanal') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketlemelisiniz!').then(m => setTimeout(() => m.delete(), 8000));
        dbSet(`reklamKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Tanıtım metni kanalı → <#\( {target.id}>\n\n**Sonraki adım:**\n#partner-log #kanal yazarak log kanalını belirleyin.\n\n \){KURULUM_SIRASI}`);
    }

    // 4. Log kanalı
    if (prefix === '#partner-log') {
        const target = message.mentions.channels.first();
        if (!target) return message.reply('⚠️ Bir kanal etiketlemelisiniz!').then(m => setTimeout(() => m.delete(), 8000));
        dbSet(`logKanal_${message.guild.id}`, target.id);
        return message.reply(`✅ Log kanalı → <#\( {target.id}>\n\n**Sonraki adım:**\n#partner-mesaj yazarak kullanıcıya gönderilecek davet mesajını ayarlayabilirsiniz (isteğe bağlı).\n\n \){KURULUM_SIRASI}`);
    }

    // 5. Davet / tanıtım mesajı ayarlama
    if (prefix === '#partner-mesaj') {
        if (!args.trim()) {
            return message.reply('⚠️ Lütfen mesaj içeriğini de yazın!\nÖrnek:\n```#partner-mesaj\nSunucumuza hoş geldin!\nBurası anime & chill ortamı\ndiscord.gg/abcxyz```');
        }
        dbSet(`davetMesaji_${message.guild.id}`, args);
        return message.reply('✅ Tanıtım / davet mesajı güncellendi!\n\nArtık kurulum tamamlandı diyebiliriz 🎉\nTest için partner rolünü etiketleyerek deneyebilirsiniz.\n\n' + KURULUM_SIRASI);
    }

    // Rol etiketlenince başvuru ekranı
    const hedefRolId = dbGet(`hedefRol_${message.guild.id}`);
    if (hedefRolId && message.mentions.roles.has(hedefRolId)) {
        const sistemKanalId = dbGet(`sistemKanal_${message.guild.id}`);
        if (!sistemKanalId || message.channel.id !== sistemKanalId) return;

        const embed = new EmbedBuilder()
            .setTitle('🤝 Partnerlik Başvurusu')
            .setDescription(`Partnerlik başvurusu yapmak için aşağıdaki butona tıklayın ve formu doldurun.\n<@${message.author.id}>`)
            .setColor('#5865F2')
            .setFooter({ text: 'Partnerlik sistemi • ' + message.guild.name });

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
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    // Buton → Modal
    if (interaction.isButton() && interaction.customId === 'p_basvuru') {
        const modal = new ModalBuilder()
            .setCustomId('p_modal')
            .setTitle('Partnerlik Başvurusu');

        const input = new TextInputBuilder()
            .setCustomId('p_text')
            .setLabel('Sunucu Tanıtım Metni')
            .setPlaceholder('Sunucunuzün tanıtım yazısını buraya yapıştırın...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    // Modal submit
    if (interaction.isModalSubmit() && interaction.customId === 'p_modal') {
        await interaction.deferReply({ ephemeral: true });

        const text = interaction.fields.getTextInputValue('p_text');
        const guildId = interaction.guild.id;

        const reklamKanalId = dbGet(`reklamKanal_${guildId}`);
        const logKanalId   = dbGet(`logKanal_${guildId}`);
        const davetMesaji  = dbGet(`davetMesaji_${guildId}`);   // ← varsayılan yok, yoksa undefined → hiçbir şey gönderilmez

        // Tanıtım metnini gönder
        if (reklamKanalId) {
            const ch = interaction.client.channels.cache.get(reklamKanalId);
            if (ch) await ch.send({ content: text }).catch(() => {});
        }

        // Log at
        if (logKanalId) {
            const ch = interaction.client.channels.cache.get(logKanalId);
            if (ch) {
                await ch.send(`<@${interaction.user.id}> **→ Partnerlik başarıyla tamamlandı!**`).catch(() => {});
            }
        }

        // Eğer davet mesajı ayarlanmışsa gönder, yoksa boş (hiçbir şey yazma)
        if (davetMesaji) {
            await interaction.editReply({ content: davetMesaji });
        } else {
            await interaction.editReply({ content: 'Başvurunuz alındı ve işleme alındı! İyi şanslar ✌️' });
        }
    }
});

client.once(Events.ClientReady, () => {
    console.log(`✅ ${client.user.tag} hazır! Partner bot aktif`);
});

client.login(process.env.token);