const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const dotenv = require("dotenv");
const express = require("express");

dotenv.config();

const botToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const url = process.env.URL;
const PORT = process.env.PORT || 3000;

const app = express();
const MAX_MESSAGE_LENGTH = 4000;
const SAVE_FILE = "save.txt";

// 📌 **Daha önce gönderilen haberleri oku**
function loadSentPosts() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      return fs.readFileSync(SAVE_FILE, "utf8").split("\n").filter(Boolean);
    }
  } catch (error) {
    console.error("⚠️ save.txt okunamadı:", error.message);
  }
  return [];
}

// 📌 **Yeni gönderilen haberleri save.txt'ye kaydet**
function savePost(content) {
  fs.appendFileSync(SAVE_FILE, content + "\n");
}

// 📌 **Ana sayfadan en son "/guncel/" haber bağlantısını al**
async function fetchLatestPostUrl() {
  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(response.data);
    let latestPostUrl = null;

    $("a").each((index, element) => {
      const link = $(element).attr("href");
      if (link && link.includes("/guncel/")) {
        latestPostUrl = link.startsWith("http") ? link : `${url}${link}`;
        return false;
      }
    });

    return latestPostUrl;
  } catch (error) {
    console.error("❌ Haber bağlantısı alınırken hata oluştu:", error.message);
    return null;
  }
}

// 📌 **Haber içeriğini al (saat kısmı dahil edilmez)**
async function fetchLatestPostContent(postUrl) {
  try {
    const response = await axios.get(postUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(response.data);

    // **Haberin metin içeriğini al**
    let content = $("ul.news-list li").first().text().trim();
    if (!content) {
      console.log("❌ İçerik bulunamadı.");
      return null;
    }

    // **Saat bilgisini sil**
    content = content.replace(/\b\d{1,2}[:]\d{2}\b/, "").trim();

    return content.substring(0, MAX_MESSAGE_LENGTH);
  } catch (error) {
    console.error("❌ Haber içeriği alınırken hata oluştu:", error.message);
    return null;
  }
}

// 📌 **Telegram'a haber gönderme fonksiyonu**
async function sendToTelegram(content) {
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: `📰 *Yeni Haber:*\n\n${content}`,
      parse_mode: "Markdown",
    });

    console.log("✅ Haber içeriği Telegram'a gönderildi.");
  } catch (error) {
    console.error(
      "❌ Mesaj gönderilirken hata oluştu:",
      error.response?.data || error.message,
    );
  }
}

// 📌 **Yeni haber olup olmadığını kontrol et**
async function checkForUpdates() {
  console.log("🔄 Yeni haberler kontrol ediliyor...");
  const latestPostUrl = await fetchLatestPostUrl();
  if (!latestPostUrl) return console.log("❌ Haber URL bulunamadı.");

  const content = await fetchLatestPostContent(latestPostUrl);
  if (!content) return console.log("❌ Haber içeriği alınamadı.");

  const sentPosts = loadSentPosts();
  if (sentPosts.includes(content)) {
    console.log("📌 Bu haber daha önce gönderildi.");
    return;
  }

  console.log("🚀 Yeni içerik bulundu!");
  await sendToTelegram(content);
  savePost(content); // **Sadece haber içeriğini kaydet**

  console.log("✅ Haber paylaşıldı.");
}

// 📌 **İlk çalıştırmada son haberi hemen paylaş**
(async () => {
  await checkForUpdates();
})();

// 📌 **Web View Sunucusu (Uptime için)**
app.get("/", (req, res) => {
  res.send("✅ Bot çalışıyor!");
});

// **Botun her 10 saniyede bir haber kontrol etmesini sağla**
setInterval(async () => {
  await checkForUpdates();
}, 10000); // Her 10 saniyede bir kontrol et

app.listen(PORT, () => {
  console.log(`🌐 Web sunucusu ${PORT} portunda çalışıyor.`);
});
