const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// ──────────────────────────────
//   HOSTING PORT
// ──────────────────────────────
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif 🚀');
}).listen(PORT, () => console.log(`[✓] Hosting port açık: ${PORT}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createBot() {
    console.log('--- [Sistem] Bot Başlatılıyor ---');

    const bot = mineflayer.createBot({
        host: 'play.reborncraft.pw',
        port: 25565,
        username: 'Xkakahi',
        version: '1.21'
    });

    bot.loadPlugin(pathfinder);

    let isSelling = false;
    let systemsStarted = false;
    let spawnProcessed = false;

    // ──────────────────────────────
    //    GİRİŞ (hiç dokunulmadı)
    // ──────────────────────────────
    async function performLoginSequence() {
        if (systemsStarted) return;
        console.log('[→] Login sırası başlatılıyor...');

        try {
            await sleep(12000); bot.chat(`/login ${process.env.SIFRE}`);
            await sleep(12000); bot.chat('/skyblock');
            await sleep(12000); bot.chat('/warp Yoncatala');
            await sleep(18000);

            systemsStarted = true;
            startSystems();
        } catch (err) {
            console.log('[!] Giriş hatası:', err.message);
        }
    }

    bot.on('spawn', () => {
        if (spawnProcessed) return;
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

        console.log('[✓] Hasat + Ekim + Satış sistemleri aktif');

        continuousHarvestAndMoveLoop();   // HASAT
        continuousPlantingLoop();         // EKİM (yeni)
        sellLoop();                       // SATIŞ
    }

    // ──────────────────────────────
    //   ORTAK KONTROLLER
    // ──────────────────────────────
    function isBotBusy() {
        return isSelling || bot.pathfinder.isMoving();
    }

    async function randomSmallOffset() {
        const dx = Math.random() * 5 - 2.5;
        const dz = Math.random() * 5 - 2.5;
        try {
            await bot.pathfinder.goto(new goals.GoalNear(
                Math.round(bot.entity.position.x + dx),
                Math.round(bot.entity.position.y),
                Math.round(bot.entity.position.z + dz), 1.8
            ), { timeout: 6000 });
        } catch {}
    }

    // ───────────────────────────────────────────────
    //   HASAT (orijinal, sadece küçük iyileştirme)
    // ───────────────────────────────────────────────
    async function continuousHarvestAndMoveLoop() {
        while (true) {
            if (isSelling || !bot.entity?.position) {
                await sleep(300);
                continue;
            }

            try {
                const candidates = bot.findBlocks({
                    matching: b => b.name === 'wheat' && b.metadata === 7,
                    maxDistance: 70,
                    count: 40
                });

                if (candidates.length < 8) {
                    await sleep(3500 + Math.random() * 2500);
                    continue;
                }

                const pos = bot.entity.position;
                candidates.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));

                const goal = new goals.GoalNear(candidates[0].x, candidates[0].y + 1, candidates[0].z, 4);
                try { await bot.pathfinder.goto(goal, { timeout: 9000 }); } 
                catch { await randomSmallOffset(); }

                let broken = 0;
                const toBreak = bot.findBlocks({
                    matching: b => b.name === 'wheat' && b.metadata === 7,
                    maxDistance: 12,
                    count: 15
                }).sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));

                for (const bp of toBreak) {
                    if (broken >= 5) break;
                    if (isBotBusy()) break;

                    const block = bot.blockAt(bp);
                    if (!block || block.name !== 'wheat' || block.metadata !== 7) continue;

                    try {
                        await bot.lookAt(bp.offset(0.5, 1.6, 0.5), true);
                        await sleep(30 + Math.random() * 40);
                        await bot.dig(block, true);
                        broken++;
                    } catch {}
                }

                if (broken < 6) await randomSmallOffset();

            } catch (e) {}

            await sleep(140 + Math.random() * 260);
        }
    }

    // ───────────────────────────────────────────────
    //   EKİM (30 blok tarama + HASATA/SATIŞA ZERRE ENGEL OLMUYOR)
    // ───────────────────────────────────────────────
    async function continuousPlantingLoop() {
        while (true) {
            // EN ÖNEMLİ KISIM: Hasat veya satış varsa bekle
            if (isSelling || isBotBusy()) {
                await sleep(120);
                continue;
            }

            try {
                const farmlands = bot.findBlocks({
                    matching: block => {
                        if (block.name !== 'farmland') return false;
                        const above = bot.blockAt(block.position.offset(0, 1, 0));
                        return !above || above.name !== 'wheat';
                    },
                    maxDistance: 30,
                    count: 50
                });

                if (farmlands.length === 0) {
                    await sleep(400 + Math.random() * 300);
                    continue;
                }

                const pos = bot.entity.position;
                farmlands.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));

                const target = farmlands[0];
                const farmland = bot.blockAt(target);
                if (!farmland) continue;

                const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
                if (!seeds) {
                    await sleep(800);
                    continue;
                }

                // Çok yakınsa direkt ek, değilse git
                if (pos.distanceTo(target) > 4.5) {
                    if (isBotBusy()) continue;
                    const goal = new goals.GoalNear(target.x, target.y + 1, target.z, 3.5);
                    try {
                        await bot.pathfinder.goto(goal, { timeout: 5500 });
                    } catch {
                        await randomSmallOffset();
                        continue;
                    }
                }

                // EKME
                await bot.equip(seeds, 'hand');
                await bot.lookAt(target.offset(0.5, 0.6, 0.5), true);
                await sleep(38 + Math.random() * 42);
                await bot.placeBlock(farmland, new Vec3(0, 1, 0));

                console.log(`[ekim] ✅ 1 buğday eklendi  (${farmlands.length} boş farmland kaldı)`);

            } catch (err) {
                // console.log("[ekim hata]", err.message?.substring(0,60) || err); // spam olmasın
            }

            // HASATTAN ÇOK HIZLI ama çakışma yok
            await sleep(95 + Math.random() * 125);
        }
    }

    // ───────────────────────────────────────────────
    //   SATIŞ (orijinal)
    // ───────────────────────────────────────────────
    async function sellLoop() {
        while (true) {
            await sleep(72000 + Math.random() * 18000);

            if (isSelling) continue;

            const totalWheat = bot.inventory.items()
                .filter(i => i.name === 'wheat')
                .reduce((sum, i) => sum + i.count, 0);

            if (totalWheat >= 520) {
                isSelling = true;
                console.log(`[sat] ${totalWheat} buğday satılıyor...`);

                bot.pathfinder.setGoal(null);
                await sleep(1600 + Math.random() * 600);
                bot.chat('/sell all');
                await sleep(900 + Math.random() * 2200);

                isSelling = false;
            }
        }
    }

    bot.on('end', () => {
        console.log('[!] Bağlantı koptu, yeniden bağlanılıyor...');
        setTimeout(createBot, 12000);
    });

    bot.on('kicked', r => console.log('[ATILDI]', JSON.stringify(r)));
    bot.on('error', e => console.log('[HATA]', e.message));
}

createBot();