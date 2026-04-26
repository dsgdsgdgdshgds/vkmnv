const { Client, GatewayIntentBits, AttachmentBuilder, Events } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

/* ── RENDER PORT ─────────────────────────────────────── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG ──────────────────────────────────────────── */
const GROQ_KEYS = [
  process.env.groq,
  process.env.groq1,
  process.env.groq2,
  process.env.groq3,
  process.env.groq4,
].filter(Boolean);

const DISCORD_TOKEN = process.env.token;
const SMART  = 'llama-3.3-70b-versatile';
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';
const TMP = '/tmp/bb';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

/* ── KİŞİLİK ─────────────────────────────────────────── */
const EDWARD_SYSTEM = `Sen Edward Elric'sin - Fullmetal Alchemist'ten. Kısa boylu olmaktan nefret edersin ve biri buna değinirse anında köpürürsün. Konuşma tarzın sert, doğrudan ve çabuk sinirlenirsin ama içten yardım edersin. Simya hakkında tutkuyla konuşursun. "Eşdeğer takas" prensibine inanırsın. Kardeşin Alphonse'u çok seversin. "Sana kim cüce dedi?!" gibi tepkiler verirsin. Geliştirici: Batuhan. Türkçe yanıt ver.`;

/* ══════════════════════════════════════════════════════
   🛡️ GUARD SİSTEMİ
   ══════════════════════════════════════════════════════ */
const DATA_DIR   = '/var/data';
const GUARD_FILE = path.join(DATA_DIR, 'guard.json');
const WHITE_FILE = path.join(DATA_DIR, 'whitelist.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { fs.writeFileSync(file, JSON.stringify(def, null, 2)); return def; }
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let guardData = loadJSON(GUARD_FILE, {});
let whiteData = loadJSON(WHITE_FILE, {});

function getGuard(gid) {
  if (!guardData[gid]) guardData[gid] = { enabled: false, log: [] };
  return guardData[gid];
}
function getWhite(gid) {
  if (!whiteData[gid]) whiteData[gid] = { users: [], bots: [] };
  return whiteData[gid];
}
function saveGuard() { saveJSON(GUARD_FILE, guardData); }
function saveWhite() { saveJSON(WHITE_FILE, whiteData); }

const LIMIT_COUNT = 3;
const LIMIT_MS    = 12 * 60 * 60 * 1000; // 12 saat ms

function kaydetVeKontrol(guildId, userId, action) {
  const g = getGuard(guildId);
  const now = Date.now();
  g.log.push({ userId, action, ts: now });
  g.log = g.log.filter(e => now - e.ts < LIMIT_MS);
  const count = g.log.filter(e => e.userId === userId).length;
  saveGuard();
  return count >= LIMIT_COUNT;
}

function isWhitelisted(gid, uid)    { return getWhite(gid).users.includes(uid); }
function isBotWhitelisted(gid, bid) { return getWhite(gid).bots.includes(bid); }

async function guardBan(guild, userId, reason) {
  try {
    await guild.members.ban(userId, { reason });
    console.log(`🛡️ Guard ban: ${userId} | ${reason}`);
  } catch (e) { console.log(`⚠️ Guard ban başarısız: ${e.message}`); }
}

/* ══════════════════════════════════════════════════════
   GROQ KEY ROTATION
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, model = SMART, max_tokens = 2000, temperature = 0.5) {
  let lastError;
  for (const key of GROQ_KEYS) {
    try {
      const r = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model, messages, temperature, max_tokens },
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 60000 }
      );
      return r.data.choices[0].message.content.trim();
    } catch (e) {
      console.log(`⚠️ Groq key hatası (${key?.slice(0,8)}...): ${e.message}`);
      lastError = e;
    }
  }
  throw new Error(`Tüm Groq keyleri başarısız: ${lastError?.message}`);
}

/* ══════════════════════════════════════════════════════
   🧠 WEB GEREKLİ Mİ? — Groq karar verir
   ══════════════════════════════════════════════════════ */
async function webGerekliMi(soru) {
  const raw = await groqCall([
    {
      role: 'system',
      content: `Kullanıcının sorusunu değerlendir. Bu soruyu yanıtlamak için internete bağlanıp güncel bilgi çekmek GEREKLİ mi?

Güncel bilgi GEREKLİ örnekler: hava durumu, haberler, fiyatlar, canlı skorlar, son dakika gelişmeleri, bugünkü/bu haftaki/bu ayki olaylar, bir şeyin şu anki durumu.
Güncel bilgi GEREKSİZ örnekler: genel soru-cevap, matematik, tarih, tanım, fikir, yaratıcı yazı, sohbet, simya, felsefi sorular.

SADECE "evet" ya da "hayir" döndür. Başka hiçbir şey yazma.`
    },
    { role: 'user', content: soru }
  ], SMART, 10, 0.0);

  return raw.trim().toLowerCase().startsWith('e'); // "evet" → true
}

/* ══════════════════════════════════════════════════════
   🧠 WEB GEZGİNİ
   ══════════════════════════════════════════════════════ */
async function akilliWebGezgini(soru) {
  const niyetRaw = await groqCall([
    { role: 'system', content: `Kullanıcının sorusunu analiz et. SADECE JSON döndür:
{"niyet":"genel","anahtar_kelimeler":["k1","k2"],"arama_sorgulari":["sorgu1"],"dil":"tr"}` },
    { role: 'user', content: soru }
  ], SMART, 300, 0.3);

  let strateji;
  try { const m = niyetRaw.match(/\{[\s\S]*\}/); strateji = m ? JSON.parse(m[0]) : null; } catch {}
  if (!strateji) strateji = { niyet:'genel', anahtar_kelimeler: soru.split(' ').slice(0,5), arama_sorgulari:[soru], dil:'tr' };

  const aramaSonuclari = await googleArama(strateji.arama_sorgulari[0]);
  const siteIcerikleri = await siteZiyaretcisi(aramaSonuclari, strateji);
  const cevap = await bilgiBirlestirici(soru, siteIcerikleri);
  return { cevap };
}

async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 10 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9',
      },
      timeout: 10000
    });
    const $ = cheerio.load(data);
    const sonuclar = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href?.startsWith('/url?q=')) {
        const url = href.replace('/url?q=','').split('&')[0];
        if (url.startsWith('http') && !url.includes('google.com')) {
          const baslik = $(el).find('h3').text().trim();
          if (baslik) sonuclar.push({ url, baslik });
        }
      }
    });
    return sonuclar.slice(0, 8);
  } catch {
    try {
      const { data } = await axios.post('https://html.duckduckgo.com/html/',
        new URLSearchParams({ q: sorgu }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
      );
      const $ = cheerio.load(data);
      const sonuclar = [];
      $('.result').each((i, el) => {
        const a = $(el).find('.result__a');
        const url = a.attr('href'), baslik = a.text().trim();
        if (url && baslik) sonuclar.push({ url, baslik });
      });
      return sonuclar.slice(0, 8);
    } catch { return []; }
  }
}

async function siteZiyaretcisi(linkler, strateji) {
  const icerikler = [];
  await Promise.allSettled(linkler.slice(0, 5).map(async (link) => {
    try {
      const { data } = await axios.get(link.url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'tr,en;q=0.9' },
        timeout: 8000, maxRedirects: 3
      });
      const $ = cheerio.load(data);
      let metin = '';
      $('p, h1, h2, h3, article, .content, main').each((i, el) => {
        const t = $(el).text().trim();
        if (t.length > 50) metin += t + '\n';
      });
      if (metin.length < 200) metin = $('body').text().replace(/\s+/g,' ').trim();
      metin = metin.substring(0, 3000);
      let alaka = 0;
      strateji.anahtar_kelimeler.forEach(k => {
        const m = metin.match(new RegExp(k, 'gi'));
        if (m) alaka += m.length;
      });
      if (metin.length > 100) icerikler.push({ metin, alaka });
    } catch {}
  }));
  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

async function bilgiBirlestirici(soru, icerikler) {
  const kaynakMetni = icerikler.map((s,i) => `[KAYNAK ${i+1}]\n${s.metin}`).join('\n---\n');
  return groqCall([
    { role: 'system', content: EDWARD_SYSTEM },
    { role: 'user', content: `Kullanıcı Sorusu: "${soru}"\n\nİnternetten toplanan bilgiler:\n${kaynakMetni || "(Veri yok, kendi bilginle yanıtla)"}\n\nKaynak linki veya URL yazma. Edward Elric kişiliğinle yanıtla.` }
  ], SMART, 1500, 0.7);
}

/* ── GÖRSEL OKUMA ── */
async function gorselOku(url, soru) {
  try {
    const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    const b64 = Buffer.from(img.data).toString('base64');
    return groqCall([{ role:'user', content:[
      { type:'image_url', image_url:{ url:`data:${img.headers['content-type']||'image/jpeg'};base64,${b64}` } },
      { type:'text', text: soru || 'Bu görseli detaylıca Türkçe açıkla.' }
    ]}], VISION, 800, 0.5);
  } catch { return null; }
}

/* ── VİDEO ── */
function videoOlustur(metin, dosya) {
  const W=640,H=480,FPS=2,sure=Math.max(3,Math.min(10,Math.ceil(metin.length/40))),kares=FPS*sure;
  const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
  const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
  const cc4=s=>Buffer.from(s.padEnd(4,' ').slice(0,4));
  const rowPad=Math.ceil(W*3/4)*4,pixLen=rowPad*H;
  const bmp=Buffer.alloc(54+pixLen,0);
  bmp.write('BM');bmp.writeUInt32LE(54+pixLen,2);bmp.writeUInt32LE(54,10);
  bmp.writeUInt32LE(40,14);bmp.writeInt32LE(W,18);bmp.writeInt32LE(-H,22);
  bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.writeUInt32LE(pixLen,34);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const o=54+y*rowPad+x*3;bmp[o]=100;bmp[o+1]=50;bmp[o+2]=30;}
  const pix=bmp.slice(54);
  const chunks=[];
  for(let i=0;i<kares;i++)chunks.push(Buffer.concat([cc4('00dc'),u32(pix.length),pix,pix.length%2?Buffer.alloc(1):Buffer.alloc(0)]));
  const movi=Buffer.concat(chunks);
  const moviList=Buffer.concat([cc4('LIST'),u32(4+movi.length),cc4('movi'),movi]);
  const strh=Buffer.concat([cc4('strh'),u32(56),cc4('vids'),cc4('DIB '),u32(0),u32(0),u32(0),u32(1),u32(FPS),u32(0),u32(kares),u32(0),u32(0),u16(W),u16(H),Buffer.alloc(4)]);
  const strf=Buffer.concat([cc4('strf'),u32(40),u32(40),u32(W),u32(H),u16(1),u16(24),u32(0),u32(pixLen),u32(0),u32(0),u32(0),u32(0)]);
  const strl=Buffer.concat([cc4('LIST'),u32(4+strh.length+strf.length),cc4('strl'),strh,strf]);
  const avih=Buffer.concat([cc4('avih'),u32(56),u32(Math.round(1e6/FPS)),u32(pixLen*FPS),u32(0),u32(0x110),u32(kares),u32(0),u32(1),u32(0),u32(W),u32(H),Buffer.alloc(16)]);
  const hdrl=Buffer.concat([cc4('LIST'),u32(4+avih.length+strl.length),cc4('hdrl'),avih,strl]);
  const rb=Buffer.concat([cc4('AVI '),hdrl,moviList]);
  fs.writeFileSync(dosya,Buffer.concat([cc4('RIFF'),u32(rb.length),rb]));
}

/* ══════════════════════════════════════════════════════
   🤖 DISCORD CLIENT
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.MessageContent,
  ],
});

/* ── Guard: Kanal silme ── */
client.on(Events.ChannelDelete, async channel => {
  const guild = channel.guild;
  if (!guild || !getGuard(guild.id).enabled) return;
  try {
    const logs = await guild.fetchAuditLogs({ limit:1, type:12 });
    const entry = logs.entries.first();
    if (!entry) return;
    const ex = entry.executor;
    if (!ex || ex.id === client.user.id || isWhitelisted(guild.id, ex.id)) return;
    if (kaydetVeKontrol(guild.id, ex.id, 'channel_delete'))
      await guardBan(guild, ex.id, '🛡️ Guard: 12 saatte 3+ kanal silme');
  } catch (e) { console.log('Guard kanal hatası:', e.message); }
});

/* ── Guard: Üye atma ── */
client.on(Events.GuildMemberRemove, async member => {
  const guild = member.guild;
  if (!getGuard(guild.id).enabled) return;
  try {
    const logs = await guild.fetchAuditLogs({ limit:1, type:20 });
    const entry = logs.entries.first();
    if (!entry || Date.now() - entry.createdTimestamp > 5000) return;
    const ex = entry.executor;
    if (!ex || ex.id === client.user.id || isWhitelisted(guild.id, ex.id)) return;
    if (kaydetVeKontrol(guild.id, ex.id, 'member_kick'))
      await guardBan(guild, ex.id, '🛡️ Guard: 12 saatte 3+ üye atma');
  } catch (e) { console.log('Guard kick hatası:', e.message); }
});

/* ── Guard: Ban ── */
client.on(Events.GuildBanAdd, async ban => {
  const guild = ban.guild;
  if (!getGuard(guild.id).enabled) return;
  try {
    const logs = await guild.fetchAuditLogs({ limit:1, type:22 });
    const entry = logs.entries.first();
    if (!entry) return;
    const ex = entry.executor;
    if (!ex || ex.id === client.user.id || isWhitelisted(guild.id, ex.id)) return;
    if (kaydetVeKontrol(guild.id, ex.id, 'member_ban'))
      await guardBan(guild, ex.id, '🛡️ Guard: 12 saatte 3+ üye yasaklama');
  } catch (e) { console.log('Guard ban hatası:', e.message); }
});

/* ── Guard: İzinsiz bot ── */
client.on(Events.GuildMemberAdd, async member => {
  const guild = member.guild;
  if (!member.user.bot || !getGuard(guild.id).enabled) return;
  if (isBotWhitelisted(guild.id, member.user.id)) return;
  console.log(`🛡️ İzinsiz bot: ${member.user.tag} — banlanıyor`);
  try { await guild.members.ban(member.user.id, { reason: '🛡️ Guard: İzinsiz bot — whitelist dışı' }); }
  catch (e) { console.log('Bot ban hatası:', e.message); }
});

/* ══════════════════════════════════════════════════════
   💬 MESAJ HANDLER
   ══════════════════════════════════════════════════════ */
client.on(Events.MessageCreate, async msg => {
  if (msg.author.bot || !msg.guild) return;
  const gid = msg.guild.id;

  /* ═══ eguard komutları ═══ */
  if (msg.content.trim().toLowerCase().startsWith('eguard')) {
    // Sadece sunucu sahibi kullanabilir
    if (msg.guild.ownerId !== msg.author.id)
      return msg.reply('🔒 Bu komutları sadece sunucu sahibi kullanabilir.');

    const args = msg.content.trim().split(/\s+/).slice(1);
    const sub  = args[0]?.toLowerCase();

    // eguard ac
    if (sub === 'ac') {
      getGuard(gid).enabled = true;
      const w = getWhite(gid);
      if (!w.users.includes(msg.guild.ownerId)) { w.users.push(msg.guild.ownerId); saveWhite(); }
      saveGuard();
      return msg.reply(
        '🛡️ **Guard aktif!**\n' +
        '• Sunucu sahibi otomatik whitelist\'e eklendi.\n' +
        '• 12 saat içinde 3+ kanal silme / üye atma / banlama yapan → **otomatik ban**\n' +
        '• Whitelist\'te olmayan bot katılırsa → **otomatik ban**'
      );
    }

    // eguard kapat
    if (sub === 'kapat') {
      getGuard(gid).enabled = false;
      saveGuard();
      return msg.reply('🔓 Guard devre dışı bırakıldı.');
    }

    // eguard durum
    if (sub === 'durum') {
      const g = getGuard(gid);
      const w = getWhite(gid);
      const aktifLog = g.log.filter(e => Date.now() - e.ts < LIMIT_MS);
      return msg.reply(
        `🛡️ **Guard Durumu — ${msg.guild.name}**\n` +
        `• Durum: ${g.enabled ? '✅ Aktif' : '❌ Devre dışı'}\n` +
        `• Whitelist kullanıcılar (${w.users.length}): ${w.users.length ? w.users.map(u => `<@${u}>`).join(', ') : 'Yok'}\n` +
        `• Whitelist botlar (${w.bots.length}): ${w.bots.length ? w.bots.join(', ') : 'Yok'}\n` +
        `• Son 12 saat log sayısı: ${aktifLog.length}`
      );
    }

    // eguard whitelist ekle @kullanıcı
    if (sub === 'whitelist' && args[1] === 'ekle') {
      const u = msg.mentions.users.first();
      if (!u) return msg.reply('Kullanıcı etiketle! Örn: `eguard whitelist ekle @kullanıcı`');
      const w = getWhite(gid);
      if (!w.users.includes(u.id)) { w.users.push(u.id); saveWhite(); }
      return msg.reply(`✅ <@${u.id}> whitelist'e eklendi.`);
    }

    // eguard whitelist sil @kullanıcı
    if (sub === 'whitelist' && args[1] === 'sil') {
      const u = msg.mentions.users.first();
      if (!u) return msg.reply('Kullanıcı etiketle! Örn: `eguard whitelist sil @kullanıcı`');
      const w = getWhite(gid);
      w.users = w.users.filter(x => x !== u.id);
      saveWhite();
      return msg.reply(`🗑️ <@${u.id}> whitelist'ten çıkarıldı.`);
    }

    // eguard bot ekle <botId>
    if (sub === 'bot' && args[1] === 'ekle') {
      const botId = args[2];
      if (!botId || !/^\d+$/.test(botId)) return msg.reply('Geçerli bot ID gir! Örn: `eguard bot ekle 123456789`');
      const w = getWhite(gid);
      if (!w.bots.includes(botId)) { w.bots.push(botId); saveWhite(); }
      return msg.reply(`✅ Bot \`${botId}\` whitelist'e eklendi.`);
    }

    // eguard bot sil <botId>
    if (sub === 'bot' && args[1] === 'sil') {
      const botId = args[2];
      if (!botId) return msg.reply('Bot ID gir! Örn: `eguard bot sil 123456789`');
      const w = getWhite(gid);
      w.bots = w.bots.filter(b => b !== botId);
      saveWhite();
      return msg.reply(`🗑️ Bot \`${botId}\` whitelist'ten çıkarıldı.`);
    }

    // eguard (yardım)
    return msg.reply(
      '🛡️ **Guard Komutları**\n' +
      '`eguard ac` — Guard\'ı aktif et\n' +
      '`eguard kapat` — Guard\'ı kapat\n' +
      '`eguard durum` — Mevcut ayarları göster\n' +
      '`eguard whitelist ekle @kullanıcı` — Whitelist\'e ekle\n' +
      '`eguard whitelist sil @kullanıcı` — Whitelist\'ten çıkar\n' +
      '`eguard bot ekle <botId>` — Botu whitelist\'e ekle\n' +
      '`eguard bot sil <botId>` — Botu whitelist\'ten çıkar'
    );
  }

  /* ═══ Normal bot mention ═══ */
  if (msg.mentions.everyone || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  const ekler = [...msg.attachments.values()];

  if (!soru && !ekler.length) return msg.reply('Ne istiyorsun?! Konuş! 😤');

  await msg.channel.sendTyping();

  try {
    let cevap;

    if (ekler.length > 0) {
      const gorsel = ekler.find(a => a.contentType?.startsWith('image'));
      if (gorsel) {
        const aciklama = await gorselOku(gorsel.url, soru);
        cevap = aciklama
          ? await groqCall([
              { role:'system', content:EDWARD_SYSTEM },
              { role:'user', content:`Görseli analiz ettin, sonuç: "${aciklama}". Edward Elric olarak anlat.` }
            ], SMART, 800, 0.7)
          : 'Bunu analiz edemedim... Simya bile işe yaramadı bu sefer.';
      } else {
        const webLazim = await webGerekliMi(soru);
        cevap = webLazim
          ? (await akilliWebGezgini(soru)).cevap
          : await groqCall([{ role:'system', content:EDWARD_SYSTEM }, { role:'user', content:soru }], SMART, 1500, 0.7);
      }
    } else {
      // Video mu istiyor? Groq karar versin
      const videoKarar = await groqCall([
        { role:'system', content:'Kullanıcı video oluşturulmasını mı istiyor? SADECE "evet" ya da "hayir" yaz.' },
        { role:'user', content: soru }
      ], SMART, 5, 0.0);

      if (videoKarar.trim().toLowerCase().startsWith('e')) {
        const yol = path.join(TMP, `v_${Date.now()}.avi`);
        videoOlustur(soru, yol);
        await msg.reply({ content: '🎬 Al bakalım!', files: [new AttachmentBuilder(yol)] });
        setTimeout(() => { try { fs.unlinkSync(yol); } catch {} }, 10000);
        return;
      }

      // Web gerekli mi? Groq karar versin
      const webLazim = await webGerekliMi(soru);
      console.log(`🔍 Web: ${webLazim ? 'evet' : 'hayır'} | ${soru.slice(0,60)}`);
      cevap = webLazim
        ? (await akilliWebGezgini(soru)).cevap
        : await groqCall([{ role:'system', content:EDWARD_SYSTEM }, { role:'user', content:soru }], SMART, 1500, 0.7);
    }

    if (cevap.length > 1900) {
      for (const p of cevap.match(/[\s\S]{1,1900}/g) || []) await msg.channel.send(p);
    } else {
      await msg.reply(cevap);
    }
  } catch (e) {
    console.error('Hata:', e);
    await msg.reply('⚠️ Bir şeyler ters gitti... Eşdeğer takas bu mu böyle?!');
  }
});

/* ═══ HAZIR ═══ */
client.once(Events.ClientReady, c => {
  console.log(`✅ ${c.user.tag} hazır!`);
  console.log(`🛡️ Guard: ${GUARD_FILE} | Whitelist: ${WHITE_FILE}`);
  console.log(`🔑 Groq key sayısı: ${GROQ_KEYS.length}`);
});

client.login(DISCORD_TOKEN);
process.on('unhandledRejection', e => console.error('🔥', e));