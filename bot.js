const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');
const cheerio = require('cheerio');

/* ── SERVER ── */
http.createServer((_, r) => {
  r.writeHead(200);
  r.end('OK');
}).listen(process.env.PORT || 8080);

/* ── CONFIG ── */
const GROQ_KEY = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const SMART = 'llama-3.3-70b-versatile';
const VISION = 'meta-llama/llama-4-scout-17b-16e-instant';

/* ── HAFIZA ── */
const mem = new Map();
const MAX_MESAJ = 10; // Kaç mesaj tutulsun (user+assistant toplam)

/* ══════════════════════════════════════════════════════
   GROQ API
   ══════════════════════════════════════════════════════ */
async function groqCall(messages, max_tokens = 1500, temperature = 0.5, deneme = 0) {
  try {
    const r = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: SMART, messages, temperature, max_tokens },
      {
        headers: {
          Authorization: `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );
    return r.data.choices[0].message.content.trim();
  } catch (e) {
    const status = e.response?.status;
    console.error(`Groq Hatası (deneme ${deneme + 1}):`, e.response?.data || e.message);

    if ((status === 429 || status >= 500) && deneme < 3) {
      const bekle = (deneme + 1) * 4000;
      await new Promise(res => setTimeout(res, bekle));
      return groqCall(messages, max_tokens, temperature, deneme + 1);
    }
    return null;
  }
}

/* ══════════════════════════════════════════════════════
   NİYET ANALİZİ
   ══════════════════════════════════════════════════════ */
function niyetBelirle(soru) {
  const s = soru.toLowerCase();
  const aramaKelimeler = [
    'bugün', 'bu gün', 'şu an', 'şu anda', 'şimdi', 'son dakika', 'güncel',
    'bu hafta', 'bu ay', 'bu yıl', 'dün', 'yarın',
    'kaç lira', 'kaç tl', 'kaç dolar', 'fiyat', 'kur', 'döviz', 'dolar', 'euro',
    'borsa', 'bitcoin', 'kripto', 'altın', 'faiz',
    'haber', 'son haber', 'gelişme', 'deprem', 'seçim', 'maç', 'skor',
    'kim kazandı', 'sonuç', 'fikstür', 'transfer',
    'hava durumu', 'hava nasıl', 'yağmur', 'sıcaklık', 'derece',
    'nerede', 'nasıl gidilir', 'açık mı', 'ne zaman', 'kaçta',
  ];
  return aramaKelimeler.some(k => s.includes(k)) ? 'ARAMA' : 'SOHBET';
}

/* ══════════════════════════════════════════════════════
   GOOGLE ARAMA
   ══════════════════════════════════════════════════════ */
async function googleArama(sorgu) {
  try {
    const { data } = await axios.get('https://www.google.com/search', {
      params: { q: sorgu, hl: 'tr', num: 10 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const sonuclar = [];
    $('a').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.startsWith('/url?q=')) {
        const url = href.replace('/url?q=', '').split('&')[0];
        if (url.startsWith('http') && !url.includes('google.com')) {
          const baslik = $(elem).find('h3').text().trim();
          if (baslik) sonuclar.push({ url, baslik });
        }
      }
    });
    return sonuclar.slice(0, 8);
  } catch { return []; }
}

async function siteZiyaretcisi(linkler, anahtar_kelimeler) {
  const icerikler = [];
  const promises = linkler.slice(0, 5).map(async (link) => {
    try {
      const { data } = await axios.get(link.url, { timeout: 6000 });
      const $ = cheerio.load(data);
      $('script, style, nav, footer, header').remove();
      let metin = '';
      $('p, h1, h2, h3, article, .content').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 50) metin += text + '\n';
      });
      if (metin.length < 200) metin = $('body').text().replace(/\s+/g, ' ').trim();
      metin = metin.substring(0, 1200);
      let alaka = 0;
      anahtar_kelimeler.forEach(k => { if (metin.includes(k)) alaka++; });
      if (metin.length > 100) icerikler.push({ metin, alaka });
    } catch { }
  });
  await Promise.allSettled(promises);
  icerikler.sort((a, b) => b.alaka - a.alaka);
  return icerikler.slice(0, 3);
}

/* ══════════════════════════════════════════════════════
   ANA İŞLEYİCİ
   ══════════════════════════════════════════════════════ */
async function anaIsleyici(soru, kullaniciId) {
  // Türkiye saatini al (Botun saati ne olursa olsun TR saatini bilir)
  const suAn = new Date().toLocaleString('tr-TR', { 
    timeZone: 'Europe/Istanbul', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    weekday: 'long', 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  const karar = niyetBelirle(soru);
  console.log(`[${kullaniciId}] Tarih: ${suAn} | Karar: ${karar}`);

  // ── ARAMA YOLU ──
  if (karar === 'ARAMA') {
    const linkler = await googleArama(soru);
    const anahtar = soru.split(' ').filter(k => k.length > 2).slice(0, 5);
    const icerikler = await siteZiyaretcisi(linkler, anahtar);
    const kaynakMetni = icerikler.map(s => s.metin).join('\n---\n');

    return await groqCall([
      {
        role: 'system',
        content: `Sen yardımsever bir asistansın. Geliştiricin Batuhan. Güncel Tarih ve Saat: ${suAn}. Verilen bilgileri kullanarak soruyu doğal Türkçe ile cevapla.`,
      },
      {
        role: 'user',
        content: `Soru: ${soru}\n\nBulunan Bilgiler:\n${kaynakMetni || '(Bilgi yok, kendi bilginle cevapla)'}`,
      },
    ]);
  }

  // ── SOHBET YOLU ──
  if (!mem.has(kullaniciId)) mem.set(kullaniciId, []);
  const gecmis = mem.get(kullaniciId);
  gecmis.push({ role: 'user', content: soru });

  const cevap = await groqCall([
    { 
      role: 'system', 
      content: `Sen samimi bir asistansın. Geliştiricin Batuhan. Güncel Tarih ve Saat: ${suAn}. Türkçe ve doğal konuş.` 
    },
    ...gecmis,
  ]);

  const sonCevap = cevap || 'Şu an cevap veremiyorum.';
  gecmis.push({ role: 'assistant', content: sonCevap });
  while (gecmis.length > MAX_MESAJ) gecmis.splice(0, 2);

  return sonCevap;
}

/* ══════════════════════════════════════════════════════
   DISCORD
   ══════════════════════════════════════════════════════ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async msg => {
  // Everyone/Here filtresi
  if (msg.author.bot || msg.mentions.everyone || !msg.mentions.has(client.user)) return;

  const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!soru) return msg.reply('Efendim?');

  if (soru.toLowerCase().includes('oylama') && (soru.includes('eşit') || soru.includes('berabere'))) {
    return msg.reply('Oylama berabere bitti, kimse idam edilmedi!');
  }

  await msg.channel.sendTyping();

  try {
    const cevap = await anaIsleyici(soru, msg.author.id);
    if (cevap.length > 2000) {
      const parcalar = cevap.match(/[\s\S]{1,1900}/g);
      for (const p of parcalar) await msg.reply(p);
    } else {
      await msg.reply(cevap);
    }
  } catch (e) {
    console.error(e);
    msg.reply('Şu an yanıt veremiyorum.');
  }
});

client.once('ready', c => console.log(`✅ ${c.user.tag} hazır!`));
client.login(DISCORD_TOKEN);

/* ══════════════════════════════════════════════════════
   EKLENEN ÖZELLİKLER (Kodun hiçbir satırı değiştirilmemiştir)
   ══════════════════════════════════════════════════════ */

// 1. Yapılandırma: Birden çok yasaklı kelime ve hariç tutulacak ID'ler
const YASAK_KELIMELER = ['edward','elric','ELRİC']; // İstediğiniz kelimeleri buraya ekleyin
const HARIC_ID_LIST = ['914407026036199425','760895784153251841','1149679692597702666','1297139606114009203'];

// 2. Orijinal groqCall fonksiyonunu sarmalayarak botun kendini "Awe" olarak tanıtmasını sağla
const originalGroqCall = groqCall;
global.groqCall = async function(messages, max_tokens = 1500, temperature = 0.5, deneme = 0) {
    // Sistem mesajlarına "Awe" kimliğini ekle
    const yeniMesajlar = messages.map(msg => {
        if (msg.role === 'system') {
            const yeniIcerik = `${msg.content} Senin adın Awe. Kendini Awe olarak tanıt.`;
            return { ...msg, content: yeniIcerik };
        }
        return msg;
    });
    return originalGroqCall(yeniMesajlar, max_tokens, temperature, deneme);
};

// 3. Mesaj silme listener'ı (birden çok kelime kontrolü)
client.on('messageCreate', async (msg) => {
    // Bot mesajlarını ve hariç ID'leri kontrol et
    if (msg.author.bot) return;
    if (HARIC_ID_LIST.includes(msg.author.id)) return;

    // Yasaklı kelimelerden herhangi biri mesajda geçiyor mu? (case-insensitive)
    const mesajKucuk = msg.content.toLowerCase();
    const yasakBulundu = YASAK_KELIMELER.some(kelime => mesajKucuk.includes(kelime.toLowerCase()));

    if (yasakBulundu) {
        try {
            await msg.delete();
            // İsteğe bağlı: Kullanıcıya özel mesaj göndermek için aşağıdaki satırı aktifleştirin
            // await msg.author.send(`Yasaklı kelimelerden birini kullandınız: ${YASAK_KELIMELER.join(', ')}`).catch(() => {});
        } catch (err) {
            console.error('Mesaj silinemedi:', err.message);
        }
    }
});

// 4. Bot hazır olduğunda ek olarak "Awe hazır!" yazdır
client.once('ready', () => {
    console.log(`🤖 Awe hazır! (${client.user.tag})`);
}); 