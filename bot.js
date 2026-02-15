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
        username: 'Alix770',
        version: '1.21'
    });

    bot.loadPlugin(pathfinder);

    let isSelling = false;
    let systemsStarted = false;
    let spawnProcessed = false;

    // ──────────────────────────────
    //    GİRİŞ KISMI
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
        continuousPlantingLoop();   // ← ekim döngüsü burada başlatılıyor
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
    //   HASAT (değişmedi)
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
    //   YENİ EKİM DÖNGÜSÜ (baştan yazıldı)
    // ───────────────────────────────────────────────
    async function continuousPlantingLoop() {
        while (true) {
            if (!systemsStarted) {
                await sleep(800);
                continue;
            }

            if (isSelling) {
                await sleep(300);
                continue;
            }

            try {
                // 1. Önce geniş arama (findBlocks)
                let targets = bot.findBlocks({
                    matching: block => block && block.name === 'farmland',
                    maxDistance: 64,
                    count: 80
                });

                console.log(`[ekim] findBlocks ile farmland sayısı: ${targets.length}`);

                // 2. Eğer hiç bulamadıysa → yakın çevreyi manuel tara (chunk sorunu için)
                if (targets.length === 0) {
                    console.log('[ekim] findBlocks boş → manuel 17x17 tarama başlıyor');
                    targets = [];
                    const center = bot.entity.position.floored();
                    for (let dx = -8; dx <= 8; dx++) {
                        for (let dz = -8; dz <= 8; dz++) {
                            const pos = center.offset(dx, 0, dz);
                            const block = bot.blockAt(pos);
                            if (block && block.name === 'farmland') {
                                targets.push(pos);
                            }
                        }
                    }
                    console.log(`[ekim] Manuel taramada farmland bulundu: ${targets.length}`);
                }

                if (targets.length === 0) {
                    console.log('[ekim] Hiç farmland algılanmadı → 2-4 sn bekle');
                    await sleep(2000 + Math.random() * 2000);
                    continue;
                }

                // En yakını seç
                const botPos = bot.entity.position;
                targets.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b));
                const targetPos = targets[0];

                // Üst blok kontrolü (boş mu?)
                const above = bot.blockAt(targetPos.offset(0, 1, 0));
                if (above && (above.name === 'wheat' || above.name === 'wheat_seeds' || above.name === 'crops')) {
                    console.log('[ekim] Seçilen farmland dolu → başka aranıyor');
                    continue;
                }

                console.log(`[ekim] Hedef: ${targetPos.x} ${targetPos.y} ${targetPos.z}`);

                // Tohum kontrolü
                let seeds = bot.inventory.findInventoryItem(bot.registry.itemsByName.wheat_seeds.id, null, false);
                if (!seeds) {
                    console.log('[ekim] Tohum yok → bekleniyor');
                    await sleep(3000);
                    continue;
                }

                // Tohumu ele al
                if (!bot.heldItem || bot.heldItem.type !== seeds.type) {
                    await bot.equip(seeds, 'hand');
                    await sleep(250);
                }

                // Yakın değilse git
                if (botPos.distanceTo(targetPos) > 4.5) {
                    const goal = new goals.GoalNear(targetPos.x, targetPos.y + 1, targetPos.z, 3.5);
                    try {
                        await bot.pathfinder.goto(goal, { timeout: 8000 });
                    } catch {
                        await randomSmallOffset();
                        continue;
                    }
                }

                // Bak ve ek
                const placePos = targetPos.offset(0.5, 0.9 + Math.random() * 0.2, 0.5);
                await bot.lookAt(placePos, true);
                await sleep(150 + Math.random() * 150);

                bot.activateBlock(bot.blockAt(targetPos));

                console.log('[ekim] Tohum ekildi');

            } catch (err) {
                console.log('[ekim hata]', err.message?.substring(0, 100) || err);
            }

            await sleep(500 + Math.random() * 700);
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