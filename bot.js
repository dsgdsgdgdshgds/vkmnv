// !!! ÖNEMLİ UYARI !!!
// Selfbot ToS ihlali → ban riski çok yüksek
// Eğitim amaçlıdır, sorumluluk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fetch = require('node-fetch');   // npm install node-fetch@2

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
  console.error('HATA: DISCORD_TOKEN_SELF eksik!');
  process.exit(1);
}

const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const TARGET_ROLE_MENTION = '<@&1425475242398187590>';

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([^\s/]+?)(?=\b|$)/gi;

const client = new Client({ checkUpdate: false });

let lastInviteReplyTime = 0;
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;

async function copyMessageToLogChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) await logChannel.send(message.content);
  } catch (error) {
    console.error("Log hatası:", error.message);
  }
}

async function tryJoinInvite(inviteCode, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[\( {attempt}/ \){maxAttempts}] Deneme → ${inviteCode}`);

      const invite = await client.fetchInvite(inviteCode).catch(err => {
        console.log("fetchInvite başarısız:", err.message);
        return null;
      });

      if (!invite) {
        console.log("Davet bulunamadı / geçersiz");
        return false;
      }

      const guildName = invite.guild?.name || 'Bilinmeyen sunucu';

      if (client.guilds.cache.has(invite.guild?.id)) {
        console.log(`Zaten ${guildName} içinde → atlanıyor`);
        return true;
      }

      // Güncel yöntem 1: client.acceptInvite varsa
      if (typeof client.acceptInvite === 'function') {
        console.log("client.acceptInvite deneniyor...");
        await client.acceptInvite(inviteCode);
        console.log(`client.acceptInvite ile katıldı: ${guildName}`);
        return true;
      }

      // Güncel yöntem 2: invite.acceptInvite varsa (eski örneklerde geçiyor)
      if (typeof invite.acceptInvite === 'function') {
        console.log("invite.acceptInvite deneniyor...");
        await invite.acceptInvite();
        console.log(`invite.acceptInvite ile katıldı: ${guildName}`);
        return true;
      }

      // Yöntem 3: Raw API POST (en güncel alternatif)
      console.log("Raw API POST deneniyor...");
      const response = await fetch(`https://discord.com/api/v9/invites/${inviteCode}`, {
        method: 'POST',
        headers: {
          'Authorization': TOKEN,
          'Content-Type': 'application/json',
          'User-Agent': 'Discord Client/1.0.9154 (Windows NT 10.0; Win64; x64)',
        },
        body: JSON.stringify({})
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok || data.guild?.id) {
        console.log(`RAW API ile katıldı: ${data.guild?.name || guildName}`);
        return true;
      }

      console.log("API cevabı:", data);

      if (data.message?.includes('captcha')) {
        console.log("CAPTCHA gerekiyor → otomatik geçilemez");
        return false;
      }

      if (data.message?.includes('Unknown Invite') || data.code === 10006) {
        console.log("Davet geçersiz → vazgeçiliyor");
        return false;
      }

      if (response.status === 429) {
        const retry = (data.retry_after || 15) * 1000;
        console.log(`Rate limit → ${Math.round(retry/1000)} sn bekleniyor`);
        await new Promise(r => setTimeout(r, retry));
        continue;
      }

      await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000));

    } catch (err) {
      console.error(`Hata (deneme ${attempt}):`, err.message || err);
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  console.log(`Katılamadı (${inviteCode})`);
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

  setInterval(() => {
    console.log(`[Keep-alive] ${new Date().toISOString()} - Sunucu: ${client.guilds.cache.size}`);
  }, 300000); // 5 dk
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
  console.error('Token veya kütüphane sürümünü kontrol et.');
});