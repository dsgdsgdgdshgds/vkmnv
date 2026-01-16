// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord ToS'a aykırıdır → ban riski çok yüksek
// Bu kod sadece eğitim/deneme amaçlıdır. Tüm risk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fetch = require('node-fetch');   // npm install node-fetch@2 yapmayı unutma

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

// Tek bir raw API katılma denemesi
async function singleRawJoinAttempt(inviteCode, attemptNum) {
  try {
    console.log(`[Raw Deneme ${attemptNum}] Kod: ${inviteCode}`);

    const response = await fetch(`https://discord.com/api/v9/invites/${inviteCode}`, {
      method: 'POST',
      headers: {
        'Authorization': TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'Discord Client/1.0.9154 (Windows NT 10.0; Win64; x64)',
        'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InRyLVRSIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTIwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiIiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjo5OTk5OTksInJlbGVhc2VfY2hhbm5lbCI6InN0YWJsZSIsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGx9'
      },
      body: JSON.stringify({})
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (response.ok || data.guild?.id) {
      console.log(`RAW API ile katıldı: ${data.guild?.name || 'bilinmeyen'}`);
      return true;
    }

    console.log("API cevabı:", data);

    if (data.message?.toLowerCase().includes('captcha')) {
      console.log('CAPTCHA çıktı → bu deneme başarısız');
      return false;
    }

    if (data.message?.includes('Unknown Invite') || data.code === 10006) {
      console.log('Davet geçersiz → vazgeçiliyor');
      return false;
    }

    if (response.status === 429) {
      console.log('Rate limit → bu deneme geçici başarısız');
      return false;
    }

    return false;

  } catch (err) {
    console.error(`Raw hata (deneme ${attemptNum}):`, err.message || err);
    return false;
  }
}

// Her davet için: 3 paralel raw deneme + 5 sn sonra tekrar 3 paralel (toplam 3 grup)
async function tryJoinInvite(inviteCode) {
  const MAX_GROUPS = 3;

  for (let group = 1; group <= MAX_GROUPS; group++) {
    console.log(`\n--- Grup \( {group}/ \){MAX_GROUPS} başlıyor (${inviteCode}) ---`);

    // Aynı anda 3 paralel raw deneme
    const promises = [
      singleRawJoinAttempt(inviteCode, `${group}-1`),
      singleRawJoinAttempt(inviteCode, `${group}-2`),
      singleRawJoinAttempt(inviteCode, `${group}-3`)
    ];

    const results = await Promise.allSettled(promises);

    // Herhangi biri başarılıysa erken çık
    const anySuccess = results.some(r => r.status === 'fulfilled' && r.value === true);
    if (anySuccess) {
      console.log(`Başarılı katılım tespit edildi → kalan gruplar iptal`);
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

  // Render keep-alive
  setInterval(() => {
    console.log(`[Keep-alive] ${new Date().toISOString()} - Sunucu sayısı: ${client.guilds.cache.size}`);
  }, 5 * 60 * 1000);
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
  console.error('Token veya Discord kısıtlaması olabilir.');
});