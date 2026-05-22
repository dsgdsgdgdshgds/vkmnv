/**
 * 🤖 Son Dakika Haber Botu
 *
 * Haber kaynakları: RSS feed (key'siz, açık)
 * Görsel: Haberin og:image — logo/watermark içerenleri filtreler
 * Filtre: Sıradan haberler atlanır, sadece önemli olanlar paylaşılır
 * Depolama: /var/data/gecmis_haber.json (otomatik oluşturulur)
 *
 * Kurulum:
 *   npm install node-telegram-bot-api axios node-cron rss-parser cheerio
 *   TELEGRAM_TOKEN=xxx CHANNEL_ID=-100xxx node telegram-news-bot.js
 */

const TelegramBot = require("node-telegram-bot-api");
const axios       = require("axios");
const cron        = require("node-cron");
const fs          = require("fs");
const RSSParser   = require("rss-parser");
const cheerio     = require("cheerio");

// ─── AYARLAR ──────────────────────────────────────────────────────────────────
const TOKEN          = process.env.TELEGRAM_TOKEN || "BOT_TOKEN_BURAYA";
const CHANNEL_ID     = process.env.CHANNEL_ID     || "-100KANAL_ID_BURAYA";
const GECMIS         = "/var/data/gecmis_haber.json";
const KONTROL_SURESI = "*/8 * * * *"; // Her 8 dakikada bir kontrol
// ──────────────────────────────────────────────────────────────────────────────

const parser = new RSSParser({ timeout: 10000 });
const bot    = new TelegramBot(TOKEN, { polling: false });

// ─── HABER RSS KAYNAKLARI ─────────────────────────────────────────────────────
const KAYNAKLAR = [
  { ad: "NTV",       url: "https://www.ntv.com.tr/son-dakika.rss" },
  { ad: "CNN Türk",  url: "https://www.cnnturk.com/feed/rss/all/news" },
  { ad: "Hürriyet",  url: "https://www.hurriyet.com.tr/rss/anasayfa" },
  { ad: "Sabah",     url: "https://www.sabah.com.tr/rss/anasayfa.xml" },
  { ad: "Sözcü",     url: "https://www.sozcu.com.tr/rss/son-dakika.xml" },
  { ad: "AA",        url: "https://www.aa.com.tr/tr/rss/default?cat=guncel" },
  { ad: "TRT Haber", url: "https://www.trthaber.com/sondakika.rss" },
  { ad: "Milliyet",  url: "https://www.milliyet.com.tr/rss/rssNew/sondakikaarsiv.xml" },
];

// ─── ÖNEMLİLİK FİLTRESİ ──────────────────────────────────────────────────────
const ONEMLI_KELIMELER = [
  "son dakika","acil","flaş","kritik","alarm","uyarı","tehlike","tahliye",
  "deprem","sel","yangın","tsunami","kasırga","fırtına","heyelan","volkan",
  "cumhurbaşkanı","erdoğan","meclis","kabine","seçim","referandum","istifa","atandı","görevden",
  "kanun","yasa","karar","yönetmelik","anayasa","hükümet","bakan","başbakan",
  "dolar","euro","enflasyon","faiz","merkez bankası","borsa","bütçe","zam","indirim",
  "işsizlik","büyüme","kriz","iflas","haciz","konkordato",
  "saldırı","bomba","patlama","terör","operasyon","gözaltı","tutuklama","şüpheli",
  "silahlı","çatışma","rehin","kaçırma",
  "rusya","ukrayna","abd","çin","nato","bm","ab","suriye","irak","iran",
  "savaş","ateşkes","müzakere","yaptırım","ambargo",
  "salgın","pandemi","koronavirüs","aşı","ölü","yaralı","hastane",
  "kaza","çarpışma","çarpıştı","düştü","devrildi","yaralandı","hayatını kaybetti",
  "ölü","ölüm","kayıp","enkaz",
  "rekor","tarihi","ilk kez","dünya birincisi","nobel","büyük",
];

const ATLA_KELIMELER = [
  "indirim fırsatı","alışveriş","kampanya","reklam","sponsor",
  "burç","falı","diyet","kilo","güzellik","makyaj",
  "dizi","film","oyuncu","magazin","ünlü","şarkı","albüm",
  "tarifi","nasıl yapılır","tüyo","ipucu",
  "galeri","foto haber","video haber","izle","izlendi",
  "evlendi","ayrıldı","hamile","doğum","nişanlandı",
  "instagram","sosyal medya","paylaşım","yorum yaptı","açıkladı ki",
  "en iyi","en kötü","sıralama","liste","top 10",
];

function haberOnemliMi(baslik) {
  const k = baslik.toLowerCase();
  if (ATLA_KELIMELER.some(w => k.includes(w))) return false;
  return ONEMLI_KELIMELER.some(w => k.includes(w));
}

// ─── RSS'TEN KISA AÇIKLAMA ÇEK ────────────────────────────────────────────────
function aciklamaCek(item) {
  // RSS'in kendi description/summary alanını dene
  let ham = item.contentSnippet || item.summary || item.description || "";

  // HTML taglarını temizle
  ham = ham.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  // Çok kısaysa (sadece başlığı tekrarlıyorsa) boş döndür
  if (ham.length < 30) return "";

  // İlk 2 cümleyi al, max 200 karakter
  const cumleler = ham.split(/(?<=[.!?])\s+/);
  let ozet = cumleler.slice(0, 2).join(" ").trim();
  if (ozet.length > 200) ozet = ozet.substring(0, 200).trim() + "...";

  return ozet;
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
  // Dosya yoksa sıfırdan oluştur
  const bos = { gonderilen: [], toplam: 0 };
  fs.writeFileSync(GECMIS, JSON.stringify(bos, null, 2));
  console.log(`📄 Geçmiş dosyası oluşturuldu: ${GECMIS}`);
  return bos;
}

function gecmisKaydet(g) {
  if (g.gonderilen.length > 500) g.gonderilen = g.gonderilen.slice(-500);
  fs.writeFileSync(GECMIS, JSON.stringify(g, null, 2));
}

// ─── GÖRSEL ÇEK ───────────────────────────────────────────────────────────────
const LOGO_BLACKLIST = [
  "logo","watermark","favicon","icon","banner","header","footer",
  "ntv.com.tr/Assets","cnnturk.com/img/logo","hurriyet.com.tr/images/logo",
  "sabah.com.tr/foto/logo","sozcu.com.tr/wp-content/themes",
  "trthaber.com/img/logo","milliyet.com.tr/Images/logo","aa.com.tr/img/logo",
];

async function gorselCek(haberUrl) {
  try {
    const { data } = await axios.get(haberUrl, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)" },
      maxRedirects: 3,
    });
    const $ = cheerio.load(data);
    const adaylar = [
      $('meta[property="og:image"]').attr("content"),
      $('meta[name="twitter:image"]').attr("content"),
      $('meta[name="twitter:image:src"]').attr("content"),
    ].filter(Boolean);

    for (const url of adaylar) {
      const temizUrl = url.startsWith("//") ? "https:" + url : url;
      const logoMu = LOGO_BLACKLIST.some(k => temizUrl.toLowerCase().includes(k));
      if (!logoMu && temizUrl.startsWith("http")) return temizUrl;
    }
    return null;
  } catch (_) { return null; }
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

// ─── GÖNDER ───────────────────────────────────────────────────────────────────
async function haberleriKontrolEt(gecmis) {
  console.log(`🔍 Haberler taranıyor... [${new Date().toLocaleTimeString("tr-TR")}]`);

  for (const kaynak of KAYNAKLAR) {
    try {
      const feed = await parser.parseURL(kaynak.url);

      for (const item of feed.items.slice(0, 10)) {
        const baslik = (item.title || "").trim();
        const link   = item.link || item.url || "";
        if (!baslik || !link) continue;

        const id = Buffer.from(link).toString("base64").substring(0, 40);
        if (gecmis.gonderilen.includes(id)) continue;

        if (!haberOnemliMi(baslik)) {
          gecmis.gonderilen.push(id);
          continue;
        }

        const hashtagler = hashtagSec(baslik);
        const aciklama   = aciklamaCek(item);
        const mesaj = aciklama
          ? `🔴 *SON DAKİKA*\n\n*${baslik}*\n\n${aciklama}\n\n${hashtagler.join(" ")}`
          : `🔴 *SON DAKİKA*\n\n*${baslik}*\n\n${hashtagler.join(" ")}`;

        try {
          const gorselUrl = await gorselCek(link);

          if (gorselUrl) {
            await bot.sendPhoto(CHANNEL_ID, gorselUrl, {
              caption: mesaj,
              parse_mode: "Markdown",
            });
          } else {
            await bot.sendMessage(CHANNEL_ID, mesaj, {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            });
          }

          gecmis.gonderilen.push(id);
          gecmis.toplam++;
          gecmisKaydet(gecmis);

          console.log(`✅ [#${gecmis.toplam}] ${kaynak.ad}: ${baslik.substring(0, 60)}...`);
          await new Promise(r => setTimeout(r, 3000));

        } catch (gonderiHata) {
          console.error(`❌ Gönderim hatası [${kaynak.ad}]:`, gonderiHata.message);
          gecmis.gonderilen.push(id);
          gecmisKaydet(gecmis);
        }
      }

    } catch (rssHata) {
      console.warn(`⚠️ RSS hatası [${kaynak.ad}]:`, rssHata.message);
    }
  }

  console.log(`✔️  Tarama tamamlandı. Toplam: ${gecmis.toplam}`);
}

// ─── BAŞLAT ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("🤖 Son Dakika Haber Botu başlatılıyor...");
  const gecmis = gecmisYukle();

  cron.schedule(KONTROL_SURESI, () => haberleriKontrolEt(gecmis));
  await haberleriKontrolEt(gecmis);

  console.log("✅ Bot aktif. Her 8 dakikada bir haberler taranacak.");
}

main().catch(err => { console.error("💥 Kritik hata:", err); process.exit(1); });