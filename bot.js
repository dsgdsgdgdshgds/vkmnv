const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const http = require('http');

/* ====== RENDER/PORT AYARI ====== */
http.createServer((req, res) => {
    res.write("Bot Calisiyor!");
    res.end();
}).listen(8080 || process.env.PORT);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/* ====== API AYARLARI ====== */
const GROQ_API_KEY = process.env.API;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SERPER_API_KEY = "d5b0d101f822182dd67294e6612b511eb1c797bd";

/* ====== SOHBET GEÇMİŞİ (HAFIZA) ====== */
const userContexts = new Map(); // userId → [{user: soru, bot: cevap}, ...]

/* 1. ADIM: Araştırma planı (daha güçlü model + katı format) */
async function arastirmaPlaniHazirla(soru) {
    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: `Sen bir araştırma planlama uzmanısın.
Kullanıcının sorusunu cevaplamak için Google'da aranması gereken EN KRİTİK, EN GÜNCEL ve EN TEKNİK 4-6 alt arama terimini üret.

KURALLAR:
- Her satıra SADECE tek bir arama terimi yaz (başka hiçbir şey yazma)
- Terimler mutlaka Türkçe olsun
- Sayısal/tarih içeren konularda mutlaka yıl ekle (ör: 2026)
- Çelişki riski varsa farklı bakış açılarını kapsa
- Açıklama, numara, tire vs. kullanma — sadece düz arama sorguları

Örnek çıktı:
Arka Sokaklar toplam bölüm sayısı 2026
Arka Sokaklar son bölüm numarası ocak 2026
Arka Sokaklar wikipedia bölüm listesi güncel
Kanal D Arka Sokaklar son bölüm yayın tarihi`
                    },
                    { role: "user", content: soru }
                ],
                temperature: 0.05,
                max_tokens: 180
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const content = res.data.choices[0].message.content.trim();
        const terimler = content.split("\n")
            .map(s => s.trim())
            .filter(s => s.length >= 8 && !s.startsWith("Örnek") && !s.includes("Kurallar"));

        return terimler.length >= 2 ? terimler : [soru];
    } catch (e) {
        console.error("Planlama hatası:", e.message);
        return [soru];
    }
}

/* 2. ADIM: Her terim için ayrı arama + kısa LLM özetleme */
async function veriToplaVeGuvenilirlestir(altSorular) {
    let tumKaynaklar = [];

    for (const altSoru of altSorular.slice(0, 6)) {
        try {
            const res = await axios.post(
                "https://google.serper.dev/search",
                { q: altSoru, gl: "tr", hl: "tr", num: 8 },
                { headers: { "X-API-KEY": SERPER_API_KEY }, timeout: 8000 }
            );

            if (res.data?.organic?.length > 0) {
                const enIyiSonuclar = res.data.organic
                    .slice(0, 7)
                    .filter(r => r.snippet && r.snippet.length > 40)
                    .map(r => `${r.title} | ${r.link} → ${r.snippet}`);

                if (enIyiSonuclar.length > 0) {
                    // Küçük modelle özetlet (hızlı ve ucuz)
                    const ozetRes = await axios.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        {
                            model: "llama-3.1-8b-instant",
                            messages: [
                                {
                                    role: "system",
                                    content: "Verilen snippet'lardan EN GÜNCEL ve EN TUTARLI bilgiyi 3-5 cümlede özetle. Kaynak belirtme. Sadece gerçek bilgi ver, tahmin yapma."
                                },
                                { role: "user", content: enIyiSonuclar.join("\n---\n") }
                            ],
                            temperature: 0.0,
                            max_tokens: 180
                        },
                        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
                    );

                    const ozet = ozetRes.data.choices[0].message.content.trim();
                    tumKaynaklar.push(`Arama: ${altSoru}\nÖzet: ${ozet}\nKaynaklar: ${res.data.organic.slice(0,3).map(r=>r.link).join(", ")}`);
                }
            }
        } catch (e) {
            console.log(`Arama başarısız → ${altSoru}`);
        }
    }

    return tumKaynaklar.join("\n\n────────────────────\n\n");
}

/* 3. ADIM: Katı kurallı sentez */
async function dogrulanmisCevap(userId, soru) {
    const simdi = new Date();
    const tarihBilgisi = simdi.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const plan = await arastirmaPlaniHazirla(soru);
    const hamBilgi = await veriToplaVeGuvenilirlestir(plan);

    let history = userContexts.get(userId) || [];
    let historyText = history.slice(-4).map(h => `Kullanıcı: ${h.user}\nBot: ${h.bot}`).join("\n─────\n");

    const synthesisPrompt = `
GÜNCEL TARİH: ${tarihBilgisi}

ÖNCEKİ KONUŞMA GEÇMİŞİ (son 4 mesaj):
${historyText || "Henüz yok"}

KATı KURALLAR — BUNLARA %100 UY:
1. YALNIZCA aşağıda verilen özetlere dayan. Dışarıdan bilgi/tahmin EKLEME.
2. Çelişki varsa → en güncel tarihli / resmi kaynağa (wikipedia, kanald.com.tr, haber siteleri) öncelik ver ve çelişkiyi mutlaka belirt.
3. Sayısal cevap isteniyorsa → hesaplama/adım adım mantığı kısa açıkla.
4. Veri yetersiz/çelişkiliyse → "Elimdeki verilere göre kesin cevap veremiyorum. Şu kaynaklara bakılabilir: ..." de.
5. Cevabın başında kısa kaynak özeti ver (ör: Kanal D resmi sitesi, Vikipedi, son haberler).
6. Cevabı doğal, akıcı Türkçe ver. İç düşünce/hesaplama adımlarını kullanıcıya gösterme.

VERİLER:
────────────────────
${hamBilgi || "Hiç veri toplanamadı."}
────────────────────

KULLANICI SORUSU: ${soru}

CEVAP:
`;

    try {
        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "Sen yalnızca verilen verilere dayalı, halüsinasyonsuz, matematiksel olarak tutarlı bir bilgi doğrulayıcısısın." },
                    { role: "user", content: synthesisPrompt }
                ],
                temperature: 0.0,
                max_tokens: 1200
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        let botCevap = res.data.choices[0].message.content.trim();

        // Güvenlik: çok uzun cevapları parçala
        if (botCevap.length > 1800) {
            botCevap = botCevap.substring(0, 1750) + "\n... (devamı için soruyu biraz daha daraltabilir misin?)";
        }

        // Hafızayı güncelle (son 5 tut)
        history.push({ user: soru, bot: botCevap });
        if (history.length > 5) history.shift();
        userContexts.set(userId, history);

        return botCevap;
    } catch (e) {
        console.error("Sentez hatası:", e.message);
        return "Şu an teknik bir sorun var, lütfen biraz sonra tekrar dene.";
    }
}

/* ========== MESAJ DİNLEYİCİ ========== */
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;

    const temizSoru = msg.content.replace(/<@!?[^>]+>/g, "").trim();
    if (!temizSoru) return;

    try {
        await msg.channel.sendTyping();
        const cevap = await dogrulanmisCevap(msg.author.id, temizSoru);

        if (cevap.length > 2000) {
            const chunks = cevap.match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
                await msg.reply(chunk);
            }
        } else {
            await msg.reply(cevap);
        }
    } catch (err) {
        console.error(err);
        await msg.reply("Bir hata oluştu, lütfen tekrar dene.");
    }
});

client.once("ready", () => {
    console.log(`✅ ${client.user.tag} aktif — ${new Date().toLocaleString('tr-TR')}`);
    console.log("Geliştirici: Batuhan Aktaş");
});

client.login(DISCORD_TOKEN).catch(err => {
    console.error("Login başarısız:", err);
});