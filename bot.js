// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord Kullanım Koşulları'na (ToS) aykırıdır.
// Hesabınız kalıcı olarak banlanabilir (özellikle otomatik DM/spam davranışları yüzünden).
// Bu kod sadece eğitim/deneme amaçlıdır. Gerçek kullanımda tüm risk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

// Render sağlık kontrolü için basit HTTP endpoint
app.get('/', (req, res) => {
  res.status(200).send('Selfbot çalışıyor (Render keep-alive)');
});

app.listen(port, () => {
  console.log(`HTTP sunucu ${port} portunda aktif — Render için zorunlu`);
});

// Environment variable'dan token alıyoruz (Render → Environment sekmesine ekle)
const TOKEN = process.env.DISCORD_TOKEN_SELF;

if (!TOKEN) {
  console.error('HATA: DISCORD_TOKEN_SELF environment variable eksik!');
  process.exit(1);
}

const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const TARGET_ROLE_MENTION = '<@&1425475242398187590>';

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[^\s/]+?(?=\b)/gi;

const client = new Client({ checkUpdate: false });

// ────────────────────────────────────────────────
//  SON PAYLAŞIM ZAMANINI TAKİP ETMEK İÇİN (DM tanıtım için)
// ────────────────────────────────────────────────
let lastInviteReplyTime = 0;
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;   // 2 saat

// Log kanalına mesaj kopyalama
async function copyMessageToLogChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send(`{message.content}`);
    }
  } catch (error) {
    console.error("Log gönderme hatası:", error.message);
  }
}

client.on('messageCreate', async (message) => {
  // Kendi mesajlarını görmezden gel
  if (message.author.id === client.user.id) return;

  const content = message.content.toLowerCase();

  // 1. DM veya Grup DM
  if (message.channel.type === 'DM' || message.channel.type === 'GROUP_DM') {
    
    // A) "yenileme" → link at
    if (content.includes('yenileme')) {
      setTimeout(async () => {
        try { 
          await message.reply('texti tekrar atar mısın önceki mesaj yüklenmedide.');
        } catch (e) {}
      }, 1000);
    }
    
    // B) Davet linki → otomatik tanıtım (2 saatte max 1)
    if (DISCORD_INVITE_REGEX.test(message.content)) {
      
      const now = Date.now();
      
      if (now - lastInviteReplyTime < MIN_INTERVAL_MS) {
        return;
      }

      setTimeout(async () => {
        try {
          await message.reply(`# 🌿 ★ Vinland Saga ~Anime^Manga ☆ — huzur arayan savaşçının sığınağı

**Kılıçların gölgesinde değil, kalbinin huzurunda yaşamak istiyorsan…
Vinland seni bekliyor. ⚔️
Savaşın yorgunluğunu atmak, dostlukla yoğrulmuş bir topluluğun parçası olmak isteyen herkese kapımız açık.
Thorfinn'in aradığı toprakları biz burada bulduk — sen de bize katıl.
Gif:https://tenor.com/view/askeladd-gif-19509516

---

✦ Neler var bizde?
🛡️ Estetik & Viking temalı tasarım
⚔️ Anime sohbetleri (özellikle Vinland Saga üzerine derin muhabbetler)
🌄 Etkinlikler: anime/film geceleri, bilgi yarışmaları, oyunlar
🗡️ Rol ve seviye sistemi (klanlar & savaşçılar seni bekliyor)
🍃 Chill ses kanalları, aktif sohbetler
🤝 Samimi, saygılı ve toksik olmayan bir topluluk**

|| @everyone @here ||
Pins:https://discord.gg/FzZBhH3tnF`);

          setTimeout(async () => {
            try {
              await message.reply('paylaştım, iyi günler.');
              await copyMessageToLogChannel(message);
            } catch (e) {}
          }, 2500);

          lastInviteReplyTime = Date.now();

        } catch (e) {
          console.error("DM cevap hatası:", e.message);
        }
      }, 3000);
    }
  }
  
  // 2. Sunucu mesajları → bildirim kanalı
  else if (message.channel.type === 'GUILD_TEXT') {
    if (message.channel.id === NOTIFICATION_CHANNEL_ID) {
      if (message.content.includes(TARGET_ROLE_MENTION)) {
        
        // ─── YENİ KOŞUL ───
        // Mesajda "kendi" kelimesi varsa cevap verme
        if (content.includes('kendi')) {
          return;  // sessizce geç
        }

        setTimeout(async () => {
          try {
            await message.reply('dm gel');
          } catch (e) {}
        }, 8000); // 1 dk bekle
      }
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Selfbot aktif: ${client.user.tag}`);
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
  process.exit(1);
});