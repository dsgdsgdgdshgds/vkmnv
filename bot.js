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

// Kişi bazlı cooldown'lar
const inviteCooldowns = new Map();          // userId → son invite cevabı zamanı (2 saat)
const nonInviteCooldowns = new Map();       // userId → son non-invite cevap zamanı (30 dk)
const inviteBlockNonInvite = new Map();     // userId → son invite sonrası non-invite blok bitiş zamanı

const INVITE_COOLDOWN_MS = 2 * 60 * 60 * 1000;     // 2 saat
const NON_INVITE_COOLDOWN_MS = 30 * 60 * 1000;     // 30 dk
const INVITE_BLOCK_NON_INVITE_MS = 30 * 60 * 1000; // invite sonrası 30 dk blok

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

  console.log(`İşlenen kod: ${inviteCode}`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const invite = await client.fetchInvite(inviteCode).catch(() => null);
      if (!invite) return false;

      if (client.guilds.cache.has(invite.guild?.id)) return true;

      const guild = await client.acceptInvite(inviteCode);
      console.log(`KATILMA BAŞARILI → ${guild?.name || 'Bilinmeyen'}`);
      return true;

    } catch (err) {
      if (err.message?.includes('captcha') || err.message?.includes('Unknown Invite') || err.code === 10006) {
        return false;
      }
      await new Promise(r => setTimeout(r, 10000 + Math.random() * 10000));
    }
  }
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  const userId = message.author.id;
  const now = Date.now();

  if (message.channel.type !== 'DM' && message.channel.type !== 'GROUP_DM') {
    if (message.channel.id === NOTIFICATION_CHANNEL_ID && message.content.includes(TARGET_ROLE_MENTION)) {
      if (message.content.toLowerCase().includes('kendi')) return;

      const guild = message.guild;
      if (!guild) return;

      let member;
      try { member = await guild.members.fetch(userId); } catch { return; }

      const roleId = TARGET_ROLE_MENTION.replace(/[<@&>]/g, '');
      if (member.roles.cache.has(roleId)) return;

      setTimeout(async () => {
        try { await message.reply('dm gel'); } catch {}
      }, 3000);
    }
    return;
  }

  // DM / Group DM
  const contentLower = message.content.toLowerCase();
  const hasInvite = message.content.match(DISCORD_INVITE_REGEX);

  if (hasInvite && hasInvite.length > 0) {
    // Davet linki var → invite cooldown kontrol
    const lastInvite = inviteCooldowns.get(userId) || 0;
    if (now - lastInvite < INVITE_COOLDOWN_MS) {
      console.log(`Kullanıcı ${userId} için invite cooldown aktif`);
      return;
    }

    let replied = false;

    for (const inviteUrl of hasInvite) {
      if (replied) break;

      const joined = await tryJoinInvite(inviteUrl);

      setTimeout(async () => {
        try {
          if (!joined) {
            await message.reply("Sunucu katılma sınırım doldu kusura bakma katılamadım.");
            await new Promise(r => setTimeout(r, 1500));
          }

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

          await new Promise(r => setTimeout(r, 2000));
          await message.reply('paylaştım, iyi günler.');

          await copyMessageToLogChannel(message);

          // Cooldown'ları güncelle (kişi bazlı)
          inviteCooldowns.set(userId, now);
          inviteBlockNonInvite.set(userId, now + INVITE_BLOCK_NON_INVITE_MS);

          replied = true;

        } catch (err) {
          console.error("DM cevap hatası:", err);
        }
      }, 2800);
    }
  }
  else {
    // Link içermeyen mesaj

    // 1. Bu kullanıcı için invite sonrası blok aktif mi?
    const blockUntil = inviteBlockNonInvite.get(userId) || 0;
    if (now < blockUntil) {
      console.log(`Kullanıcı ${userId} için invite sonrası non-invite blok aktif`);
      return;
    }

    // 2. Normal non-invite cooldown kontrolü
    const lastNonInvite = nonInviteCooldowns.get(userId) || 0;
    if (now - lastNonInvite < NON_INVITE_COOLDOWN_MS) {
      console.log(`Kullanıcı ${userId} için non-invite cooldown aktif`);
      return;
    }

    setTimeout(async () => {
      try {
        await message.reply("sunucu textini tekrar paylaşır mısnız önceki mesajlar yüklenmiyorda.");
        nonInviteCooldowns.set(userId, now);
      } catch (err) {
        console.error("Non-invite reply hatası:", err);
      }
    }, 2000);
  }
});

client.once('ready', () => {
  console.log(`✅ Selfbot aktif: ${client.user.tag}`);
  setInterval(() => {
    console.log(`[Keep-alive] ${new Date().toISOString()} - Sunucu sayısı: ${client.guilds.cache.size}`);
  }, 300000);
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
});