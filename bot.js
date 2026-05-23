/**
 * 🤖 Son Dakika Haber Botu
 *
 * Haber kaynakları: RSS feed (key'siz, açık)
 * Görsel + Açıklama: og:image / og:description (tek HTTP isteği, temiz)
 * Filtre: Magazin/dizi/reklam atlanır, sadece önemli haberler paylaşılır
 * Depolama: /var/data/gecmis_haber.json
 *
 * Kurulum:
 *   npm install node-telegram-bot-api axios node-cron rss-parser cheerio
 *   TELEGRAM_TOKEN=xxx CHANNEL_ID=-100xxx node telegram-news-bot.js
 */

const TelegramBot = require("node-telegram-bot-api");
const axios       = require("axios");
const cron        = require("node-cron");
const fs          = require("fs");
const http        = require("http");
const RSSParser   = require("rss-parser");
const cheerio     = require("cheerio");

// ─── AYARLAR ──────────────────────────────────────────────────────────────────
const TOKEN          = process.env.TELEGRAM_TOKEN || "BOT_TOKEN_BURAYA";
const CHANNEL_ID     = process.env.CHANNEL_ID     || "-100KANAL_ID_BURAYA";
const GECMIS         = "/var/data/gecmis_haber.json";
const KONTROL_SURESI = "*/8 * * * *";
// ──────────────────────────────────────────────────────────────────────────────

const parser = new RSSParser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)" },
});
const bot = new TelegramBot(TOKEN, { polling: false });

// ─── RSS KAYNAKLARI ───────────────────────────────────────────────────────────
const KAYNAKLAR = [
  { ad: "NTV",       url: "https://www.ntv.com.tr/son-dakika.rss" },
  { ad: "CNN Türk",  url: "https://www.cnnturk.com/feed/rss/all/news" },
  { ad: "AA",        url: "https://www.aa.com.tr/tr/rss/default?cat=guncel" },
  { ad: "TRT Haber", url: "https://www.trthaber.com/sondakika.rss" },
  { ad: "Sabah",     url: "https://www.sabah.com.tr/rss/anasayfa.xml" },
  { ad: "Hürriyet",  url: "https://www.hurriyet.com.tr/rss/anasayfa" },
  { ad: "Sözcü",     url: "https://www.sozcu.com.tr/rss/son-dakika.xml" },
  { ad: "Milliyet",  url: "https://www.milliyet.com.tr/rss/rssNew/sondakikaarsiv.xml" },
];

// ─── FİLTRE ───────────────────────────────────────────────────────────────────
const ONEMLI_KELIMELER = [
  "son dakika","acil","flaş","kritik","alarm","uyarı","tehlike","tahliye",
  "deprem","sel","yangın","tsunami","kasırga","fırtına","heyelan","volkan",
  "cumhurbaşkanı","erdoğan","meclis","kabine","seçim","referandum","istifa","atandı","görevden",
  "kanun","yasa","karar","yönetmelik","anayasa","hükümet","bakan","başbakan",
  "dolar","euro","enflasyon","faiz","merkez bankası","borsa","bütçe","zam",
  "işsizlik","büyüme","kriz","iflas","haciz","konkordato",
  "saldırı","bomba","patlama","terör","operasyon","gözaltı","tutuklama","şüpheli",
  "silahlı","çatışma","rehin","kaçırma",
  "rusya","ukrayna","abd","çin","nato","bm","ab","suriye","irak","iran",
  "savaş","ateşkes","müzakere","yaptırım","ambargo",
  "salgın","pandemi","koronavirüs","aşı","ölü","yaralı","hastane",
  "kaza","çarpışma","çarpıştı","düştü","devrildi","yaralandı","hayatını kaybetti",
  "ölüm","kayıp","enkaz","rekor","tarihi","ilk kez",
];

const ATLA_KELIMELER = [
  "indirim fırsatı","alışveriş","kampanya","reklam","sponsor",
  "burç","falı","diyet","kilo","güzellik","makyaj",
  "dizi","film","oyuncu","magazin","ünlü","şarkı","albüm",
  "tarifi","nasıl yapılır","tüyo","ipucu",
  "galeri","foto haber","video haber","izle","izlendi",
  "evlendi","ayrıldı","hamile","doğum","nişanlandı",
  "instagram","sosyal medya","paylaşım yaptı",
  "en iyi","en kötü","sıralama","top 10",
];

function haberOnemliMi(baslik) {
  const k = baslik.toLowerCase();
  if (ATLA_KELIMELER.some(w => k.includes(w))) return false;
  return ONEMLI_KELIMELER.some(w => k.includes(w));
}

// ─── GEÇMİŞ ──────────────────────────────────────────────────────────────────
function gecmisYukle() {
  try {
    if (fs.existsSync(GECMIS)) {
      const icerik = JSON.parse(fs.readFileSync(GECMIS, "utf8"));
      console.log(`📂 Geçmiş yüklendi: ${icerik.toplam} haber`);
      return icerik;
    }
  } catch (_) {}
  const bos = { gonderilen: [], toplam: 0 };
  fs.writeFileSync(GECMIS, JSON.stringify(bos, null, 2));
  console.log(`📄 Geçmiş dosyası oluşturuldu: ${GECMIS}`);
  return bos;
}

function gecmisKaydet(g) {
  if (g.gonderilen.length > 500) g.gonderilen = g.gonderilen.slice(-500);
  fs.writeFileSync(GECMIS, JSON.stringify(g, null, 2));
}

// ─── RSS RETRY ────────────────────────────────────────────────────────────────
async function rssCek(url) {
  for (let i = 0; i < 2; i++) {
    try {
      return await parser.parseURL(url);
    } catch (e) {
      if (i === 1) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ─── LOGO BLACKLIST ───────────────────────────────────────────────────────────
const LOGO_BLACKLIST = [
  "logo","watermark","favicon","icon","banner","header","footer",
  "ntv.com.tr/Assets","cnnturk.com/img/logo","hurriyet.com.tr/images/logo",
  "sabah.com.tr/foto/logo","sozcu.com.tr/wp-content/themes",
  "trthaber.com/img/logo","milliyet.com.tr/Images/logo","aa.com.tr/img/logo",
];

// ─── BAŞLIĞI TEMİZLE ─────────────────────────────────────────────────────────
function baslikTemizle(baslik) {
  return baslik.replace(/\s*[-–|]\s*[^-–|]+$/, "").trim();
}

// ─── AÇIKLAMAYI AKILLICA KES ──────────────────────────────────────────────────
function aciklamaKes(metin, maksKarakter = 800) {
  if (!metin || metin.length <= maksKarakter) return metin;

  const kisaltilmis = metin.substring(0, maksKarakter);
  // Son tam cümleyi bul (. ! ? ile biten)
  const sonCumleIndex = kisaltilmis.search(/[.!?][^.!?]*$/);
  if (sonCumleIndex > 100) {
    return kisaltilmis.substring(0, sonCumleIndex + 1).trim();
  }
  // Cümle bulunamazsa son boşlukta kes
  const sonBosluk = kisaltilmis.lastIndexOf(" ");
  return (sonBosluk > 100 ? kisaltilmis.substring(0, sonBosluk) : kisaltilmis).trim() + "…";
}

// ─── GOOGLE NEWS LİNKİNİ GERÇEK HABER SİTESİNE ÇEVİR ────────────────────────
async function gercekUrlBul(googleUrl) {
  try {
    const { request } = await axios.get(googleUrl, {
      timeout: 12000,
      maxRedirects: 5,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
    });
    return request.res?.responseUrl || request.responseURL || googleUrl;
  } catch (_) { return googleUrl; }
}

// ─── TEK İSTEKLE GÖRSEL + AÇIKLAMA ───────────────────────────────────────────
async function sayfaBilgisiCek(haberUrl) {
  try {
    const { data } = await axios.get(haberUrl, {
      timeout: 12000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)" },
      maxRedirects: 3,
    });
    const $ = cheerio.load(data);

    // Açıklama
    let aciklama = "";
    const acAdaylar = [
      $('meta[property="og:description"]').attr("content"),
      $('meta[name="description"]').attr("content"),
      $('meta[name="twitter:description"]').attr("content"),
    ].filter(Boolean);

    for (const metin of acAdaylar) {
      const temiz = metin.replace(/\s+/g, " ").trim();
      if (temiz.length < 40) continue;
      aciklama = temiz;
      break;
    }

    // Görsel
    let gorsel = null;
    const gAdaylar = [
      $('meta[property="og:image"]').attr("content"),
      $('meta[name="twitter:image"]').attr("content"),
      $('meta[name="twitter:image:src"]').attr("content"),
    ].filter(Boolean);

    for (const url of gAdaylar) {
      const u = url.startsWith("//") ? "https:" + url : url;
      if (!u.startsWith("http")) continue;
      if (LOGO_BLACKLIST.some(k => u.toLowerCase().includes(k))) continue;
      gorsel = u;
      break;
    }

    return { aciklama, gorsel };
  } catch (_) { return { aciklama: "", gorsel: null }; }
}

// ─── HASHTAG ──────────────────────────────────────────────────────────────────
const HASHTAG_HAVUZU = {
  afet:     ["#sondakika","#deprem","#acil","#haber"],
  ekonomi:  ["#sondakika","#ekonomi","#dolar","#borsa","#haber"],
  siyaset:  ["#sondakika","#siyaset","#türkiye","#haber"],
  guvenlik: ["#sondakika","#güvenlik","#operasyon","#haber"],
  saglik:   ["#sondakika","#sağlık","#haber"],
  dunya:    ["#sondakika","#dünya","#uluslararası","#haber"],
  kaza:     ["#sondakika","#kaza","#haber"],
  default:  ["#sondakika","#haber","#türkiye","#gündem"],
};

function hashtagSec(baslik) {
  const k = baslik.toLowerCase();
  if (k.includes("deprem")||k.includes("sel")||k.includes("yangın")||k.includes("afet")) return HASHTAG_HAVUZU.afet;
  if (k.includes("dolar")||k.includes("euro")||k.includes("enflasyon")||k.includes("faiz")||k.includes("borsa")) return HASHTAG_HAVUZU.ekonomi;
  if (k.includes("cumhurbaşkan")||k.includes("meclis")||k.includes("seçim")||k.includes("bakan")) return HASHTAG_HAVUZU.siyaset;
  if (k.includes("saldırı")||k.includes("terör")||k.includes("operasyon")||k.includes("patlama")) return HASHTAG_HAVUZU.guvenlik;
  if (k.includes("salgın")||k.includes("hastane")||k.includes("sağlık")||k.includes("aşı")) return HASHTAG_HAVUZU.saglik;
  if (k.includes("rusya")||k.includes("abd")||k.includes("nato")||k.includes("savaş")) return HASHTAG_HAVUZU.dunya;
  if (k.includes("kaza")||k.includes("çarpış")||k.includes("devrildi")||k.includes("düştü")) return HASHTAG_HAVUZU.kaza;
  return HASHTAG_HAVUZU.default;
}

// ─── TELEGRAM GÖNDER ──────────────────────────────────────────────────────────
async function telegramGonder(gorsel, mesaj) {
  const CAPTION_LIMIT = 1024;

  if (gorsel) {
    if (mesaj.length <= CAPTION_LIMIT) {
      // Fotoğraf + caption birlikte
      await bot.sendPhoto(CHANNEL_ID, gorsel, {
        caption: mesaj,
        parse_mode: "Markdown",
      });
    } else {
      // Caption sığmaz: önce fotoğraf, sonra metin ayrı mesaj
      await bot.sendPhoto(CHANNEL_ID, gorsel, {});
      await new Promise(r => setTimeout(r, 1000));
      await bot.sendMessage(CHANNEL_ID, mesaj, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
    }
  } else {
    await bot.sendMessage(CHANNEL_ID, mesaj, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  }
}

// ─── ANA DÖNGÜ ────────────────────────────────────────────────────────────────
async function haberleriKontrolEt(gecmis) {
  console.log(`🔍 Taranıyor... [${new Date().toLocaleTimeString("tr-TR")}]`);

  for (const kaynak of KAYNAKLAR) {
    try {
      const feed = await rssCek(kaynak.url);

      for (const item of feed.items.slice(0, 10)) {
        const baslik = baslikTemizle((item.title || "").trim());
        const link   = item.link || item.url || "";
        if (!baslik || !link) continue;

        const id = Buffer.from(link).toString("base64").substring(0, 40);
        if (gecmis.gonderilen.includes(id)) continue;

        if (!haberOnemliMi(baslik)) {
          gecmis.gonderilen.push(id);
          continue;
        }

        const gercekLink               = await gercekUrlBul(link);
        const { aciklama, gorsel }     = await sayfaBilgisiCek(gercekLink);
        const aciklamaTemiz            = aciklamaKes(aciklama);
        const hashtagler               = hashtagSec(baslik);

        const mesaj = aciklamaTemiz
          ? `🔴 *SON DAKİKA*\n\n*${baslik}*\n\n${aciklamaTemiz}\n\n${hashtagler.join(" ")}`
          : `🔴 *SON DAKİKA*\n\n*${baslik}*\n\n${hashtagler.join(" ")}`;

        try {
          await telegramGonder(gorsel, mesaj);

          gecmis.gonderilen.push(id);
          gecmis.toplam++;
          gecmisKaydet(gecmis);

          console.log(`✅ [#${gecmis.toplam}] ${kaynak.ad}: ${baslik.substring(0, 60)}`);
          await new Promise(r => setTimeout(r, 5000)); // flood önlemi

        } catch (gonderiHata) {
          const retryMatch = gonderiHata.message?.match(/retry after (\d+)/i);
          if (retryMatch) {
            const bekle = (parseInt(retryMatch[1]) + 2) * 1000;
            console.warn(`⏳ Telegram bekleme: ${retryMatch[1]} sn bekleniyor...`);
            await new Promise(r => setTimeout(r, bekle));
            try {
              await telegramGonder(gorsel, mesaj);
              gecmis.gonderilen.push(id);
              gecmis.toplam++;
              gecmisKaydet(gecmis);
              console.log(`✅ [#${gecmis.toplam}] (retry) ${baslik.substring(0, 60)}`);
            } catch (retryHata) {
              console.error(`❌ Retry de başarısız:`, retryHata.message);
              gecmis.gonderilen.push(id);
              gecmisKaydet(gecmis);
            }
          } else {
            console.error(`❌ Gönderim hatası [${kaynak.ad}]:`, gonderiHata.message);
            gecmis.gonderilen.push(id);
            gecmisKaydet(gecmis);
          }
        }
      }

    } catch (rssHata) {
      const sebep = rssHata.message?.includes("Timed out") || rssHata.code === "ECONNABORTED"
        ? "zaman aşımı" : rssHata.message;
      console.warn(`⚠️ Atlandı [${kaynak.ad}]: ${sebep}`);
    }
  }

  console.log(`✔️  Tamamlandı. Toplam: ${gecmis.toplam}`);
}

// ─── BAŞLAT ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("🤖 Son Dakika Haber Botu başlatılıyor...");
  const gecmis = gecmisYukle();

  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => res.end("OK")).listen(PORT, () => {
    console.log(`🌐 HTTP server port ${PORT} dinliyor`);
  });

  cron.schedule(KONTROL_SURESI, () => haberleriKontrolEt(gecmis));
  setTimeout(() => haberleriKontrolEt(gecmis), 5000);
  console.log("✅ Bot aktif. Her 8 dakikada bir taranacak.");
}

main().catch(err => { console.error("💥 Kritik hata:", err); process.exit(1); });