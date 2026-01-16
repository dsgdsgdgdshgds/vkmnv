// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord ToS'a aykırıdır. Hesabınız banlanabilir.
// Bu kod sadece eğitim/deneme amaçlıdır. Tüm risk size aittir.

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
  console.error('HATA: DISCORD_TOKEN_SELF environment variable eksik!');
  process.exit(1);
}

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
    if (logChannel) {
      await logChannel.send(`{message.content}`);
    }
  } catch (error) {
    console.error("Log gönderme hatası:", error.message);
  }
}

// ────────────────────────────────────────────────
//  Davet linkine katılma fonksiyonu (tekrar denemeli)
// ────────────────────────────────────────────────
async function tryJoinInvite(inviteCode, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const invite = await client.fetchInvite(inviteCode);
      console.log(`[\( {attempt}/ \){maxAttempts}] Davet bulundu: \( {invite.guild.name} ( \){inviteCode})`);

      // Zaten sunucuda mıyız?
      if (client.guilds.cache.has(invite.guild.id)) {
        console.log(`Zaten ${invite.guild.name} sunucusunda bulunuyorum.`);
        return true;
      }

      await invite.accept(); // discord.js-selfbot-v13'te davet kabul metodu
      console.log(`Başarıyla katıldı: ${invite.guild.name}`);
      return true;

    } catch (err) {
      console.error(`Katılma hatası (deneme ${attempt}):`, err.message);

      if (err.message.includes('Unknown Invite') || err.code === 10006) {
        console.log('Davet geçersiz/kullanılmış → vazgeçiliyor.');
        return false;
      }

      if (attempt === maxAttempts) {
        console.log('Maksimum deneme sayısına ulaşıldı, vazgeçiliyor.');
        return false;
      }

      // Rate-limit veya geçici hata → bekle
      const waitTime = 5000 + Math.random() * 10000; // 5-15 saniye arası
      console.log(`Tekrar denemek için ${Math.round(waitTime/1000)} saniye bekleniyor...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  const content = message.content.toLowerCase();

  // ── DM veya Grup DM ──
  if (message.channel.type === 'DM' || message.channel.type === 'GROUP_DM') {

    // "yenileme" → klasik cevap
    if (content.includes('yenileme')) {
      setTimeout(async () => {
        try {
          await message.reply('texti tekrar atar mısın önceki mesaj yüklenmedide.');
        } catch {}
      }, 1000);
    }

    // ── Davet linki tespit edildi ──
    const inviteMatches = message.content.match(DISCORD_INVITE_REGEX);
    if (inviteMatches) {
      const now = Date.now();
      if (now - lastInviteReplyTime < MIN_INTERVAL_MS) {
        console.log('2 saat sınırı aktif, tanıtım atılmadı.');
        return;
      }

      // Her davet kodunu sırayla dene (genelde tek olur ama)
      for (const inviteUrl of inviteMatches) {
        const codeMatch = inviteUrl.match(/discord\.gg\/([^\s/]+)/i) || 
                         inviteUrl.match(/\/([a-zA-Z0-9\-_]+)/);
        const inviteCode = codeMatch ? codeMatch[1] : null;

        if (!inviteCode) continue;

        console.log(`Davet kodu tespit edildi: ${inviteCode}`);

        // Katılmayı dene
        const joined = await tryJoinInvite(inviteCode);

        // Katılma başarılıysa tanıtım at
        if (joined) {
          setTimeout(async () => {
            try {
              await message.reply(`# 🌿 ★ Vinland Saga ~Anime^Manga ☆ — huzur arayan savaşçının sığınağı

**Kılıçların gölgesinde değil, kalbinin huzurunda yaşamak istiyorsan…
Vinland seni bekliyor. ⚔️ ... (devamı aynı)**

|| @everyone @here ||
Pins:https://discord.gg/FzZBhH3tnF`);

              setTimeout(async () => {
                await message.reply('paylaştım, iyi günler.');
                await copyMessageToLogChannel(message);
              }, 2500);

              lastInviteReplyTime = Date.now();

            } catch (e) {
              console.error("Tanıtım DM hatası:", e.message);
            }
          }, 3000);
        }
      }
    }
  }

  // ── Bildirim kanalındaki mention'lar ──
  else if (message.channel.type === 'GUILD_TEXT') {
    if (message.channel.id === NOTIFICATION_CHANNEL_ID) {
      if (message.content.includes(TARGET_ROLE_MENTION)) {
        if (content.includes('kendi')) return;

        setTimeout(async () => {
          try {
            await message.reply('dm gel');
          } catch {}
        }, 8000);
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