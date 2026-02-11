const express = require("express");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== ÖRNEK BAĞLANTILAR ===== */
// MongoDB (mongoose)
const mongoose = require("mongoose");

// PostgreSQL (pg)
const { Pool } = require("pg");

// Redis
const redis = require("redis");

/* ===== DB CONNECTIONS ===== */

// Mongo
mongoose.connect(process.env.MONGO_URI);

// Postgres
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
});
redisClient.connect();

/* ===== SERVER ===== */
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

/* ===== GRACEFUL SHUTDOWN ===== */
const shutdown = async (signal) => {
  console.log(`\n${signal} alındı. Bağlantılar kapatılıyor...`);

  try {
    // HTTP Server
    server.close(() => {
      console.log("HTTP server kapatıldı.");
    });

    // MongoDB
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("MongoDB bağlantısı kapatıldı.");
    }

    // PostgreSQL
    await pgPool.end();
    console.log("PostgreSQL bağlantısı kapatıldı.");

    // Redis
    await redisClient.quit();
    console.log("Redis bağlantısı kapatıldı.");

    process.exit(0);
  } catch (err) {
    console.error("Kapanırken hata oluştu:", err);
    process.exit(1);
  }
};

/* ===== RENDER İÇİN KRİTİK ===== */
process.on("SIGTERM", shutdown); // Render bunu gönderir
process.on("SIGINT", shutdown);  // Ctrl+C