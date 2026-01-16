// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord ToS'a aykırıdır → ban riski çok yüksek
// Bu kod sadece eğitim/deneme amaçlıdır. Tüm risk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

// Render sağlık kontrolü
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

// Hataları yakala – Render exited early / status 1 önleme
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error(err.stack);
});

const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const TARGET_ROLE_MENTION = '<@&1425475242398187590>';

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([^\s/]+?)(?=\b|$)/gi;

const client = new Client({ checkUpdate: false });

// Son tanıtım zamanı (DM spam önleme)
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

// Güncellenmiş davet katılma fonksiyonu
async function tryJoinInvite(inviteCode, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[\( {attempt}/ \){maxAttempts}] Deneme başlıyor → Kod: ${inviteCode}`);

      const invite = await client.fetchInvite(inviteCode).catch(err => {
        console.log(`fetchInvite hatası → ${err?.message || err}`);
        return null;
      });

      if (!invite) {
        console.log("→ Davet bulunamadı / geçersiz / süresi bitmiş");
        return false;
      }

      const guildName = invite.guild?.name || "isim alınamadı";
      const guildId = invite.guild?.id;

      console.log(`Davet sunucusu: ${guildName} ${guildId ? `(ID: ${guildId})` : "(guild yok)"}`);

      if (!guildId) {
        console.log("→ Grup DM veya guild bilgisi yok → atlanıyor");
        return false;
      }

      if (client.guilds.cache.has(guildId)) {
        console.log(`Zaten ${guildName} sunucusunda → atlanıyor`);
        return true;
      }

      // 1. Deneme: client.acceptInvite (eğer kütüphanede varsa)
      if (typeof client.acceptInvite === 'function') {
        console.log("client.acceptInvite deneniyor...");
        await client.acceptInvite(inviteCode);
        console.log(`client.acceptInvite ile katıldı → ${guildName}`);
        return true;
      }

      // 2. Deneme: invite.accept (eski yöntem – çoğu sürümde yok)
      if (typeof invite.accept === 'function') {
        console.log("invite.accept deneniyor...");
        await invite.accept();
        console.log(`invite.accept ile katıldı → ${guildName}`);
        return true;
      }

      console.log("Hiçbir accept metodu bulunamadı → raw API deneniyor...");

      // 3. Raw API POST (en yaygın alternatif)
      const response = await fetch(`https://discord.com/api/v9/invites/${inviteCode}`, {
        method: 'POST',
        headers: {
          'Authorization': TOKEN,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({})
      });

      let data;
      try {
        data = await response.json();
      } catch {
        data = { message: 'JSON parse edilemedi' };
      }

      if (response.ok || data?.guild?.id) {
        console.log(`RAW API ile katıldı → ${data?.guild?.name || guildName || inviteCode}`);
        return true;
      }

      console.log("API cevabı:", data);

      if (data?.message?.toLowerCase().includes('captcha')) {
        console.log("CAPTCHA gerekiyor → otomatik katılım imkansız");
        return false;
      }

      if (data?.message?.includes('Unknown Invite') || data?.code === 10006) {
        console.log("Davet geçersiz / silinmiş");
        return false;
      }

      if (response.status === 429) {
        const retry = (data?.retry_after || 15) * 1000;
        console.log(`Rate limit → ${Math.round(retry/1000)} sn bekleniyor`);
        await new Promise(r => setTimeout(r, retry));
        continue;
      }

      await new Promise(r => setTimeout(r, 12000 + Math.random() * 8000));

    } catch (err) {
      console.error(`Hata (deneme ${attempt}):`, err?.message || err);
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log(`Tüm denemeler başarısız → ${inviteCode}`);
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

  // Render keep-alive log
  setInterval(() => {
    console.log(`[Keep-alive] ${new Date().toISOString()} - Sunucu sayısı: ${client.guilds.cache.size}`);
  }, 5 * 60 * 1000); // 5 dakikada bir
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
  console.error('Token kontrol edin veya Discord kısıtlaması olabilir.');
  // process.exit(1) KALDIRILDI
});