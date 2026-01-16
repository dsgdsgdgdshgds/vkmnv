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

function extractInviteCode(url) {
  const ggMatch = url.match(/discord\.gg\/([a-zA-Z0-9\-_]+)/i);
  if (ggMatch) return ggMatch[1];

  const inviteMatch = url.match(/\/invite\/([a-zA-Z0-9\-_]+)/i);
  if (inviteMatch) return inviteMatch[1];

  const fallback = url.match(/([a-zA-Z0-9\-_]+)(?:\?|$)/i);
  return fallback ? fallback[1] : null;
}

async function tryJoinInvite(inviteUrl) {
  const inviteCode = extractInviteCode(inviteUrl);
  if (!inviteCode || inviteCode.toLowerCase() === 'discord') {
    console.log(`Geçersiz kod: ${inviteUrl} → atlanıyor`);
    return false;
  }

  console.log(`İşlenen kod: ${inviteCode} (orijinal link: ${inviteUrl})`);

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(`[Deneme ${attempt}/6] fetchInvite başlıyor...`);
      const invite = await client.fetchInvite(inviteCode).catch(err => {
        console.log(`fetchInvite başarısız: ${err.message || err}`);
        return null;
      });

      if (!invite) {
        console.log('Davet objesi alınamadı / geçersiz');
        return false;
      }

      const guildName = invite.guild?.name || 'Bilinmeyen';

      if (client.guilds.cache.has(invite.guild?.id)) {
        console.log(`Zaten ${guildName} içinde → başarılı sayılıyor`);
        return true;
      }

      console.log(`client.acceptInvite deneniyor (deneme ${attempt})...`);
      const guild = await client.acceptInvite(inviteCode);

      console.log(`KATILMA BAŞARILI → Sunucu: ${guild?.name || guildName} (ID: ${guild?.id || 'bilinmeyen'})`);
      return true;

    } catch (err) {
      console.error(`Katılma hatası (deneme ${attempt}):`, err.message || err);

      if (err.message?.includes('captcha')) {
        console.log('CAPTCHA çıktı → yeni hesap dene veya manuel onayla');
        return false;
      }

      if (err.message?.includes('Unknown Invite') || err.code === 10006) {
        console.log('Davet geçersiz / bloklanmış → vazgeçiliyor');
        return false;
      }

      const wait = 10000 + Math.random() * 10000;
      console.log(`Tekrar deneme için ~${Math.round(wait/1000)} sn bekleniyor`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  console.log(`Tüm denemeler başarısız (${inviteCode})`);
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
    if (inviteMatches && inviteMatches.length > 0) {
      const now = Date.now();
      if (now - lastInviteReplyTime < MIN_INTERVAL_MS) {
        console.log('2 saat sınırı → atlanıyor');
        return;
      }

      let replied = false;

      for (const inviteUrl of inviteMatches) {
        if (replied) break;

        const joined = await tryJoinInvite(inviteUrl);

        // Cevap verme sırası
        setTimeout(async () => {
          try {
            const apologyText = "Sunucu katılma sınırım doldu kusura bakma katılamadım.";

            if (!joined) {
              // Özür mesajı ayrı gönderiliyor
              await message.reply(apologyText);
              await new Promise(r => setTimeout(r, 1500)); // 1.5 saniye bekle
            }

            // Tanıtım mesajı (her zaman gidiyor)
            const promoText = `# 🌿 ★ Vinland Saga ~Anime^Manga ☆ — huzur arayan savaşçının sığınağı

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
Pins: https://discord.gg/FzZBhH3tnF`;

            await message.reply(promoText);

            await new Promise(r => setTimeout(r, 2000)); // 2 saniye bekle
            await message.reply('paylaştım, iyi günler.');

            await copyMessageToLogChannel(message);
            lastInviteReplyTime = Date.now();

            replied = true;

          } catch (err) {
            console.error("DM cevap hatası:", err.message);
          }
        }, 2800);  // genel başlangıç gecikmesi (anti-flood)

        // İlk cevap planlandıysa kalan davetleri atla
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

        const roleId = TARGET_ROLE_MENTION.replace(/[<@&>]/g, '');
        if (member.roles.cache.has(roleId)) return;

        setTimeout(async () => {
          try {
            await message.reply('dm gel');
          } catch {}
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