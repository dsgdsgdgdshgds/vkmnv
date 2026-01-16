// !!! ÖNEMLİ UYARI !!!
// Selfbot kullanımı Discord Kullanım Koşulları'na (ToS) aykırıdır.
// Hesabınız kalıcı olarak banlanabilir.
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

// Korunacak sunucular (buraya ID yazarsan onlardan çıkmaz)
const PROTECTED_GUILD_IDS = [
  '1425143892633976844'
];

const DISCORD_INVITE_REGEX = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/([^\s/]+?)(?=\b|$)/gi;

const client = new Client({ checkUpdate: false });

let lastDMReplyTime = 0;
const MIN_INTERVAL_DM_MS = 2 * 60 * 60 * 1000;          // 2 saat
const MIN_COOLDOWN_BETWEEN_REPLIES_MS = 30 * 60 * 1000; // 30 dakika

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

async function tryJoinInvite(inviteCode, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const invite = await client.fetchInvite(inviteCode);
      console.log(`[\( {attempt}/ \){maxAttempts}] Davet: \( {invite.guild?.name || 'bilinmeyen'} ( \){inviteCode})`);

      if (client.guilds.cache.has(invite.guild?.id)) {
        console.log(`Zaten içeride → atlanıyor`);
        return true;
      }

      await invite.accept();
      console.log(`Katıldı: ${invite.guild?.name || 'bilinmeyen'}`);

      // Katıldıktan sonra 100 kontrolü
      setTimeout(checkAndLeaveLeastMemberGuild, 6000);

      return true;

    } catch (err) {
      console.error(`Katılma hatası (deneme ${attempt}):`, err.message || err);

      if (err.message?.includes('Unknown Invite') || err.code === 10006) {
        return false;
      }

      if (attempt === maxAttempts) return false;

      const wait = 5000 + Math.random() * 10000;
      console.log(`Tekrar deneme için ~${Math.round(wait/1000)} sn bekleniyor`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  const contentLower = message.content.toLowerCase();

  // ── DM veya Grup DM ───────────────────────────────────────────────
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

    // Davet yoksa → hatırlatma (2 saat + 30 dk cooldown)
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

  // ── Bildirim kanalı ───────────────────────────────────────────────
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

// Yeni sunucuya katılınca kontrol
client.on('guildCreate', (guild) => {
  console.log(`Yeni sunucu: \( {guild.name} ( \){guild.id}) | Üye: ${guild.memberCount}`);
  setTimeout(checkAndLeaveLeastMemberGuild, 4000);
});

client.once('ready', () => {
  console.log(`✅ Selfbot aktif: ${client.user.tag} | Sunucu sayısı: ${client.guilds.cache.size}`);
  // Başlangıç kontrolü
  setTimeout(checkAndLeaveLeastMemberGuild, 10000);
});

client.login(TOKEN).catch(err => {
  console.error('Giriş başarısız:', err.message);
  process.exit(1);
});