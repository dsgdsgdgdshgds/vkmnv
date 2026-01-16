async function tryJoinInvite(inviteCode, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Deneme \( {attempt}/ \){maxAttempts}] Kod: ${inviteCode}`);

      const invite = await client.fetchInvite(inviteCode, { force: true }).catch(err => {
        console.log(`fetchInvite başarısız → ${err?.message || err || "bilinmeyen hata"}`);
        return null;
      });

      // invite null ise erken çıkış
      if (!invite) {
        console.log("→ Davet bulunamadı / geçersiz / süresi bitmiş / grup DM olabilir");
        return false;
      }

      // invite.guild null olabilir (örneğin group invite ise)
      const guildName = invite.guild?.name || "isim alınamadı";
      const guildId = invite.guild?.id;

      console.log(`Davet sunucusu: ${guildName} ${guildId ? `(ID: ${guildId})` : "(guild bilgisi yok)"}`);

      // guild yoksa (group DM vs.) katılma denemesi mantıksız → çık
      if (!guildId) {
        console.log("→ Bu davet sunucu değil (muhtemelen grup DM) → katılma atlanıyor");
        return false;
      }

      // Zaten içerde mi?
      const existing = await client.guilds.fetch(guildId).catch(() => null);
      if (existing) {
        console.log("Zaten sunucuda → başarılı kabul ediliyor");
        return true;
      }

      // Raw API ile katılma denemesi
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
        console.log("JSON parse hatası:", jsonErr.message);
        data = { message: "JSON parse edilemedi" };
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

      // Diğer durumlar için bekleme
      await new Promise(r => setTimeout(r, 12000 + Math.random() * 8000));

    } catch (err) {
      console.error(`Genel hata (deneme ${attempt}):`, err?.message || err || "bilinmeyen hata");
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log(`Davete katılamadı (${inviteCode})`);
  return false;
}async function tryJoinInvite(inviteCode, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Deneme \( {attempt}/ \){maxAttempts}] Kod: ${inviteCode}`);

      const invite = await client.fetchInvite(inviteCode, { force: true }).catch(err => {
        console.log(`fetchInvite başarısız → ${err?.message || err || "bilinmeyen hata"}`);
        return null;
      });

      // invite null ise erken çıkış
      if (!invite) {
        console.log("→ Davet bulunamadı / geçersiz / süresi bitmiş / grup DM olabilir");
        return false;
      }

      // invite.guild null olabilir (örneğin group invite ise)
      const guildName = invite.guild?.name || "isim alınamadı";
      const guildId = invite.guild?.id;

      console.log(`Davet sunucusu: ${guildName} ${guildId ? `(ID: ${guildId})` : "(guild bilgisi yok)"}`);

      // guild yoksa (group DM vs.) katılma denemesi mantıksız → çık
      if (!guildId) {
        console.log("→ Bu davet sunucu değil (muhtemelen grup DM) → katılma atlanıyor");
        return false;
      }

      // Zaten içerde mi?
      const existing = await client.guilds.fetch(guildId).catch(() => null);
      if (existing) {
        console.log("Zaten sunucuda → başarılı kabul ediliyor");
        return true;
      }

      // Raw API ile katılma denemesi
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
        console.log("JSON parse hatası:", jsonErr.message);
        data = { message: "JSON parse edilemedi" };
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

      // Diğer durumlar için bekleme
      await new Promise(r => setTimeout(r, 12000 + Math.random() * 8000));

    } catch (err) {
      console.error(`Genel hata (deneme ${attempt}):`, err?.message || err || "bilinmeyen hata");
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log(`Davete katılamadı (${inviteCode})`);
  return false;
}