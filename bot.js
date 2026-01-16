// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord ToS'a aykırıdır → ban riski çok yüksek
// Bu kod sadece eğitim/deneme amaçlıdır. Tüm risk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const Solver = require('@2captcha/captcha-solver'); // npm install @2captcha/captcha-solver

const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.status(200).send('Selfbot çalışıyor (Render keep-alive)');
});

app.listen(port, () => {
  console.log(`HTTP sunucu ${port} portunda aktif — Render için zorunlu`);
});

const TOKEN = process.env.DISCORD_TOKEN_SELF;
const CAPTCHA_KEY = process.env.CAPTCHA_2CAPTCHA_KEY; // Render Environment'ta ekle: CAPTCHA_2CAPTCHA_KEY = 'your_2captcha_api_key'

if (!TOKEN) {
  console.error('HATA: DISCORD_TOKEN_SELF environment variable eksik!');
  process.exit(1);
}

if (!CAPTCHA_KEY) {
  console.error('HATA: CAPTCHA_2CAPTCHA_KEY environment variable eksik! (2captcha.com'dan al)');
  process.exit(1);
}

// 2Captcha solver'ı başlat
const solver = new Solver(CAPTCHA_KEY);

const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const TARGET_ROLE_MENTION = '<@&1425475242398187590>';

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([^\s/]+?)(?=\b|$)/gi;

const client = new Client({ 
  checkUpdate: false,
  captchaSolver: async (captcha, UA) => {
    try {
      console.log('CAPTCHA tespit edildi → çözülüyor...');
      const result = await solver.hcaptcha(captcha.captcha_sitekey, 'discord.com', {
        userAgent: UA,
        data: captcha.captcha_rqdata,
        invisible: 1
      });
      console.log('CAPTCHA çözüldü:', result);
      return result;
    } catch (err) {
      console.error('CAPTCHA çözme hatası:', err);
      return null;
    }
  }
});

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

// Davet linkine katılma (tekrar denemeli + captcha destekli)
async function tryJoinInvite(inviteCode, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const invite = await client.fetchInvite(inviteCode);
      console.log(`[\( {attempt}/ \){maxAttempts}] Davet bulundu: \( {invite.guild?.name || 'Bilinmeyen sunucu'} ( \){inviteCode})`);

      if (client.guilds.cache.has(invite.guild.id)) {
        console.log(`Zaten ${invite.guild.name} sunucusunda → katılma atlanıyor`);
        return true;
      }

      await client.acceptInvite(inviteCode);  // client.acceptInvite ile katıl (captcha solver otomatik tetiklenir)
      console.log(`Başarıyla katıldı: ${invite.guild.name}`);
      return true;

    } catch (err) {
      console.error(`Katılma hatası (deneme ${attempt}):`, err.message || err);

      if (err.message?.includes('Unknown Invite') || err.code === 10006) {
        console.log('Davet geçersiz veya kullanılmış → vazgeçiliyor');
        return false;
      }

      if (attempt === maxAttempts) {
        console.log('Maksimum deneme sayısına ulaşıldı');
        return false;
      }

      const waitTime = 5000 + Math.random() * 10000; // 5-15 sn
      console.log(`Tekrar denemek için ${Math.round(waitTime/1000)} saniye bekleniyor...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  const content = message.content.toLowerCase();

  // 1. DM veya Grup DM
  if (message.channel.type === 'DM' || message.channel.type === 'GROUP_DM') {

    // "yenileme" → klasik cevap
    if (content.includes('yenileme')) {
      setTimeout(async () => {
        try {
          await message.reply('texti tekrar atar mısın önceki mesaj yüklenmedide.');
        } catch {}
      }, 1000);
      return;
    }

    // Davet linki → katıl + tanıtım (2 saatte 1)
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

        // Başarılı katıldıysa tanıtım metni at
        if (joined) {
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
                } catch {}
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

  // 2. Sunucu mesajları → bildirim kanalı
  else if (message.channel.type === 'GUILD_TEXT') {
    if (message.channel.id === NOTIFICATION_CHANNEL_ID) {
      if (message.content.includes(TARGET_ROLE_MENTION)) {

        if (content.includes('kendi')) {
          return; // "kendi" varsa sessiz geç
        }

        // ─── Hedef role sahip mi kontrolü ───
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

        // Rolü yoksa → 3 sn sonra dm gel
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
  process.exit(1);
});