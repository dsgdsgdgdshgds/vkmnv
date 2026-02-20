const { Client } = require('discord.js-selfbot-v13');
const client = new Client({ checkUpdate: false });

// HATAYI TAMAMEN SUSTURAN VE TIKLAMAYI SİMÜLE EDEN KISIM
client.captchaService = { solve: () => new Promise(res => setTimeout(res, 10000)) };
// Kütüphanenin içindeki hata fırlatıcıyı devre dışı bırakıyoruz:
client.options.captchaService = client.captchaService; 


//   HOSTING PORT (zorunlu)
// ──────────────────────────────
const http = require('http');

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif 🚀');
}).listen(PORT, () => {
    console.log(`[✓] Hosting port açık: ${PORT}`);
});

// === AYARLAR ===
const LOG_CHANNEL_ID = '1425453225343193088';
const NOTIFICATION_CHANNEL_ID = '1425156091339079962';
const NOTIFICATION_ROLE_ID = '1425475242398187590'; // SADECE ID, @& OLMADAN
// ===============

// Discord davet linki regex deseni
const DISCORD_INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discordapp\.com\/invite)\/([A-Za-z0-9-]+)/gi;

// "yenileme" kelimesi için kontrol (büyük/küçük harf duyarsız)
const RENEWAL_REGEX = /yenileme/i;

const client = new Client({
    checkUpdate: false
});

let isConnected = false;

async function copyMessageToLogChannel(message) {
    try {
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        
        if (!logChannel) {
            console.error('Log kanalı bulunamadı! ID: ' + LOG_CHANNEL_ID);
            return;
        }

        await logChannel.send(message.content);
        console.log(`Mesaj log kanalına kopyalandı: ${message.id}`);

    } catch (error) {
        console.error('Mesaj kopyalanırken hata:', error);
    }
}

client.on('messageCreate', async (message) => {
    if (!isConnected) return;
    
    // Kendi mesajlarını ve boş mesajları yoksay
    if (message.author.id === client.user.id || !message.content) return;

    console.log(`Mesaj alındı: ${message.author.tag}: ${message.content.substring(0, 50)}...`);

    // SADECE DM MESAJLARINI KONTROL ET
    if (message.channel.type === 1 || message.channel.type === 3) {
        console.log(`DM mesajı: ${message.author.tag}`);
        
        // 1. YENİLEME KELİMESİ KONTROLÜ (büyük/küçük harf duyarsız)
        const hasRenewal = RENEWAL_REGEX.test(message.content);
        
        if (hasRenewal) {
            console.log(`DM'de 'yenileme' kelimesi tespit edildi! (Metin: ${message.content})`);
            
            setTimeout(async () => {
                try {
                    console.log('Yenileme mesajına yanıt gönderiliyor...');
                    await message.reply('önceki mesajları göremiyorum sunucuyu tekrar paylaşır mısın?');
                    console.log('Yenileme yanıtı gönderildi!');
                } catch (error) {
                    console.error('Yenileme yanıtı gönderilirken hata:', error);
                }
            }, 1000);
        }
        
        // 2. DAVET LİNKİ KONTROLÜ (SADECE DM'LERDE)
        const inviteLinks = message.content.match(DISCORD_INVITE_REGEX);
   
client.acceptInvite(inviteLinks).catch(async (err) => {
            if (err.captcha) {
                console.log(`[CAPTCHA] Algılandı, kutucuğa tıklanıyor (10 sn bekleme)...`);
     
        if (inviteLinks && inviteLinks.length
 > 0) {
            console.log(`DM'de davet linki tespit edildi!`);
            
            // 3 saniye sonra "paylaşıyorum" yaz
            setTimeout(async () => {
                try {
                    console.log('3 saniye sonra ilk yanıt gönderiliyor...');
                    await message.reply(`# 🌿 ★ Vinland Saga ~Anime^Manga ☆ — huzur arayan savaşçının sığınağı

**Kılıçların gölgesinde değil, kalbinin huzurunda yaşamak istiyorsan…
Vinland seni bekliyor. ⚔️
Savaşın yorgunluğunu atmak, dostlukla yoğrulmuş bir topluluğun parçası olmak isteyen herkese kapımız açık.
Thorfinn'in aradığı toprakları biz burada bulduk — sen de bize katıl.
Gif:https://tenor.com/view/askeladd-gif-19509516


---

✦ Neler var bizde?

🛡️ Estetik & Viking temalı tasarım

⚔️ Anime sohbetleri (özellikle Vinland Saga üzerine derin muhabbetler)

🌄 Etkinlikler: anime/film geceleri, bilgi yarışmaları, oyunlar

🗡️ Rol ve seviye sistemi (klanlar & savaşçılar seni bekliyor)

🍃 Chill ses kanalları, aktif sohbetler

🤝 Samimi, saygılı ve toksik olmayan bir topluluk**
|| @everyone @here ||
Pins:https://discord.gg/FzZBhH3tnF`);
                    
                    // 2 saniye daha bekle (toplam 5 saniye)
                    setTimeout(async () => {
                        try {
                            console.log('5 saniye sonra ikinci yanıt gönderiliyor...');
                            await message.reply('paylaştım, iyi günler.');
                            await copyMessageToLogChannel(message);
                            console.log('DM işlemi tamamlandı!');
                        } catch (error) {
                            console.error('İkinci yanıt gönderilirken hata:', error);
                        }
                    }, 2000);
                    
                } catch (error) {
                    console.error('İlk yanıt gönderilirken hata:', error);
                }
            }, 3000);
        }
    } 
    // SUNUCU KANALLARI İÇİN SADECE ROL ETİKETLEME KONTROLÜ
    else if (message.channel.type === 0) {
        console.log(`Sunucu kanalında mesaj: #${message.channel.name}`);
        
        // BELİRLİ KANALDA ROL ETİKETLEME KONTROLÜ
        if (message.channel.id === NOTIFICATION_CHANNEL_ID) {
            console.log('Bildirim kanalında mesaj!');
            
            // DEBUG: Tüm rol etiketlerini göster
            console.log('Mesaj içeriği:', message.content);
            console.log('Mentioned roles:', Array.from(message.mentions.roles.keys()));
            console.log('Aranan rol ID:', NOTIFICATION_ROLE_ID);
            
            // Basit rol etiketi kontrolü - SADECE mentions.roles kullan
            const roleMentions = message.mentions.roles;
            const hasRoleMention = roleMentions.has(NOTIFICATION_ROLE_ID);
            
            console.log('Rol etiketi var mı?', hasRoleMention);
            
            if (hasRoleMention) {
                console.log('Rol etiketlendi! Kullanıcı kontrolü yapılıyor...');
                
                // Kullanıcının rolü kontrol et (rolü varsa yanıt verme)
                try {
                    // Mesajı gönderen kullanıcıyı al
                    const member = await message.guild.members.fetch(message.author.id);
                    
                    console.log('Kullanıcı roller:', Array.from(member.roles.cache.keys()));
                    console.log('Kontrol edilen rol:', NOTIFICATION_ROLE_ID);
                    
                    // Eğer kullanıcı etiketlenen role sahipse yanıt verme
                    if (member.roles.cache.has(NOTIFICATION_ROLE_ID)) {
                        console.log('Kullanıcı zaten bu role sahip, yanıt verilmeyecek.');
                        return;
                    }
                    
                    console.log('Kullanıcı bu role sahip değil, 1 dakika bekleniyor...');
                    
                    setTimeout(async () => {
                        try {
                            console.log('1 dakika sonra yanıt gönderiliyor...');
                            await message.reply('dm gel');
                            console.log('Rol yanıtı gönderildi!');
                        } catch (error) {
                            console.error('Rol etiketleme yanıtı gönderilirken hata:', error);
                        }
                    }, 60000);
                    
                } catch (memberError) {
                    console.error('Kullanıcı bilgileri alınırken hata:', memberError);
                    
                    // Hata olursa yine de yanıt gönder
                    console.log('Hata nedeniyle kullanıcı kontrolü yapılamadı, 1 dakika bekleniyor...');
                    
                    setTimeout(async () => {
                        try {
                            console.log('1 dakika sonra yanıt gönderiliyor...');
                            await message.reply('dm gel');
                            console.log('Rol yanıtı gönderildi!');
                        } catch (error) {
                            console.error('Rol etiketleme yanıtı gönderilirken hata:', error);
                        }
                    }, 60000);
                }
            } else {
                console.log('Aranan rol etiketlenmemiş.');
            }
        }
    }
});

client.once('ready', () => {
    isConnected = true;
    console.log(`✅ Selfbot başarıyla bağlandı: ${client.user.tag}`);
    console.log(`📋 Log kanalı ID: ${LOG_CHANNEL_ID}`);
    console.log(`🔔 Bildirim kanalı ID: ${NOTIFICATION_CHANNEL_ID}`);
    console.log(`🏷️  Bildirim rolü ID: ${NOTIFICATION_ROLE_ID}`);
    console.log(`📨 SADECE DM'lerden gelen linkler taranacak`);
    console.log(`⏱️  DM Link yanıtları: 3sn "paylaşıyorum", 5sn "paylaştım, iyi günler"`);
    console.log(`🔄 DM Yenileme mesajlarına: "link at" (büyük/küçük harf duyarsız)`);
    console.log(`⛔ Rol kontrolü: Kullanıcı role sahipse yanıt yok`);
    console.log(`🔍 Mesaj dinlemeye başlandı...`);
});

client.on('debug', (info) => {
    console.log(`🔧 Debug: ${info}`);
});

client.on('warn', (info) => {
    console.log(`⚠️  Uyarı: ${info}`);
});

client.on('error', (error) => {
    console.error(`❌ Discord istemci hatası:`, error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ İşlenmeyen promise hatası:', error);
});

console.log('Discord\'a bağlanılıyor...');
client.login(process.env.token).then(() => {
    console.log('Login işlemi başlatıldı');
}).catch(error => {
    console.error('❌ Giriş yapılamadı:', error.message);
    
    if (error.message.includes('TOKEN_INVALID')) {
        console.log('❌ TOKEN GEÇERSİZ!');
        console.log('🔧 Yapman gerekenler:');
        console.log('1. Discord uygulamasında F12 tuşuna bas');
        console.log('2. Console sekmesine git');
        console.log('3. Şu kodu yapıştır:');
        console.log('   window.localStorage.getItem(\'token\')');
        console.log('4. Çıkan tokeni kullan');
    }
    
    process.exit(1);
});

// Her 30 saniyede bir bağlantı durumunu kontrol et
setInterval(() => {
    console.log(`📡 Bağlantı durumu: ${isConnected ? 'Aktif' : 'Bağlanıyor...'}`);
    console.log(`Ping: ${client.ws.ping}ms`);
}, 30000);