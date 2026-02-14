const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

 // Vec3 sınıfı - paket yüklemeden manuel tanımlama (floored metodu eklendi)
class Vec3 {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  offset(dx = 0, dy = 0, dz = 0) {
    return new Vec3(this.x + dx, this.y + dy, this.z + dz);
  }

  // Paketin beklediği floored metodu (aşağı yuvarlama)
  floored() {
    return new Vec3(
      Math.floor(this.x),
      Math.floor(this.y),
      Math.floor(this.z)
    );
  }
}

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
        username: 'Xkakshi',
        version: '1.20.4'
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

            // ──────────────────────────────
            // Yeni eklenenler: warp sonrası otomatik başlama
            // ──────────────────────────────
            await sleep(15000);  // warp sonrası ekstra 15 sn bekle
            console.log("[build] Otomatik 9×9 platform yapımı başlıyor...");
            build9x9Platform();

            console.log("[seed] Boş farmland taraması ve otomatik ekim başlıyor...");
            seedPlantingLoop();

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
        movements.maxDropDown = 5;

        bot.pathfinder.setMovements(movements);

        console.log('[✓] Hasat ve satış sistemleri başlatıldı.');

        continuousHarvestAndMoveLoop();
        sellLoop();
    }

    // ───────────────────────────────────────────────
    //   Küçük rastgele kayma hareketi (değişmedi)
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
    //   ÇOK HIZLI HASAT (değişmedi)
    // ───────────────────────────────────────────────
    async function continuousHarvestAndMoveLoop() {
        while (true) {
            if (isSelling || !bot.entity?.position) {
                await sleep(400);
                continue;
            }

            try {
                const candidates = bot.findBlocks({
                    matching: block => block.name === 'wheat' && block.metadata === 7,
                    maxDistance: 70,
                    count: 40
                });

                if (candidates.length < 8) {
                    console.log("[harvest] Çok az olgun buğday → 4-7 sn bekle");
                    await sleep(4000 + Math.random() * 3000);
                    continue;
                }

                const pos = bot.entity.position;
                candidates.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));

                const targetCenter = candidates[0];

                console.log(`[→] Hedef bölgeye gidiliyor (${candidates.length} olgun buğday)`);

                const goal = new goals.GoalNear(targetCenter.x, targetCenter.y + 1, targetCenter.z, 4);
                try {
                    await bot.pathfinder.goto(goal, { timeout: 10000 });
                } catch (e) {
                    console.log("[path kısa] sorun → kayma yapılıyor");
                    await randomSmallOffset();
                }

                let brokenThisCycle = 0;
                const maxBreakPerCycle = 4;

                const toBreak = bot.findBlocks({
                    matching: b => b.name === 'wheat' && b.metadata === 7,
                    maxDistance: 12,
                    count: maxBreakPerCycle + 10
                });

                toBreak.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));

                for (const blockPos of toBreak) {
                    if (brokenThisCycle >= maxBreakPerCycle) break;

                    const block = bot.blockAt(blockPos);
                    if (!block || block.name !== 'wheat' || block.metadata !== 7) continue;

                    try {
                        await bot.lookAt(blockPos.offset(0.5, 1.6, 0.5), true);
                        await sleep(35 + Math.random() * 45);

                        await bot.dig(block, true);
                        brokenThisCycle++;
                    } catch {}
                }

                if (brokenThisCycle > 0) {
                    console.log(`[hasat] ${brokenThisCycle} buğday kırıldı`);
                }

                if (brokenThisCycle < 8) {
                    await randomSmallOffset();
                }

            } catch (err) {
                console.log("[hasat hata]", err.message?.substring(0, 90) || err);
            }

            await sleep(180 + Math.random() * 400);
        }
    }

    // ───────────────────────────────────────────────
    //   SATIŞ (değişmedi)
    // ───────────────────────────────────────────────
    async function sellLoop() {
        while (true) {
            await sleep(72000 + Math.random() * 18000);

            if (isSelling) continue;

            const totalWheat = bot.inventory.items()
                .filter(i => i.name === 'wheat')
                .reduce((sum, item) => sum + item.count, 0);

            if (totalWheat >= 520) {
                isSelling = true;
                console.log(`[sat] ${totalWheat} buğday → /sell all`);

                bot.pathfinder.setGoal(null);
                await sleep(1800 + Math.random() * 800);

                bot.chat('/sell all');
                await sleep(720 + Math.random() * 3000);

                isSelling = false;
                console.log("[satış] tamam");
            }
        }
    }

    // ───────────────────────────────────────────────
    //   9×9 PLATFORM YAPIMI – ENVANTERDEKİ İLK DOLDAN ALIR
    // ───────────────────────────────────────────────
    async function build9x9Platform() {
        if (isSelling) {
            console.log("[build] Satış aktif → inşa bekletiliyor");
            return;
        }

        console.log("[build] 9×9 platform yapımı başlıyor – envanterdeki ilk dolu slotu kullanıyor");

        let platformCount = 0;
        let totalPlaced = 0;

        while (true) {
            // Envanterdeki İLK dolu slotu al (rastgele eşya)
            const placeableItem = bot.inventory.items().find(item => 
                item.count >= 1 &&
                item.name !== "air" &&
                !item.name.includes("bucket") &&
                !item.name.endsWith("_bucket") &&
                !item.name.includes("potion") &&
                !item.name.includes("arrow") &&
                !item.name.includes("shield") &&
                !item.name.includes("elytra") &&
                !item.name.includes("boat") &&
                !item.name.includes("minecart")
            );

            if (!placeableItem) {
                console.log("[build] Envanterde koyulabilir dolu slot kalmadı");
                bot.chat("Envanterde koyacak bir şey kalmadı!");
                break;
            }

            const material = placeableItem.name;
            console.log(`[build #${platformCount + 1}] Kullanılan: \( {material} ( \){placeableItem.count} adet)`);

            const botPos = bot.entity.position;
            const startX = Math.floor(botPos.x) - 4;
            const startZ = Math.floor(botPos.z) - 4;
            const yLevel = Math.floor(botPos.y) - 1;

            let placedThisPlatform = 0;

            for (let dx = -4; dx <= 4; dx++) {
                for (let dz = -4; dz <= 4; dz++) {
                    if (dx === 0 && dz === 0) continue;

                    const px = startX + dx;
                    const pz = startZ + dz;

                    // FLOORED güvenli Vec3
                    const targetPos = new Vec3(
                        Math.floor(px),
                        Math.floor(yLevel),
                        Math.floor(pz)
                    );

                    const current = bot.blockAt(targetPos);
                    if (current.name !== "air" && current.name !== "cave_air") continue;

                    const belowPos = targetPos.offset(0, -1, 0);
                    const below = bot.blockAt(belowPos);
                    if (below.name === "air" || below.name === "cave_air") continue;

                    let toPlace = bot.inventory.findInventoryItem(material, null, false);
                    if (!toPlace) break;

                    try {
                        await bot.equip(toPlace, "hand");
                        await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
                        await sleep(100 + Math.random() * 150);
                        await bot.placeBlock(below, new Vec3(0, 1, 0));

                        placedThisPlatform++;
                        totalPlaced++;
                    } catch (err) {
                        console.log(`[build hata] ${material}: ${err.message || err}`);
                    }
                }
            }

            platformCount++;
            console.log(`Platform ${platformCount} → ${placedThisPlatform} blok (toplam ${totalPlaced})`);

            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(bot.entity.position.x + 19, bot.entity.position.y, bot.entity.position.z, 3),
                    { timeout: 12000 }
                );
                await sleep(500);
            } catch {}

            if (!bot.inventory.items().some(i => i.count >= 1)) break;
        }

        console.log(`[build BİTTİ] ${platformCount} platform • ${totalPlaced} blok`);
        bot.chat(`9×9 inşa bitti – \( {platformCount} adet ( \){totalPlaced} blok)`);
    }

    // ───────────────────────────────────────────────
    //   BOŞ FARMLAND ÜZERİNE TOHUM EKME – FLOORED GÜVENLİ
    // ───────────────────────────────────────────────
    async function seedPlantingLoop() {
        while (true) {
            if (isSelling) {
                await sleep(3000);
                continue;
            }

            try {
                const emptyFarmlands = bot.findBlocks({
                    matching: block => block.name === 'farmland' && block.metadata === 0,
                    maxDistance: 48,
                    count: 12
                });

                if (emptyFarmlands.length === 0) {
                    await sleep(1500 + Math.random() * 1000);
                    continue;
                }

                const botPos = bot.entity.position;
                emptyFarmlands.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b));

                for (const farmlandPos of emptyFarmlands) {
                    // FLOORED güvenli pozisyon
                    const safePos = new Vec3(
                        Math.floor(farmlandPos.x),
                        Math.floor(farmlandPos.y),
                        Math.floor(farmlandPos.z)
                    );

                    const block = bot.blockAt(safePos);
                    if (!block || block.name !== 'farmland' || block.metadata !== 0) continue;

                    const seedItem = bot.inventory.items().find(item =>
                        item.name.endsWith('_seeds') || item.name === 'wheat_seeds' ||
                        item.name === 'beetroot_seeds' || item.name === 'melon_seeds' ||
                        item.name === 'pumpkin_seeds' || item.name === 'potato' ||
                        item.name === 'carrot'
                    );

                    if (!seedItem) {
                        console.log("[seed] Tohum kalmadı");
                        await sleep(10000);
                        break;
                    }

                    try {
                        await bot.equip(seedItem, 'hand');
                        await bot.lookAt(safePos.offset(0.5, 0.1, 0.5), true);
                        await sleep(50 + Math.random() * 50);
                        await bot.placeBlock(block, new Vec3(0, 1, 0));

                        console.log(`[seed] Ekildi: ${seedItem.name} → \( {safePos.x}, \){safePos.y},${safePos.z}`);
                    } catch (err) {
                        console.log(`[seed hata] ${err.message || err}`);
                    }

                    await sleep(120 + Math.random() * 80);
                }

            } catch (err) {
                console.log("[seed hata]", err.message?.substring(0, 80) || err);
            }

            await sleep(600 + Math.random() * 600);
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