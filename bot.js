const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

// ──────────────────────────────
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createBot() {
    console.log('--- [Sistem] Bot Başlatılıyor ---');

    const bot = mineflayer.createBot({
        host: 'play.reborncraft.pw',
        port: 25565,
        username: 'Xkakashi',
        version: '1.21'
    });

    bot.loadPlugin(pathfinder);

    let isSelling = false;
    let systemsStarted = false;
    let spawnProcessed = false;

    // ──────────────────────────────
    //    GİRİŞ KISMI (değişmedi)
    // ──────────────────────────────
    async function performLoginSequence() {
        if (systemsStarted) return;

        console.log('[→] Login sırası başlatılıyor...');

        try {
            await sleep(12000);
            bot.chat(`/login ${process.env.SIFRE}`);
            console.log('[→] /login gönderildi');

            await sleep(12000);
            bot.chat('/skyblock');
            console.log('[→] /skyblock gönderildi');

            await sleep(12000);
            bot.chat('/warp Yoncatarla');
            console.log('[→] /warp Yoncatarla gönderildi');

            await sleep(18000);

            console.log('[!] Sistemler aktif ediliyor...');
            systemsStarted = true;
            startSystems();

        } catch (err) {
            console.log('[!] Giriş sırasında hata:', err.message);
        }
    }

    bot.on('spawn', () => {
        console.log('[!] Bot spawn oldu.');

        if (spawnProcessed) {
            console.log('[!] Spawn zaten işlendi, yoksayılıyor.');
            return;
        }

        spawnProcessed = true;
        performLoginSequence();
    });

    function startSystems() {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);

        movements.canDig = true;
        movements.canJump = true;
        movements.allowSprinting = true;
        movements.allowParkour = true;
        movements.allow1by1 = true;
        movements.maxDropDown = 5;          // biraz daha artırdım

        bot.pathfinder.setMovements(movements);

        console.log('[✓] Hasat ve satış sistemleri başlatıldı.');

        continuousHarvestAndMoveLoop();
        sellLoop();
    }

    // ───────────────────────────────────────────────
    //   Küçük rastgele kayma hareketi (eksikti, ekliyoruz)
    // ───────────────────────────────────────────────
    async function randomSmallOffset() {
        const dx = Math.random() * 5 - 2.5;
        const dz = Math.random() * 5 - 2.5;

        try {
            await bot.pathfinder.goto(
                new goals.GoalNear(
                    Math.round(bot.entity.position.x + dx),
                    Math.round(bot.entity.position.y),
                    Math.round(bot.entity.position.z + dz),
                    1.8
                ),
                { timeout: 7000 }
            );
        } catch {
            // sessiz geç
        }
    }

    // ───────────────────────────────────────────────
    //   ÇOK HIZLI HASAT – ALAN TARAMA + YOLDA ÇOK KIRMA
    // ───────────────────────────────────────────────
  ───────────────────────────────────────────────
// ───────────────────────────────────────────────
//   ENVANTERDEKİ HERHANGİ BİR BLOĞU KULLANARAK 9×9 (ORTA BOŞ)
//   Blok ismine bakmıyor, bulduğu ilk uygun stack'i kullanıyor
// ───────────────────────────────────────────────

async function build9x9AnyBlock() {
    if (isSelling) {
        console.log("[build] Satış aktif, yapı iptal");
        return;
    }

    console.log("[build] Envanterdeki herhangi blokla 9×9 başlıyor (ortası boş)");

    let platformCount = 0;
    let totalPlaced = 0;

    while (true) {
        // Envanterden yerleştirilebilir stacklenebilir bir şey bul
        const placeableItem = bot.inventory.items().find(item => 
            item.stackable &&                  // stacklenebilen olmalı
            item.count >= 1 &&
            !item.name.includes("sword") &&
            !item.name.includes("pickaxe") &&
            !item.name.includes("axe") &&
            !item.name.includes("shovel") &&
            !item.name.includes("hoe") &&
            !item.name.includes("helmet") &&
            !item.name.includes("chestplate") &&
            !item.name.includes("leggings") &&
            !item.name.includes("boots") &&
            !item.name.includes("wheat") &&        // tarım ürünü olmasın
            !item.name.includes("seeds") &&
            item.name !== "air" &&
            item.name !== "water_bucket" &&
            item.name !== "lava_bucket"
        );

        if (!placeableItem) {
            console.log("[build] Yerleştirilebilir blok kalmadı → bitiyor");
            bot.chat("Envanterde uygun blok kalmadı!");
            break;
        }

        const material = placeableItem.name;
        console.log(`[#${platformCount + 1}] Kullanılan blok: \( {material} ( \){placeableItem.count} adet)`);

        const startX = Math.floor(bot.entity.position.x) - 4;
        const startZ = Math.floor(bot.entity.position.z) - 4;
        const yLevel  = Math.floor(bot.entity.position.y) - 1;

        let placedThisPlatform = 0;

        for (let dx = -4; dx <= 4; dx++) {
            for (let dz = -4; dz <= 4; dz++) {
                if (dx === 0 && dz === 0) continue; // merkez boş kalacak

                const px = startX + dx;
                const pz = startZ + dz;
                const targetPos = new Vec3(px, yLevel, pz);

                const currentBlock = bot.blockAt(targetPos);
                if (currentBlock.name !== "air" && currentBlock.name !== "cave_air") {
                    continue;
                }

                // altında destek var mı?
                const belowPos = targetPos.offset(0, -1, 0);
                const belowBlock = bot.blockAt(belowPos);
                if (belowBlock.name === "air" || belowBlock.name === "cave_air") {
                    continue;
                }

                // eline al
                let toPlace = bot.inventory.findInventoryItem(material, null, false);
                if (!toPlace) break; // bitti

                try {
                    await bot.equip(toPlace, "hand");

                    await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
                    await sleep(50 + Math.random() * 50);  // 50-100 ms → hız + kick koruması

                    await bot.placeBlock(belowBlock, new Vec3(0, 1, 0));

                    placedThisPlatform++;
                    totalPlaced++;

                } catch (err) {
                    // çoğu hata sessiz geçilir (yer yok, açı kötü vs.)
                }

                // her 8 blokta bir kontrol
                if (placedThisPlatform % 8 === 0) {
                    if (!bot.inventory.findInventoryItem(material, null, false)) {
                        break;
                    }
                }
            }
        }

        platformCount++;
        console.log(`Platform ${platformCount} → ${placedThisPlatform} blok • Toplam: ${totalPlaced}`);

        if (placedThisPlatform < 30) {  // çok az koyduysa ya alan dolu ya da envanter bitti
            console.log("[build] Bu platformda yeterli blok koyulamadı → muhtemelen bitiş");
            break;
        }

        // Bir sonraki alana git (X yönünde +19 blok kaydır → 9 blok + 10 boşluk)
        try {
            const nextX = bot.entity.position.x + 19;
            await bot.pathfinder.goto(
                new goals.GoalNear(nextX, bot.entity.position.y, bot.entity.position.z, 3),
                { timeout: 12000 }
            );
            await sleep(800);  // biraz nefes alsın
        } catch (e) {
            console.log("[build] Alan kaydırma başarısız, devam ediliyor");
        }
    }

    console.log(`[build BİTTİ] ${platformCount} platform • ${totalPlaced} blok`);
    bot.chat(`Tamamlandı → \( {platformCount} adet 9×9 ( \){totalPlaced} blok)`);
}

// Chat ile başlatma örneği
bot.on('chat', (username, message) => {
    if (username === bot.username) return;

    const msg = message.toLowerCase();
    if (msg === "yap" || msg === "blokyap" || msg === "9x9") {
        build9x9AnyBlock();
    }
});

    bot.on('end', reason => {
        console.log(`[!] Bağlantı kesildi: ${reason}`);
        systemsStarted = false;
        spawnProcessed = false;
        setTimeout(createBot, 14000);
    });

    bot.on('kicked', reason => {
        console.log('[ATILDI]', JSON.stringify(reason, null, 2));
    });

    bot.on('error', err => {
        console.log('[HATA]', err.message);
    });
}

createBot();