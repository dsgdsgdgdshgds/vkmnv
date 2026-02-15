const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

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
    //    GİRİŞ KISMI (hiç dokunulmadı)
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
            bot.chat('/warp Yoncatala');
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

        console.log('[✓] Hasat, ekim ve satış sistemleri başlatıldı.');

        // HASAT (orijinal, hiç dokunulmadı)
        continuousHarvestAndMoveLoop();
        
        // YENİ: EKİM SİSTEMİ (30 blok tarama + çok hızlı)
        continuousPlantingLoop();
        
        // SATIŞ (orijinal, hiç dokunulmadı)
        sellLoop();
    }

    // ───────────────────────────────────────────────
    //   Küçük rastgele kayma hareketi (orijinal)
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
                ), { timeout: 7000 }
            );
        } catch {}
    }

    // ───────────────────────────────────────────────
    //   ÇOK HIZLI HASAT (orijinal, hiç dokunulmadı)
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
                    await sleep(4000 + Math.random() * 3000);
                    continue;
                }

                const pos = bot.entity.position;
                candidates.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));

                const targetCenter = candidates[0];

                const goal = new goals.GoalNear(targetCenter.x, targetCenter.y + 1, targetCenter.z, 4);
                try {
                    await bot.pathfinder.goto(goal, { timeout: 10000 });
                } catch {
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

                if (brokenThisCycle < 8) await randomSmallOffset();

            } catch (err) {
                console.log("[hasat hata]", err.message?.substring(0, 90) || err);
            }

            await sleep(180 + Math.random() * 400);
        }
    }

    // ───────────────────────────────────────────────
    //   YENİ: ÇOK HIZLI EKİM SİSTEMİ (30 blok tarama)
    // ───────────────────────────────────────────────
    async function continuousPlantingLoop() {
        while (true) {
            if (isSelling || !bot.entity?.position) {
                await sleep(200);
                continue;
            }

            try {
                // 30 blok içinde ekilmemiş farmland ara
                const farmlands = bot.findBlocks({
                    matching: (block) => {
                        if (block.name !== 'farmland') return false;
                        const above = bot.blockAt(block.position.offset(0, 1, 0));
                        return !above || above.name !== 'wheat'; // sadece buğday ekili değilse
                    },
                    maxDistance: 30,
                    count: 40
                });

                if (farmlands.length === 0) {
                    await sleep(600 + Math.random() * 400); // çok az bekle
                    continue;
                }

                const pos = bot.entity.position;
                farmlands.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));

                const targetPos = farmlands[0];
                const farmlandBlock = bot.blockAt(targetPos);
                if (!farmlandBlock) continue;

                // Tohum var mı?
                const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
                if (!seeds) {
                    await sleep(1500);
                    continue;
                }

                // Yakınsa direkt ek, uzaksa git
                if (pos.distanceTo(targetPos) > 4.8) {
                    const goal = new goals.GoalNear(targetPos.x, targetPos.y + 1, targetPos.z, 3.8);
                    try {
                        await bot.pathfinder.goto(goal, { timeout: 6000 });
                    } catch {
                        await randomSmallOffset();
                        continue;
                    }
                }

                // Ek
                await bot.equip(seeds, 'hand');
                await bot.lookAt(targetPos.offset(0.5, 0.6, 0.5), true);
                await sleep(45 + Math.random() * 55);
                await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));

                console.log(`[ekim] ✅ 1 buğday eklendi (${farmlands.length} farmland kaldı)`);

            } catch (err) {
                console.log("[ekim hata]", err.message?.substring(0, 80) || err);
            }

            // HASATTAN ÇOK DAHA HIZLI (0.08 - 0.22 saniye)
            await sleep(80 + Math.random() * 140);
        }
    }

    // ───────────────────────────────────────────────
    //   SATIŞ (orijinal, hiç dokunulmadı)
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