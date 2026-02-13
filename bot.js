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
        movements.maxDropDown = 5;

        bot.pathfinder.setMovements(movements);

        console.log('[✓] Hasat ve satış sistemleri başlatıldı.');

        continuousHarvestAndMoveLoop();
        sellLoop();

        // ──────────────────────────────
        //  9×9 alan yapım sistemi burada aktif oluyor
        // ──────────────────────────────
        console.log('[✓] 9×9 inşa sistemi yüklendi (yap / blokyap / 9x9 yazarak başlat)');
    }

    // ───────────────────────────────────────────────
    //   Küçük rastgele kayma hareketi
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
                    } catch {
                        // sessiz
                    }
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
    //   SATIŞ
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
    //   9×9 ORTASI BOŞ PLATFORM (envanterdeki herhangi stacklenebilir blokla)
    // ───────────────────────────────────────────────
    async function build9x9AnyBlock() {
        if (isSelling) {
            console.log("[build] Satış aktif, inşa iptal");
            bot.chat("Satış işlemi devam ederken inşa yapılamaz!");
            return;
        }

        console.log("[build] 9×9 platform yapımı başlıyor (envanterdeki ilk uygun blokla)");

        let platformCount = 0;
        let totalPlaced = 0;

        while (true) {
            const placeableItem = bot.inventory.items().find(item =>
                item.stackable &&
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
                !item.name.includes("wheat") &&
                !item.name.includes("seeds") &&
                item.name !== "air" &&
                item.name !== "water_bucket" &&
                item.name !== "lava_bucket"
            );

            if (!placeableItem) {
                console.log("[build] Yerleştirilebilir blok kalmadı");
                bot.chat("Envanterde uygun blok kalmadı!");
                break;
            }

            const material = placeableItem.name;
            console.log(`[build #${platformCount+1}] Kullanılan: \( {material} ( \){placeableItem.count} adet)`);

            const startX = Math.floor(bot.entity.position.x) - 4;
            const startZ = Math.floor(bot.entity.position.z) - 4;
            const yLevel  = Math.floor(bot.entity.position.y) - 1;

            let placedThisPlatform = 0;

            for (let dx = -4; dx <= 4; dx++) {
                for (let dz = -4; dz <= 4; dz++) {
                    if (dx === 0 && dz === 0) continue;

                    const px = startX + dx;
                    const pz = startZ + dz;
                    const targetPos = new Vec3(px, yLevel, pz);

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
                        await sleep(55 + Math.random() * 45);   // 55–100 ms

                        await bot.placeBlock(below, new Vec3(0, 1, 0));

                        placedThisPlatform++;
                        totalPlaced++;
                    } catch {
                        // sessiz
                    }
                }
            }

            platformCount++;
            console.log(`[build] Platform ${platformCount} tamam • ${placedThisPlatform} blok • Toplam: ${totalPlaced}`);

            if (placedThisPlatform < 30) {
                console.log("[build] Yeterince blok koyulamadı → muhtemelen envanter bitti veya alan dolu");
                break;
            }

            // sonraki alana git
            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(
                        bot.entity.position.x + 19,
                        bot.entity.position.y,
                        bot.entity.position.z,
                        3
                    ),
                    { timeout: 14000 }
                );
                await sleep(700);
            } catch {
                console.log("[build] Hareket hatası, devam ediliyor");
            }
        }

        console.log(`[build TAMAM] ${platformCount} platform • ${totalPlaced} blok`);
        bot.chat(`9×9 inşa bitti → \( {platformCount} adet ( \){totalPlaced} blok)`);
    }

    // Chat ile tetikleme
    bot.on('chat', (username, message) => {
        if (username === bot.username) return;

        const msg = message.toLowerCase().trim();
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