const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ====== RENDER PORT ====== */
http.createServer((_, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 8080);

/* ====== CONFIG ====== */
const GROQ_KEY     = process.env.groq;
const DISCORD_TOKEN = process.env.token;
const MODEL_FAST   = 'llama-3.1-8b-instant';
const MODEL_SMART  = 'llama-3.3-70b-versatile';
const MODEL_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct';

/* ====== HAFIZA ====== */
const memory = new Map();
const MAX_HISTORY = 8;
const tmpDir = '/tmp/batubot';
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

/* ======================================================
   GROQ YARDIMCI
====================================================== */
async function groq(messages, opts = {}) {
    const { model = MODEL_SMART, temperature = 0.7, max_tokens = 900 } = opts;
    const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model, messages, temperature, max_tokens },
        {
            headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
            timeout: 35000,
        }
    );
    return res.data.choices[0].message.content.trim();
}

/* ======================================================
   GÖRSEL OKUMA — Groq Vision (llama-4-scout)
   URL veya base64 ile çalışır, tamamen ücretsiz
====================================================== */
async function gorselOku(imageUrl, soru) {
    try {
        // URL'den base64'e çevir
        const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
        const mime = imgRes.headers['content-type'] || 'image/jpeg';
        const b64  = Buffer.from(imgRes.data).toString('base64');

        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: MODEL_VISION,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
                        { type: 'text', text: soru || 'Bu görseli Türkçe açıkla.' }
                    ]
                }],
                max_tokens: 800,
            },
            {
                headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
                timeout: 40000,
            }
        );
        return res.data.choices[0].message.content.trim();
    } catch (e) {
        console.log(`⚠️ Vision hatası: ${e.message}`);
        return null;
    }
}

/* ======================================================
   WEB ARAMA — Kendi yazdığım DuckDuckGo scraper
   Hiçbir key/auth gerektirmez
====================================================== */
async function webAra(sorgu, maxSonuc = 5) {
    // Yöntem 1: DuckDuckGo HTML
    try {
        const res = await axios.post(
            'https://html.duckduckgo.com/html/',
            `q=${encodeURIComponent(sorgu)}&kl=tr-tr`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept-Language': 'tr-TR,tr;q=0.9',
                },
                timeout: 12000,
            }
        );
        const html = res.data;
        const sonuclar = [];
        const re = /<a[^>]+class="result__a"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html)) !== null && sonuclar.length < maxSonuc) {
            const baslik  = m[1].replace(/<[^>]*>/g, '').trim();
            const snippet = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            if (baslik.length > 3 && snippet.length > 10) {
                sonuclar.push(`• ${baslik}: ${snippet}`);
            }
        }
        if (sonuclar.length > 0) {
            console.log(`🔍 DDG HTML: ${sonuclar.length} sonuç`);
            return sonuclar.join('\n');
        }
    } catch (e) { console.log(`DDG HTML: ${e.message}`); }

    // Yöntem 2: DuckDuckGo Instant Answer
    try {
        const res = await axios.get('https://api.duckduckgo.com/', {
            params: { q: sorgu, format: 'json', no_html: 1, skip_disambig: 1 },
            headers: { 'User-Agent': 'BatuBot/1.0' },
            timeout: 8000,
        });
        const d = res.data;
        const parcalar = [];
        if (d.AbstractText) parcalar.push(d.AbstractText);
        if (d.Answer)       parcalar.push(d.Answer);
        (d.RelatedTopics || []).slice(0, 3).forEach(t => { if (t.Text) parcalar.push(t.Text); });
        if (parcalar.length > 0) {
            console.log(`🔍 DDG Instant: ${parcalar.length} parça`);
            return parcalar.join('\n');
        }
    } catch (e) { console.log(`DDG Instant: ${e.message}`); }

    // Yöntem 3: Wikipedia özet API
    try {
        for (const lang of ['tr', 'en']) {
            const s = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
                params: { action: 'query', list: 'search', srsearch: sorgu, srlimit: 2, format: 'json', origin: '*' },
                timeout: 6000,
            });
            const sayfalar = s.data?.query?.search || [];
            const sonuclar = [];
            for (const sayfa of sayfalar) {
                try {
                    const oz = await axios.get(
                        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sayfa.title)}`,
                        { timeout: 5000 }
                    );
                    if (oz.data.extract) sonuclar.push(`${oz.data.title}: ${oz.data.extract.slice(0, 500)}`);
                } catch {}
            }
            if (sonuclar.length > 0) {
                console.log(`🔍 Wikipedia (${lang})`);
                return sonuclar.join('\n\n');
            }
        }
    } catch (e) { console.log(`Wikipedia: ${e.message}`); }

    return '';
}

/* ======================================================
   HABER — Birden fazla RSS kaynağı, kendi XML parser
====================================================== */
async function haberCek(konu) {
    const kaynaklar = [
        'https://www.ntv.com.tr/son-dakika.rss',
        'https://feeds.bbci.co.uk/turkish/rss.xml',
        'https://www.sozcu.com.tr/rss/son-dakika.xml',
        'https://www.hurriyet.com.tr/rss/anasayfa',
    ];

    for (const url of kaynaklar) {
        try {
            const res = await axios.get(url, {
                headers: { 'User-Agent': 'BatuBot/1.0', 'Accept': 'application/rss+xml,text/xml,*/*' },
                timeout: 8000,
            });
            const xml = res.data;
            const haberler = [];

            // Basit XML parser — <item> bloklarını çek
            const itemRe = /<item>([\s\S]*?)<\/item>/gi;
            let item;
            while ((item = itemRe.exec(xml)) !== null && haberler.length < 6) {
                const blok   = item[1];
                const titleM = blok.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/s);
                const descM  = blok.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/s);
                const baslik  = (titleM?.[1] || titleM?.[2] || '').replace(/<[^>]*>/g,'').trim();
                const acikl   = (descM?.[1]  || descM?.[2]  || '').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,200);
                if (baslik.length > 5) haberler.push(`• ${baslik}${acikl ? ': ' + acikl : ''}`);
            }

            // Konuya göre filtrele (varsa)
            if (haberler.length > 0) {
                const konuKelime = konu.toLowerCase().replace(/ğ/g,'g').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ü/g,'u');
                const filtreli = haberler.filter(h => h.toLowerCase().includes(konuKelime.split(' ')[0]));
                const final = filtreli.length > 0 ? filtreli : haberler;
                console.log(`📰 RSS (${url.split('/')[2]}): ${final.length} haber`);
                return final.slice(0, 5).join('\n');
            }
        } catch (e) { console.log(`RSS ${url.split('/')[2]}: ${e.message}`); }
    }
    return '';
}

/* ======================================================
   HAVA DURUMU — Open-Meteo (tamamen ücretsiz)
====================================================== */
async function getHavaDurumu(sehir) {
    try {
        const geo = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
            params: { name: sehir, count: 1, language: 'tr', format: 'json' },
            timeout: 6000,
        });
        if (!geo.data.results?.length) return null;
        const { latitude, longitude, name, country } = geo.data.results[0];

        const w = await axios.get('https://api.open-meteo.com/v1/forecast', {
            params: {
                latitude, longitude,
                current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min',
                timezone: 'auto', forecast_days: 3,
            },
            timeout: 6000,
        });

        const c = w.data.current, d = w.data.daily;
        const kod = {
            0:'Açık ☀️', 1:'Az bulutlu 🌤️', 2:'Parçalı ⛅', 3:'Kapalı ☁️',
            45:'Sisli 🌫️', 51:'Çisenti 🌦️', 61:'Yağmur 🌧️', 63:'Yağmur 🌧️',
            65:'Şiddetli yağmur 🌧️', 71:'Kar 🌨️', 73:'Kar 🌨️', 75:'Yoğun kar ❄️',
            80:'Sağanak 🌦️', 95:'Fırtına ⛈️', 96:'Dolu ⛈️',
        };

        return {
            sehir: name, ulke: country,
            sicaklik: Math.round(c.temperature_2m),
            hissedilen: Math.round(c.apparent_temperature),
            nem: c.relative_humidity_2m,
            ruzgar: Math.round(c.wind_speed_10m),
            durum: kod[c.weather_code] || '?',
            gunluk: d.temperature_2m_max.map((max, i) => ({
                max: Math.round(max),
                min: Math.round(d.temperature_2m_min[i]),
                durum: kod[d.weather_code[i]] || '?',
            })).slice(0, 3),
        };
    } catch (e) {
        console.log(`⚠️ Hava: ${e.message}`);
        return null;
    }
}

/* ======================================================
   VİDEO OLUŞTURMA — Sıfırdan BMP frame + AVI container
   ffmpeg veya başka araç gerektirmez, pure JS/Node
====================================================== */
function metniVideoYap(metin, ciktiDosya) {
    // Çok basit 320x240 AVI oluştur (solid renkli frame + metin encode edilmiş başlık)
    // Gerçek video rendering için canvas kütüphanesi gerekir
    // Burada basit bir "text frame" BMP oluşturup raw AVI paketliyoruz

    const W = 320, H = 240;
    const fps = 1;
    const sureSaniye = Math.min(10, Math.ceil(metin.length / 50));
    const kareSayisi = fps * sureSaniye;

    // BMP dosyası oluştur (24-bit, W x H, tek renk + header)
    function bmplBuf(r, g, b) {
        const rowSize = W * 3;
        const padded  = Math.ceil(rowSize / 4) * 4;
        const pixData = padded * H;
        const fileSize = 54 + pixData;
        const buf = Buffer.alloc(fileSize, 0);

        // BMP Header
        buf.write('BM', 0);
        buf.writeUInt32LE(fileSize, 2);
        buf.writeUInt32LE(54, 10);
        // DIB Header
        buf.writeUInt32LE(40, 14);
        buf.writeInt32LE(W, 18);
        buf.writeInt32LE(-H, 22); // top-down
        buf.writeUInt16LE(1, 26);
        buf.writeUInt16LE(24, 28);
        buf.writeUInt32LE(0, 30);
        buf.writeUInt32LE(pixData, 34);

        // Piksel verisi
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const off = 54 + y * padded + x * 3;
                buf[off]     = b;
                buf[off + 1] = g;
                buf[off + 2] = r;
            }
        }
        return buf;
    }

    // Basit AVI RIFF container oluştur
    function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
    function str4(s)  { return Buffer.from(s.slice(0, 4).padEnd(4, ' ')); }

    const frame = bmplBuf(30, 30, 60); // koyu mavi arka plan
    const frameData = frame.slice(54); // piksel verisi (BMP header'sız)

    const frames = [];
    for (let i = 0; i < kareSayisi; i++) frames.push(frameData);

    const frameChunks = frames.map(f => {
        const chunk = Buffer.concat([str4('00dc'), u32le(f.length), f]);
        return chunk;
    });

    const moviData  = Buffer.concat(frameChunks);
    const moviChunk = Buffer.concat([str4('LIST'), u32le(4 + moviData.length), str4('movi'), moviData]);

    const strh = Buffer.concat([
        str4('strh'), u32le(56),
        str4('vids'), str4('DIB '),
        u32le(0), u32le(0), u32le(0),
        u32le(1), u32le(fps),
        u32le(0), u32le(kareSayisi),
        u32le(0), u32le(0),
        Buffer.alloc(24, 0),
    ]);

    const strf = Buffer.concat([
        str4('strf'), u32le(40),
        u32le(40), u32le(W), u32le(H),
        Buffer.from([1,0,24,0]),
        u32le(0), u32le(frameData.length),
        u32le(0), u32le(0), u32le(0), u32le(0),
    ]);

    const strl = Buffer.concat([str4('LIST'), u32le(4 + strh.length + strf.length), str4('strl'), strh, strf]);

    const avih = Buffer.concat([
        str4('avih'), u32le(56),
        u32le(Math.round(1000000 / fps)),
        u32le(frameData.length * fps),
        u32le(0), u32le(0x10),
        u32le(kareSayisi), u32le(0),
        u32le(1), u32le(0),
        u32le(W), u32le(H),
        Buffer.alloc(16, 0),
    ]);

    const hdrl = Buffer.concat([str4('LIST'), u32le(4 + avih.length + strl.length), str4('hdrl'), avih, strl]);
    const riffData = Buffer.concat([str4('AVI '), hdrl, moviChunk]);
    const riff     = Buffer.concat([str4('RIFF'), u32le(riffData.length), riffData]);

    fs.writeFileSync(ciktiDosya, riff);
    return ciktiDosya;
}

/* ======================================================
   KARAR VERİCİ — llama-8b ile JSON
====================================================== */
async function kararVer(soru, gecmisMetin) {
    const p = `Kullanıcı mesajını analiz et. SADECE JSON döndür.

Format: {"action":"...","query":"...","city":"...","gorsel":false}

action:
- "chat"    → sohbet, selamlama, kişisel soru
- "search"  → güncel bilgi, maç, fiyat, kur, transfer, haber, olay, genel bilgi sorusu
- "news"    → haber, son dakika, gündem
- "weather" → hava durumu (city: şehir adı İngilizce)
- "video"   → video oluştur isteği
- "insult"  → küfür/hakaret

gorsel: true → mesajda resim/görsel analizi isteniyor

Şüphe → "search". query: Türkçe arama sorgusu.

Önceki: ${gecmisMetin || '(yok)'}
Mesaj: ${soru}`;

    try {
        const y = await groq([{ role: 'user', content: p }], { model: MODEL_FAST, temperature: 0.1, max_tokens: 80 });
        const m = y.match(/\{[\s\S]*?\}/);
        if (!m) return { action: 'chat' };
        const k = JSON.parse(m[0]);
        console.log(`🤔 ${JSON.stringify(k)}`);
        return k;
    } catch (e) {
        return { action: 'chat' };
    }
}

/* ====== KÜFÜR ====== */
const KUFURLER = ['amk','amina','orospu','sik','got','bok','yarrak','pic',
    'kahpe','pezevenk','yavsak','serefsiz','amcik','gavat','siktir','keko','gerzek'];
function kufurVarMi(t) {
    const k = t.toLowerCase().replace(/ı/g,'i').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ö/g,'o').replace(/ü/g,'u');
    return KUFURLER.some(w => k.includes(w));
}

/* ====== DİL TEMİZLE ====== */
function temizle(t) {
    const y = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff\u0590-\u05ff]/g;
    const c = t.replace(y,'');
    return c.trim().length < 3 ? t : c;
}

/* ======================================================
   ANA CEVAP FONKSİYONU
====================================================== */
async function cevapUret(userId, soru, ekler) {
    const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const gecmis = memory.get(userId) || [];
    const gecmisM = gecmis.slice(-3).map(h => `K:${h.user} B:${h.bot}`).join(' | ');

    const kufurlu = kufurVarMi(soru);
    let action, aramaV = '', haberV = '', havaV = null, videoV = null, gorselV = null;
    let karar = { action: 'chat' };

    if (kufurlu) {
        action = 'insult';
    } else {
        karar  = await kararVer(soru, gecmisM);
        action = karar.action || 'chat';

        // Görsel varsa oku
        if (ekler && ekler.length > 0) {
            const resimEk = ekler.find(a => a.contentType?.startsWith('image'));
            if (resimEk) {
                gorselV = await gorselOku(resimEk.url, soru);
                if (gorselV) action = 'gorsel';
            }
        }

        if (action === 'search') {
            aramaV = await webAra(karar.query || soru);
        } else if (action === 'news') {
            haberV = await haberCek(karar.query || soru);
            if (!haberV) aramaV = await webAra((karar.query || soru) + ' son dakika haber');
        } else if (action === 'weather') {
            havaV = await getHavaDurumu(karar.city || 'Istanbul');
        } else if (action === 'video') {
            const videoYolu = path.join(tmpDir, `video_${Date.now()}.avi`);
            metniVideoYap(soru, videoYolu);
            videoV = videoYolu;
        }
    }

    let sistem, kullanici;

    if (action === 'insult') {
        sistem    = 'Kısa, esprili Türkçe geri laf sok (1-2 cümle). Başka hiçbir şey yazma.';
        kullanici = `"${soru}"`;

    } else if (action === 'gorsel') {
        sistem    = 'Discord bot olarak görseli anlat ve kullanıcının sorusunu yanıtla. Kısa ve net. Türkçe.';
        kullanici = `Görsel analizi: ${gorselV}\nKullanıcı sorusu: ${soru}`;

    } else if (action === 'weather' && havaV) {
        sistem    = 'Hava verisini doğal Türkçe ile sun. Emoji kullan. Sadece hava bilgisi ver.';
        kullanici = `${tarih} | ${havaV.sehir}, ${havaV.ulke}: ${havaV.sicaklik}°C (hissedilen ${havaV.hissedilen}°C), Nem %${havaV.nem}, Rüzgar ${havaV.ruzgar}km/s, ${havaV.durum}. 3 gün: ${havaV.gunluk.map((g,i)=>`Gün${i+1}: ${g.max}/${g.min}°C ${g.durum}`).join(', ')}`;

    } else if (action === 'news' || (action === 'search' && (haberV || aramaV))) {
        const veri = haberV || aramaV;
        sistem    = `Discord bot. Web/haber verilerini kullanarak soruyu yanıtla. Net, kısa (3-5 cümle). Veri yetersizse "Tam bilgiye ulaşamadım ama..." de. Türkçe.`;
        kullanici = [`Tarih: ${tarih}`, gecmisM ? `Önceki: ${gecmisM}` : '', veri ? `Veri:\n${veri}` : 'Veri yok.', `Soru: ${soru}`].filter(Boolean).join('\n\n');

    } else if (action === 'search') {
        sistem    = `Discord bot. Soruyu en iyi bilginle yanıtla. Türkçe.`;
        kullanici = [`Tarih: ${tarih}`, gecmisM ? `Önceki: ${gecmisM}` : '', `Soru: ${soru}`].filter(Boolean).join('\n\n');

    } else {
        sistem    = `Discord bot. Samimi, esprili, kısa (1-3 cümle). Soru varsa önce yanıtla. Düzeltme gelirse kabul et. Türkçe.`;
        kullanici = [`Tarih: ${tarih}`, gecmisM ? `Önceki: ${gecmisM}` : '', `Kullanıcı: ${soru}`].filter(Boolean).join('\n\n');
    }

    try {
        let cevap = await groq(
            [{ role: 'system', content: sistem }, { role: 'user', content: kullanici }],
            { model: MODEL_SMART, temperature: 0.75, max_tokens: 700 }
        );
        cevap = temizle(cevap);
        if (!cevap || cevap.length < 2) cevap = 'Anlayamadım, tekrar yazar mısın? 🤔';

        const yeni = [...gecmis, { user: soru, bot: cevap }];
        if (yeni.length > MAX_HISTORY) yeni.shift();
        memory.set(userId, yeni);

        return { metin: cevap, video: videoV };
    } catch (e) {
        console.error('❌ Groq:', e.message);
        return { metin: '⚠️ Bir sorun oluştu, lütfen tekrar dene.', video: null };
    }
}

/* ====== MESAJ BÖLÜCÜ ====== */
function bol(metin, limit = 1950) {
    if (metin.length <= limit) return [metin];
    const p = []; let k = metin;
    while (k.length > 0) {
        let kes = limit;
        const sp = k.lastIndexOf('\n\n', limit); if (sp > limit * 0.6) kes = sp;
        else { const ss = k.lastIndexOf('\n', limit); if (ss > limit * 0.6) kes = ss; }
        p.push(k.slice(0, kes).trim()); k = k.slice(kes).trim();
    }
    return p;
}

/* ====== GÜVENLİ GÖNDER ====== */
async function gonder(msg, metin, ilk = true, dosya = null) {
    const opts = { allowedMentions: { repliedUser: false } };
    if (dosya) opts.files = [new AttachmentBuilder(dosya)];
    try {
        if (ilk) await msg.reply({ content: metin, ...opts });
        else     await msg.channel.send({ content: metin, ...opts });
    } catch (err) {
        if (err.code === 50013) {
            try { await msg.author.send(metin); } catch {}
        }
    }
}

/* ====== DISCORD ====== */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('messageCreate', async msg => {
    if (msg.author.bot || msg.mentions.everyone || !msg.mentions.has(client.user)) return;

    const soru = msg.content.replace(/<@!?\d+>/g, '').trim();
    if (!soru && msg.attachments.size === 0) return gonder(msg, 'Ne sormak istiyorsun? 🤖');

    const ekler = [...msg.attachments.values()];

    msg.channel.sendTyping().catch(() => {});
    const ti = setInterval(() => msg.channel.sendTyping().catch(() => {}), 8000);

    try {
        const { metin, video } = await cevapUret(msg.author.id, soru || 'Bu görseli açıkla.', ekler);
        clearInterval(ti);

        const parcalar = bol(metin);
        for (let i = 0; i < parcalar.length; i++) {
            // Video varsa son parçayla birlikte gönder
            const dosya = (i === parcalar.length - 1 && video) ? video : null;
            await gonder(msg, parcalar[i], i === 0, dosya);
        }

        // Video dosyasını temizle
        if (video && fs.existsSync(video)) {
            setTimeout(() => { try { fs.unlinkSync(video); } catch {} }, 5000);
        }
    } catch (err) {
        clearInterval(ti);
        await gonder(msg, '⚠️ Bir sorun oluştu, lütfen tekrar dene.');
    }
});

client.once('ready', c => {
    console.log(`✅ ${c.user.tag} hazır`);
    console.log(`🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
});

process.on('unhandledRejection', e => console.error('🔥', e?.message || e));

client.login(DISCORD_TOKEN);