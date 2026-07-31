const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot Calisiyor!");
    res.end();
}).listen(8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // display name çözümü için gerekli (Discord Developer Portal -> Bot -> "Server Members Intent" açık olmalı)
    ],
    partials: [Partials.Channel]
});

/* ====== API AYARLARI ====== */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const GROQ_KEYS = [
    { name: "GROQ", key: process.env.GROQ },
    { name: "GROQ1", key: process.env.GROQ1 },
    { name: "GROQ2", key: process.env.GROQ2 },
    { name: "GROQ3", key: process.env.GROQ3 },
    { name: "GROQ4", key: process.env.GROQ4 }
].filter(k => k.key);

if (GROQ_KEYS.length === 0) {
    console.error("⚠️ Hiç Groq API key bulunamadı! .env dosyasındaki GROQ/GROQ1../GROQ4 değişkenlerini kontrol et.");
}

let aktifKeyIndex = 0;

async function groqIstek(payload) {
    let sonHata;
    for (let deneme = 0; deneme < GROQ_KEYS.length; deneme++) {
        const secilen = GROQ_KEYS[aktifKeyIndex];
        try {
            return await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                payload,
                { headers: { Authorization: `Bearer ${secilen.key}` } }
            );
        } catch (e) {
            sonHata = e;
            console.log(`⚠️ ${secilen.name} başarısız (${e?.response?.status || e.message}), sıradaki key deneniyor...`);
            aktifKeyIndex = (aktifKeyIndex + 1) % GROQ_KEYS.length;
        }
    }
    throw sonHata;
}

/* ====== HAFIZA AYARLARI ======
   Her kullanıcı için ayrı bir geçmiş tutulur (userId ile anahtarlanır),
   böylece kullanıcıların hafızaları asla birbirine karışmaz.
   Bir mesaj 1 saatten eski olduğunda otomatik olarak hafızadan düşer. */
const HAFIZA_SURESI_MS = 60 * 60 * 1000; // 1 saat
const MAX_KAYIT = 40; // kullanıcı başına tutulacak maksimum mesaj (aşırı büyümeyi önler)

// userId -> { username, gecmis: [{ rol: 'kullanici'|'bot', icerik, zaman }] }
const userContexts = new Map();

function kullaniciGecmisiGetir(userId) {
    const veri = userContexts.get(userId);
    if (!veri) return [];
    const simdi = Date.now();
    veri.gecmis = veri.gecmis.filter(k => simdi - k.zaman < HAFIZA_SURESI_MS);
    return veri.gecmis;
}

function kullaniciGecmisineEkle(userId, username, rol, icerik) {
    let veri = userContexts.get(userId);
    if (!veri) {
        veri = { username, gecmis: [] };
        userContexts.set(userId, veri);
    }
    veri.username = username;
    veri.gecmis.push({ rol, icerik, zaman: Date.now() });
    if (veri.gecmis.length > MAX_KAYIT) veri.gecmis.shift();
}

function gecmisiMetneCevir(gecmis) {
    if (!gecmis.length) return "Henüz geçmiş yok.";
    return gecmis.map(k => `${k.rol === 'kullanici' ? 'Kullanıcı' : 'Bot'}: ${k.icerik}`).join("\n");
}

/* ====== ETİKET (MENTION) ÇÖZÜMLEME ======
   <@123456> gibi ham etiketleri @kullaniciadi haline çevirir, böylece
   model kimden bahsedildiğini/kime hitap edildiğini doğrudan anlar. */
function etiketleriCoz(msg) {
    let metin = msg.content;
    msg.mentions.users.forEach(u => {
        const isim = msg.guild?.members.cache.get(u.id)?.displayName || u.username;
        const regex = new RegExp(`<@!?${u.id}>`, 'g');
        metin = metin.replace(regex, `@${isim}`);
    });
    return metin.trim();
}

/* ====== FOTOĞRAF (VISION) DESTEĞİ ====== */
function ekliGorselUrlleri(msg) {
    return msg.attachments
        .filter(a => a.contentType && a.contentType.startsWith('image/'))
        .map(a => a.url);
}

async function gorseliAnaliz(soru, resimUrlleri, gecmisMetni) {
    const content = [
        {
            type: "text",
            text: `${gecmisMetni ? `ÖNCEKİ KONUŞMA (referans için):\n${gecmisMetni}\n\n` : ""}KULLANICI SORUSU: ${soru || "Bu görsel(ler)i açıkla."}`
        }
    ];
    resimUrlleri.slice(0, 5).forEach(url => { // Groq tek istekte en fazla 5 görsel kabul ediyor
        content.push({ type: "image_url", image_url: { url } });
    });

    const res = await groqIstek({
        model: "qwen/qwen3.6-27b", // Groq'un güncel görsel destekli (multimodal) modeli
        messages: [
            { role: "system", content: "Sen Türkçe konuşan, görselleri detaylıca analiz edebilen yardımcı bir Discord botusun. Görseldeki önemli detayları açıkla ve kullanıcının sorusuna göre yanıt ver. Geliştiricinin/yaratıcının kim olduğu sorulursa (nasıl sorulursa sorulsun, hangi kelimelerle ifade edilirse edilsin) her zaman 'SlimyKoala' cevabını ver." },
            { role: "user", content }
        ],
        temperature: 0.3
    });
    return res.data.choices[0].message.content;
}

/* ====== GÜNCEL VERİYLE CEVAP ÜRETİMİ (METİN) ====== */
async function dogrulanmisCevap(msg, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const kullaniciAdi = msg.member?.displayName || msg.author.username;

    const kendiGecmis = kullaniciGecmisiGetir(msg.author.id);
    const kendiGecmisMetni = gecmisiMetneCevir(kendiGecmis);

    // Mesajda başka bir kullanıcı etiketlenmişse, o kullanıcının kendi geçmişini
    // SADECE referans olarak ekle — kendi hafızasıyla asla karıştırma.
    let baskaKullaniciMetni = "";
    const digerKullanicilar = msg.mentions.users.filter(u => u.id !== client.user.id && u.id !== msg.author.id);
    if (digerKullanicilar.size > 0) {
        digerKullanicilar.forEach(u => {
            const gecmis = kullaniciGecmisiGetir(u.id);
            if (gecmis.length > 0) {
                const isim = msg.guild?.members.cache.get(u.id)?.displayName || u.username;
                baskaKullaniciMetni += `\n\n--- @${isim} kullanıcısının SADECE REFERANS amaçlı geçmiş konuşması (kendi hafızanmış gibi davranma, sadece bu kişi hakkında bir şey sorulursa kullan) ---\n${gecmisiMetneCevir(gecmis)}`;
            }
        });
    }

    const synthesisPrompt = `
GÜNCEL SİSTEM TARİHİ: ${tarihBilgisi}

SENİNLE KONUŞAN KULLANICI: ${kullaniciAdi}

BU KULLANICIYLA ÖNCEKİ KONUŞMALAR (HAFIZA - son 1 saat):
${kendiGecmisMetni}
${baskaKullaniciMetni}

KURALLAR:
1. **Güncel Bilgi:** Soru güncel/değişken bir veri gerektiriyorsa (haber, sayı, tarih, durum vb.) web araması yaparak doğrula, kendi ezberine güvenme.
2. **Sayısal Karşılaştırma:** Farklı kaynaklarda çelişen sayılar varsa, en güncel ve en güvenilir kaynağı tercih et.
3. **Matematik:** Hesaplama gerekiyorsa yalnızca bulduğun somut sayılara dayan, varsayımda bulunma.
4. **Hafıza İzolasyonu:** Sadece "SENİNLE KONUŞAN KULLANICI" bölümündeki geçmişi kendi hafızan say. Başka kullanıcının geçmişi yalnızca o kişiden bahsedilirse ya da doğrudan sorulursa kullanılır.
5. **Etiketler:** Mesajdaki @isimler zaten kullanıcı adına çevrilmiş halde önünde duruyor; kime hitap edildiğini ya da kimden bahsedildiğini buna göre anla.

KULLANICI SORUSU: ${soru}
`;

    try {
        const res = await groqIstek({
            model: "groq/compound", // Web aramalı, güncel veriye erişebilen Groq sistemi
            messages: [
                { role: "system", content: "Sen rasyonel, matematiksel hataları engelleyen, kullanıcı etiketlerini doğru yorumlayan ve sadece en güncel veriye odaklanan bir bilgi uzmanısın. Gerektiğinde web araması yaparak cevabını doğrula. Geliştiricinin/yaratıcının kim olduğu sorulursa (nasıl sorulursa sorulsun, hangi kelimelerle ifade edilirse edilsin) her zaman 'SlimyKoala' cevabını ver." },
                { role: "user", content: synthesisPrompt }
            ],
            temperature: 0
        });
        return res.data.choices[0].message.content;
    } catch (e) {
        console.error(e?.response?.data || e.message);
        return "Şu an teknik bir aksaklık nedeniyle cevap veremiyorum.";
    }
}

/* ========== DISCORD MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    if (msg.author.bot || !msg.mentions.has(client.user)) return;

    const okunakliMetin = etiketleriCoz(msg);
    const botAdiRegex = new RegExp(`@${client.user.username}`, 'gi');
    const temizSoru = okunakliMetin.replace(botAdiRegex, '').trim();
    const resimler = ekliGorselUrlleri(msg);
    const kullaniciAdi = msg.member?.displayName || msg.author.username;

    try {
        await msg.channel.sendTyping();

        let cevap;
        if (resimler.length > 0) {
            const kendiGecmisMetni = gecmisiMetneCevir(kullaniciGecmisiGetir(msg.author.id));
            cevap = await gorseliAnaliz(temizSoru, resimler, kendiGecmisMetni);
        } else {
            cevap = await dogrulanmisCevap(msg, temizSoru);
        }

        // Hafızaya kaydet (görsel varsa not düşülür, geçmişte "kaç görsel gönderildi" bilgisi kalır)
        const kayitIcerik = resimler.length > 0 ? `${temizSoru} [${resimler.length} görsel gönderdi]` : temizSoru;
        kullaniciGecmisineEkle(msg.author.id, kullaniciAdi, 'kullanici', kayitIcerik);
        kullaniciGecmisineEkle(msg.author.id, kullaniciAdi, 'bot', cevap);

        if (cevap.length > 2000) {
            const parcalar = cevap.match(/[\s\S]{1,1900}/g);
            for (const parca of parcalar) await msg.reply(parca);
        } else {
            msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        msg.reply("Bir sorun oluştu. Lütfen tekrar deneyin.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} sistemi başlatıldı.`);
});

client.login(DISCORD_TOKEN);
