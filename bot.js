const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end("OK"); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_API_KEY  = process.env.groq;
const DISCORD_TOKEN = process.env.token;

const MODEL_FAST  = "llama-3.1-8b-instant";
const MODEL_SMART = "compound-beta";

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 5;

/* ====== KÜFÜR TESPİTİ ====== */
const KUFURLER = ["amk","orospu","oc","sik","got","bok","yarrak","pic","sikerim","amina","gerizekali","salak","ahmak","kahpe","aptal","sikeyim","oglum"];
function kufurVarMi(metin) {
    const k = metin.toLowerCase()
        .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
        .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c");
    return KUFURLER.some(w => k.includes(w));
}

/* ====== GÜNCEL BİLGİ GEREKLİ Mİ ====== */
const GUNCEL = ["haber","son dakika","bugün","şu an","şimdi","kaç oldu","kim kazandı","skor","maç","puan","fiyat","dolar","euro","btc","bitcoin","kripto","borsa","hava durumu","sıcaklık","ne zaman","güncel","son durum","gelişme","olay","seçim","başbakan","cumhurbaşkanı","bakan","2026","2025"];
function guncelGerekli(metin) {
    const k = metin.toLowerCase();
    return GUNCEL.some(w => k.includes(w));
}

/* ====== GROQ ÇAĞRISI ====== */
async function groqCagir(messages, model, max_tokens = 1000) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages, temperature: 0.6, max_tokens },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 35000 }
    );
    return res.data.choices[0].message.content.trim();
}

/* ====== CEVAP ÜRET ====== */
async function cevapUret(userId, soru) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const gecmis = memory.get(userId) || [];

    const kufur  = kufurVarMi(soru);
    const guncel = guncelGerekli(soru);

    let sistem;
    if (kufur) {
        sistem = "Sen Awe adinda bir Discord botusun. Gelistiricin Batuhan. Kullanici sana kufur etti. Turkce kufurle kisa ve sert geri don, 1-2 cumle. Sadece Latin alfabesiyle yaz, baska alfabe yasak.";
    } else if (guncel) {
        sistem = `Sen Awe adinda bir Discord botusun. Bugunun tarihi: ${tarih}. Guncel bilgi gerektiren soruyu internetten arastirarak yanıtla. Sadece Latin alfabesiyle yaz, baska alfabe kesinlikle yasak. Turkceye Turkce, Ingilizceye Ingilizce cevap ver. Discord formatı: **kalin**, > alinti. Kisa ve net ol.`;
    } else {
        sistem = `Sen Awe adinda bir Discord botusun. Gelistiricin ve yaraticin Batuhan. Tarih: ${tarih}. Kisa ve samimi sohbet et. Gelistiricin kim diye sorarlarsa Batuhan de. Sadece Latin alfabesiyle yaz, baska alfabe kesinlikle yasak. Liste veya baslik kullanma.`;
    }

    const messages = [{ role: "system", content: sistem }];
    for (const h of gecmis) {
        messages.push({ role: "user",      content: h.user });
        messages.push({ role: "assistant", content: h.bot  });
    }
    messages.push({ role: "user", content: soru });

    const model = (kufur || !guncel) ? MODEL_FAST : MODEL_SMART;
    const cevap = await groqCagir(messages, model);

    const yeni = [...gecmis, { user: soru, bot: cevap }];
    if (yeni.length > MAX_HISTORY) yeni.shift();
    memory.set(userId, yeni);

    return cevap;
}

/* ====== MESAJ BÖLÜCÜ ====== */
function mesajlariBol(metin, limit = 1950) {
    if (metin.length <= limit) return [metin];
    const parcalar = [];
    let kalan = metin;
    while (kalan.length > 0) {
        let kes = limit;
        const p = kalan.lastIndexOf('\n\n', limit);
        if (p > limit * 0.6) kes = p;
        else { const s = kalan.lastIndexOf('\n', limit); if (s > limit * 0.6) kes = s; }
        parcalar.push(kalan.slice(0, kes).trim());
        kalan = kalan.slice(kes).trim();
    }
    return parcalar;
}

/* ====== GÜVENLİ GÖNDER ====== */
async function guvenliGonder(msg, metin, ilk = true) {
    try {
        if (ilk) await msg.reply({ content: metin, allowedMentions: { repliedUser: false } });
        else     await msg.channel.send(metin);
    } catch (err) {
        if (err.code === 50013) { try { await msg.author.send(metin); } catch {} }
        else console.error("❌ Mesaj gönderilemedi:", err.message);
    }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on("messageCreate", async msg => {
    if (msg.author.bot || msg.mentions.everyone) return;
    if (!msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, "").trim();
    if (!soru) return guvenliGonder(msg, "Ne sormak istiyorsun?");

    msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const cevap = await cevapUret(msg.author.id, soru);
        clearInterval(typing);
        const parcalar = mesajlariBol(cevap);
        for (let i = 0; i < parcalar.length; i++) await guvenliGonder(msg, parcalar[i], i === 0);
    } catch (err) {
        clearInterval(typing);
        console.error("❌ Hata:", err.message);
        await guvenliGonder(msg, "Bir sorun oluştu, tekrar dene.");
    }
});

client.once("clientReady", c => {
    console.log(`✅ ${c.user.tag} aktif`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`👤 Geliştirici: Batuhan | Bot: Awe`);
});

process.on("unhandledRejection", err => console.error("🔥", err?.message || err));

client.login(DISCORD_TOKEN);