// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord Kullanım Koşulları'na (ToS) aykırıdır.
// Hesabınız kalıcı olarak banlanabilir.
// Bu kod sadece eğitim/deneme amaçlıdır. Tüm risk size aittir.

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fetch = require('node-fetch');   // npm install node-fetch@2

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

// Hataları yakala – Render'ın erken öldürmesini önlemek için
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error(err.stack);
  // process.exit(1) YAPMA – Render tekrar denesin
});

const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const TARGET_ROLE_MENTION = '<@&1425475242398187590>';

const PROTECTED_GUILD_IDS = ['1425143892633976844'];

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([^\s/]+?)(?=\b|$)/gi;

const client = new Client({ checkUpdate: false });

let lastDMReplyTime = 0;
const MIN_INTERVAL_DM_MS = 2 * 60 * 60 * 1000;          // 2 saat
const MIN_COOLDOWN_BETWEEN_REPLIES_MS = 30 * 60 * 1000; // 30 dk

async function copyMessageToLogChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) await logChannel.send(message.content);
  } catch (error) {
    console.error("Log gönderme hatası:", error.message);
  }
}

async function checkAndLeaveLeastMemberGuild() {
  const guilds = client.guilds.cache;
  if (guilds.size < 100) return;

  console.log(`Sunucu sayısı 100'e ulaştı → en az üyeli sunucudan çıkılıyor...`);

  const sorted = [...guilds.values()]
    .filter(g => !PROTECTED_GUILD_IDS.includes(g.id))
    .sort((a, b) => a.memberCount - b.memberCount);

  if (sorted.length === 0) {
    console.log('Çıkılacak sunucu kalmadı (hepsi korunuyor olabilir)');
    return;
  }

  const toLeave = sorted[0];
  console.log(`Çıkılıyor → \( {toLeave.name} ( \){toLeave.id}) | Üye: ${toLeave.memberCount}`);

  try {
    await toLeave.leave();
    console.log(`Başarıyla çıkıldı: ${toLeave.name}`);
  } catch (err) {
    console.error(`Çıkma hatası (${toLeave.name}):`, err.message);
  }
}

async function tryJoinInvite(inviteCode, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Deneme \( {attempt}/ \){maxAttempts}] Kod: ${inviteCode}`);

      const invite = await client.fetchInvite(inviteCode, { force: true }).catch(err => {
        console.log(`fetchInvite başarısız → ${err?.message || err || "bilinmeyen hata"}`);
        return null;
      });

      if (!invite) {
        console.log("→ Davet bulunamadı / geçersiz / süresi bitmiş");
        return false;
      }

      const guildName = invite.guild?.name || "isim alınamadı";
      const guildId = invite.guild?.id;

      console.log(`Davet sunucusu: \( {guildName} \){guildId ? ` (ID: ${guildId})` : " (guild bilgisi yok)"}`);

      if (!guildId) {
        console.log("→ Bu davet sunucu değil (grup DM?) → atlanıyor");
        return false;
      }

      const existing = await client.guilds.fetch(guildId).catch(() => null);
      if (existing) {
        console.log("Zaten sunucuda → başarılı sayılıyor");
        return true;
      }

      const response = await fetch(`https://discord.com/api/v9/invites/${inviteCode}`, {
        method: 'POST',
        headers: {
          'Authorization': TOKEN,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InRyLVRSIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTIwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiIiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjo5OTk5OTksInJlbGVhc2VfY2hhbm5lbCI6InN0YWJsZSIsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGx9'
        },
        body: JSON.stringify({})
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        console.error('JSON parse hatası:', jsonErr.message);
        data = { message: 'JSON parse edilemedi' };
      }

      if (response.ok || data?.guild?.id) {
        console.log(`Katılım başarılı → ${data?.guild?.name || guildName || inviteCode}`);

        setTimeout(async () => {
          await client.guilds.fetch(data?.guild?.id || guildId).catch(() => {});
          checkAndLeaveLeastMemberGuild();
        }, 6000);

        return true;
      }

      console.log("API cevabı:", data);

      if (data?.message?.toLowerCase().includes('captcha') || data?.code === 'CAPTCHA_REQUIRED') {
        console.log("CAPTCHA gerekiyor → otomatik katılım şu an imkansız");
        return false;
      }

      if (data?.message?.includes('Unknown Invite') || data?.code === 10006) {
        console.log("Davet geçersiz / silinmiş");
        return false;
      }

      if (response.status === 429) {
        const retryAfter = (data?.retry_after || 15) * 1000;
        console.log(`Rate limit → ${Math.round(retryAfter / 1000)} sn bekleniyor`);
        await new Promise(r => setTimeout(r, retryAfter));
        continue;
      }

      await new Promise(r => setTimeout(r, 12000 + Math.random() * 8000));

    } catch (err) {
      console.error(`Hata (deneme ${attempt}):`, err?.message || err || "bilinmeyen hata");
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log(`Davete katılamadı (${inviteCode})`);
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  const contentLower = message.content.toLowerCase();

  if (message.channel.type === 'DM' || message.channel.type === 'GROUP_DM') {
    const hasInvite = DISCORD_INVITE_REGEX.test(message.content);

    if (hasInvite) {
      const now = Date.now();
      if (now - lastDMReplyTime < MIN_INTERVAL_DM_MS) {
        console.log('2 saat sınırı → tanıtım atılmadı');
        return;
      }

      const matches = message.content.match(DISCORD_INVITE_REGEX) || [];
      let anyJoined = false;

      for (const url of matches) {
        const codeMatch = url.match(/\/([a-zA-Z0-9\-_]+?)(?=\b|$)/i);
        if (!codeMatch) continue;
        const code = codeMatch[1];

        const joined = await tryJoinInvite(code);
        if (joined) anyJoined = true;
      }

      if (anyJoined) {
        setTimeout(async () => {
          try {
            await message.reply(`# 🌿 ★ Vinland Saga ~Anime^Manga ☆ — huzur arayan savaşçının sığınağı

**Kılıçların gölgesinde değil, kalbinin huzurunda yaşamak istiyorsan…**  
Vinland seni bekliyor. ⚔️

Savaşın yorgunluğunu atmak, dostlukla yoğrulmuş bir topluluğun parçası olmak isteyen herkese kapımız açık.  
Thorfinn'in aradığı toprakları biz burada bulduk — sen de bize katıl.

Gif: https://tenor.com/view/askeladd-gif-19509516

---

✦ Neler var bizde?  
🛡️ Estetik & Viking temalı tasarım  
⚔️ Anime sohbetleri (özellikle Vinland Saga üzerine derin muhabbetler)  
🌄 Etkinlikler: anime/film geceleri, bilgi yarışmaları, oyunlar  
🗡️ Rol ve seviye sistemi (klanlar & savaşçılar seni bekliyor)  
🍃 Chill ses kanalları, aktif sohbetler  
🤝 Samimi, saygılı ve toksik olmayan bir topluluk

|| @everyone @here ||  
Pins: https://discord.gg/FzZBhH3tnF`);

            setTimeout(async () => {
              await message.reply('paylaştım, iyi günler.');
              await copyMessageToLogChannel(message);
            }, 2500);

            lastDMReplyTime = Date.now();

          } catch (e) {
            console.error("DM tanıtım hatası:", e.message);
          }
        }, 3000);
      }

      return;
    }

    // Davet yoksa hatırlatma
    const now = Date.now();
    const sinceLast = now - lastDMReplyTime;

    if (sinceLast >= MIN_INTERVAL_DM_MS && sinceLast >= MIN_COOLDOWN_BETWEEN_REPLIES_MS) {
      setTimeout(async () => {
        try {
          await message.reply('texti tekrar atar mısın önceki mesaj yüklenmedi de.');
          lastDMReplyTime = Date.now();
        } catch (e) {
          console.error("Hatırlatma hatası:", e.message);
        }
      }, 1200);
    }

    return;
  }

  // Bildirim kanalı
  if (message.channel.type === 'GUILD_TEXT' && message.channel.id === NOTIFICATION_CHANNEL_ID) {
    if (message.content.includes(TARGET_ROLE_MENTION)) {

      if (contentLower.includes('kendi')) return;

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
      if (member.roles.cache.has(roleId)) {
        console.log(`${message.author.tag} zaten hedef rolde → dm gel atılmadı`);
        return;
      }

      setTimeout(async () => {
        try {
          await message.reply('dm gel');
        } catch (e) {
          console.error("Reply hatası:", e.message);
        }
      }, 5000);
    }
  }
});

client.on('guildCreate', (guild) => {
  console.log(`Yeni sunucu: \( {guild.name} ( \){guild.id}) | Üye: ${guild.memberCount}`);
  setTimeout(checkAndLeaveLeastMemberGuild, 4000);
});

client.once('ready', () => {
  console.log(`✅ Selfbot aktif: ${client.user.tag} | Sunucu sayısı: ${client.guilds.cache.size}`);
  setTimeout(checkAndLeaveLeastMemberGuild, 10000);

  // Render exited early önlemek için periyodik log
  setInterval(() => {
    console.log(`[Keep-alive] ${new Date().toISOString()} - Sunucu sayısı: ${client.guilds.cache.size}`);
  }, 5 * 60 * 1000); // her 5 dakikada bir
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
  console.error('Token kontrol edin veya Discord kısıtlaması olabilir.');
  // process.exit(1) KALDIRILDI – Render tekrar denesin
});