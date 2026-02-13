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
//   9×9 ORTASI BOŞ PLATFORM YAPMA SİSTEMİ
// ───────────────────────────────────────────────

async function build9x9WithCenterHole(materialName = "soil") {
    if (isSelling) {
        console.log("[build] Satış aktif, yapı iptal");
        return;
    }

    console.log(`[build] 9×9 platform başlıyor → malzeme: ${materialName}`);

    const targetMaterial = materialName.toLowerCase();

    // Envanter kontrolü
    const available = bot.inventory.items()
        .filter(item => item.name === targetMaterial)
        .reduce((sum, item) => sum + item.count, 0);

    const needed = 9*9 - 1; // 81 - 1 = 80 blok
    if (available < needed) {
        console.log(`[build] Yetersiz ${targetMaterial}: \( {available}/ \){needed}`);
        bot.chat(`Yeterli \( {targetMaterial} yok! ( \){available}/${needed})`);
        return;
    }

    const startPos = bot.entity.position.floored().offset(0, -1, 0); // botun altındaki blok seviyesinden başlıyoruz

    let placed = 0;

    for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
            // tam merkez atlanacak
            if (dx === 0 && dz === 0) continue;

            const placePos = startPos.offset(dx, 0, dz);

            const block = bot.blockAt(placePos);
            if (block.name !== "air" && block.name !== "cave_air") {
                // zaten doluysa atla (tekrar yazma)
                continue;
            }

            try {
                // eline bloğu al
                const targetItem = bot.inventory.findInventoryItem(targetMaterial, null, false);
                if (!targetItem) {
                    console.log("[build] Envanterde uygun eşya kalmadı!");
                    return;
                }

                await bot.equip(targetItem, "hand");

                // bak ve yerleştir
                await bot.lookAt(placePos.offset(0.5, 0.5, 0.5));
                await sleep(40 + Math.random() * 60);

                await bot.placeBlock(bot.blockAt(placePos.offset(0, -1, 0)), vec3(0, 1, 0));
                placed++;

                if (placed % 10 === 0) {
                    console.log(`[build] ${placed} blok yerleştirildi`);
                }

                await sleep(80 + Math.random() * 120); // anti-kick / anti-lag

            } catch (err) {
                console.log("[build hata]", err.message?.substring(0,80) || err);
                await sleep(400);
            }
        }
    }

    console.log(`[build] Bitti → ${placed} blok yerleştirildi`);
    bot.chat(`9×9 platform tamamlandı (${placed} blok)`);
}

// Yan yana yapmak için örnek yardımcı fonksiyon
async function buildMultiple9x9(count = 3, gap = 10, direction = "x") {
    for (let i = 0; i < count; i++) {
        await build9x9WithCenterHole("stone");  // istediğin bloğu değiştir

        // kaydırma
        let moveGoal;
        if (direction === "x") {
            moveGoal = new goals.GoalNear(
                bot.entity.position.x + (9 + gap),
                bot.entity.position.y,
                bot.entity.position.z,
                2
            );
        } else { // "z"
            moveGoal = new goals.GoalNear(
                bot.entity.position.x,
                bot.entity.position.y,
                bot.entity.position.z + (9 + gap),
                2
            );
        }

        try {
            await bot.pathfinder.goto(moveGoal, { timeout: 15000 });
        } catch {
            console.log("[build] Alanlar arası hareket başarısız");
        }

        await sleep(2000);
    }
}

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