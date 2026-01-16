// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord ToS'a aykırıdır → ban riski çok yüksek
// Bu kod sadece eğitim/deneme amaçlıdır. Tüm risk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.status(200).send('Selfbot çalışıyor (Render keep-alive)');
});

app.listen(port, () => {
  console.log(`HTTP sunucu ${port} portunda aktif — Render için zorunlu`);
});

const TOKEN = process.env.DISCORD_TOKEN_SELF;

if (!TOKEN) {
  console.error('HATA: DISCORD_TOKEN_SELF environment variable eksik!');
  process.exit(1);
}

const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const TARGET_ROLE_MENTION = '<@&1425475242398187590>';

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([^\s/]+?)(?=\b|$)/gi;

const client = new Client({ checkUpdate: false });

let lastInviteReplyTime = 0;
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;   // 2 saat

async function copyMessageToLogChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send(message.content);
    }
  } catch (error) {
    console.error("Log gönderme hatası:", error.message);
  }
}

// Tek bir katılma denemesi (invite.acceptInvite)
async function singleJoinAttempt(inviteCode, attemptNum) {
  try {
    const invite = await client.fetchInvite(inviteCode);
    console.log(`[Deneme ${attemptNum}] Davet bulundu: \( {invite.guild?.name || 'Bilinmeyen'} ( \){inviteCode})`);

    if (client.guilds.cache.has(invite.guild?.id)) {
      console.log(`Zaten içeride → atlanıyor`);
      return true;
    }

    console.log(`acceptInvite() deneniyor...`);
    await invite.acceptInvite();  // ← İstediğin yöntem bu

    console.log(`Başarıyla katıldı: ${invite.guild?.name || 'bilinmeyen'}`);
    return true;

  } catch (err) {
    console.error(`Katılma hatası:`, err.message || err);
    return false;
  }
}

// 3 paralel deneme grubu + 5 sn aralıkla tekrar
async function tryJoinInvite(inviteCode) {
  const MAX_GROUPS = 3;  // 3 kez 3 paralel deneme = toplam 9 deneme max

  for (let group = 1; group <= MAX_GROUPS; group++) {
    console.log(`\n--- Grup \( {group}/ \){MAX_GROUPS} başlıyor (${inviteCode}) ---`);

    // Aynı anda 3 paralel deneme
    const promises = [
      singleJoinAttempt(inviteCode, `${group}-1`),
      singleJoinAttempt(inviteCode, `${group}-2`),
      singleJoinAttempt(inviteCode, `${group}-3`)
    ];

    const results = await Promise.allSettled(promises);

    // Eğer herhangi biri başarılıysa erken çık
    const anySuccess = results.some(r => r.status === 'fulfilled' && r.value === true);
    if (anySuccess) {
      console.log(`Başarılı katılım tespit edildi → kalan denemeler iptal`);
      return true;
    }

    if (group < MAX_GROUPS) {
      console.log(`Grup ${group} bitti. 5 saniye bekleniyor...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`Tüm gruplar başarısız (${inviteCode})`);
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
        const codeMatch = inviteUrl.match(/\/([a-zA-Z0-9\-_]+)(?:$|\s)/i);
        const inviteCode = codeMatch ? codeMatch[1] : null;
        if (!inviteCode) continue;

        console.log(`Davet kodu tespit: ${inviteCode}`);

        const joined = await tryJoinInvite(inviteCode);

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
        const hasTargetRole = member.roles.cache.has(targetRoleId);

        if (hasTargetRole) {
          console.log(`${message.author.tag} zaten hedef role sahip → "dm gel" atılmadı`);
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
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
});