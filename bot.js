// !!! ÖNEMLİ UYARI !!!
// Selfbot ToS ihlali – ban riski çok yüksek
// Eğitim amaçlıdır, sorumluluk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.status(200).send('Selfbot çalışıyor (Render keep-alive)');
});

app.listen(port, () => {
  console.log(`HTTP sunucu ${port} portunda aktif`);
});

const TOKEN = process.env.DISCORD_TOKEN_SELF;

if (!TOKEN) {
  console.error('TOKEN EKSİK!');
  process.exit(1);
}

// Hataları yakala (Render exited early önleme)
process.on('unhandledRejection', reason => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err.message);
  console.error(err.stack);
});

const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const TARGET_ROLE_MENTION = '<@&1425475242398187590>';

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([^\s/]+?)(?=\b|$)/gi;

const client = new Client({ checkUpdate: false });

let lastInviteReplyTime = 0;
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 saat

async function copyMessageToLogChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) await logChannel.send(message.content);
  } catch (error) {
    console.error("Log hatası:", error.message);
  }
}

// Modülün kendi katılma fonksiyonu (client.acceptInvite)
async function tryJoinInvite(inviteCodeOrLink, maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[\( {attempt}/ \){maxAttempts}] Katılma denemesi → ${inviteCodeOrLink}`);

      // invite objesi al (zorunlu değil ama cache kontrolü için iyi)
      const invite = await client.fetchInvite(inviteCodeOrLink).catch(() => null);
      if (invite && client.guilds.cache.has(invite.guild?.id)) {
        console.log(`Zaten içeride → atlanıyor`);
        return true;
      }

      // Modülün sunduğu en temiz yöntem
      const guild = await client.acceptInvite(inviteCodeOrLink);
      console.log(`Başarıyla katıldı → ${guild?.name || 'bilinmeyen sunucu'}`);
      return true;

    } catch (err) {
      console.error(`Katılma hatası (deneme ${attempt}):`, err.message || err);

      if (err.message?.includes('captcha')) {
        console.log('CAPTCHA çıktı → otomatik katılım şu an imkansız');
        return false;
      }

      if (err.message?.includes('Unknown Invite') || err.code === 10006) {
        console.log('Davet geçersiz → vazgeçiliyor');
        return false;
      }

      if (attempt < maxAttempts) {
        const wait = 100 + Math.random() * 101; // 5-15 sn arası rastgele
        console.log(`Tekrar deneme için ${Math.round(wait/1000)} sn bekleniyor...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  console.log(`Tüm denemeler başarısız → ${inviteCodeOrLink}`);
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  const content = message.content.toLowerCase();

  if (message.channel.type === 'DM' || message.channel.type === 'GROUP_DM') {

    if (content.includes('yenileme')) {
      setTimeout(async () => {
        try {
          await message.reply('texti tekrar atar mısın önceki mesaj yüklenmedide.');
        } catch {}
      }, 1000);
      return;
    }

    const inviteMatches = message.content.match(DISCORD_INVITE_REGEX);
    if (inviteMatches) {
      const now = Date.now();
      if (now - lastInviteReplyTime < MIN_INTERVAL_MS) {
        console.log('2 saat sınırı → tanıtım atılmadı');
        return;
      }

      for (const inviteUrl of inviteMatches) {
        const codeMatch = inviteUrl.match(/\/([a-zA-Z0-9\-_]+?)(?=\b|$)/i);
        const inviteCode = codeMatch ? codeMatch[1] : null;
        if (!inviteCode) continue;

        console.log(`Davet kodu tespit: ${inviteCode}`);

        const joined = await tryJoinInvite(inviteCode); // veya direkt inviteUrl verilebilir

        if (joined) {
          setTimeout(async () => {
            try {
              await message.reply(`# 🌿 ★ Vinland Saga ~Anime^Manga ☆ — huzur arayan savaşçının sığınağı

**Kılıçların gölgesinde değil, kalbinin huzurunda yaşamak istiyorsan…
Vinland seni bekliyor. ⚔️
Savaşın yorgunluğunu atmak, dostlukla yoğrulmuş bir topluluğun parçası olmak isteyen herkese kapımız açık.
Thorfinn'in aradığı toprakları biz burada bulduk — sen de bize katıl.**

Gif: https://tenor.com/view/askeladd-gif-19509516

---

✦ Neler var bizde?
🛡️ Estetik & Viking temalı tasarım
⚔️ Anime sohbetleri (özellikle Vinland Saga üzerine derin muhabbetler)
🌄 Etkinlikler: anime/film geceleri, bilgi yarışmaları, oyunlar
🗡️ Rol ve seviye sistemi (klanlar & savaşçılar seni bekliyor)
🍃 Chill ses kanalları, aktif sohbetler
🤝 Samimi, saygılı ve toksik olmayan bir topluluk**

|| @everyone @here ||
Pins: https://discord.gg/FzZBhH3tnF`);

              setTimeout(async () => {
                await message.reply('paylaştım, iyi günler.');
                await copyMessageToLogChannel(message);
              }, 2500);

              lastInviteReplyTime = Date.now();

            } catch (e) {
              console.error("DM tanıtım hatası:", e.message);
            }
          }, 3000);
        }
      }
    }
  }

  else if (message.channel.type === 'GUILD_TEXT') {
    if (message.channel.id === NOTIFICATION_CHANNEL_ID) {
      if (message.content.includes(TARGET_ROLE_MENTION)) {

        if (content.includes('kendi')) return;

        const guild = message.guild;
        if (!guild) return;

        let member;
        try {
          member = await guild.members.fetch(message.author.id);
        } catch (err) {
          console.log("Üye fetch hatası:", err.message);
          return;
        }

        const targetRoleId = TARGET_ROLE_MENTION.replace(/[<@&>]/g, '');
        if (member.roles.cache.has(targetRoleId)) {
          console.log(`${message.author.tag} zaten hedef rolde → dm gel atılmadı`);
          return;
        }

        setTimeout(async () => {
          try {
            await message.reply('dm gel');
          } catch (e) {
            console.error("Reply hatası:", e.message);
          }
        }, 3000);
      }
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Selfbot aktif: ${client.user.tag}`);

  setInterval(() => {
    console.log(`[Keep-alive] ${new Date().toISOString()} - Sunucu sayısı: ${client.guilds.cache.size}`);
  }, 300000); // 5 dk
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
});