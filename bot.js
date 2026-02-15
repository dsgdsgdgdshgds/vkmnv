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
            bot.chat('/warp Yoncatrla');
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
        continuousPlantingLoop();
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
//   EKİM – ARTİK PATLAMAYACAK, SÜPER GÜVENLİ HALİ
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
            const farmlands = bot.findBlocks({
                matching: block => {
                    if (!block || block.name !== 'farmland') return false;
                    const abovePos = block.position ? block.position.offset(0, 1, 0) : null;
                    if (!abovePos) return false;
                    const above = bot.blockAt(abovePos);
                    return !above || (above.name !== 'wheat' && above.name !== 'seeds');
                },
                maxDistance: 30,
                count: 50
            });

            if (!Array.isArray(farmlands) || farmlands.length === 0) {
                // console.log('[ekim] Hiç farmland bulunamadı');
                await sleep(1400 + Math.random() * 900);
                continue;
            }

            const pos = bot.entity?.position;
            if (!pos) {
                await sleep(800);
                continue;
            }

            // En yakını seçmeden önce her birini doğrula
            const validFarmlands = farmlands.filter(t => 
                t && typeof t === 'object' && 
                typeof t.x === 'number' && !isNaN(t.x) &&
                typeof t.y === 'number' && !isNaN(t.y) &&
                typeof t.z === 'number' && !isNaN(t.z)
            );

            if (validFarmlands.length === 0) {
                console.log('[ekim] Geçerli Vec3 farmland yok (hepsi invalid) → bekleniyor');
                await sleep(1200);
                continue;
            }

            validFarmlands.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));
            const target = validFarmlands[0];

            // Ekstra null/undefined koruması (artık imkansız olmalı)
            if (!target || typeof target.x !== 'number') {
                console.log('[ekim] Seçilen target hala geçersiz → atlanıyor');
                await sleep(600);
                continue;
            }

            // Artık güvenli: offset çağrılabilir
            const lookPos = target.offset(0.5, 0.8 + Math.random() * 0.2, 0.5);

            const farmland = bot.blockAt(target);
            if (!farmland || farmland.name !== 'farmland') {
                console.log('[ekim] blockAt geçersiz farmland → atlanıyor');
                await randomSmallOffset();
                continue;
            }

            let seeds = bot.inventory.items().find(i => i && i.name === 'wheat_seeds');
            if (!seeds) {
                console.log('[ekim] Tohum yok → bekle');
                await sleep(1800);
                continue;
            }

            const handItem = bot.entity?.heldItem;
            if (!handItem || handItem.name !== 'wheat_seeds') {
                try {
                    await bot.equip(seeds, 'hand');
                    await sleep(200 + Math.random() * 100);
                } catch (equipErr) {
                    console.log('[ekim] Equip başarısız:', equipErr.message?.slice(0,60));
                    continue;
                }
            }

            if (!bot.entity?.heldItem || bot.entity.heldItem.name !== 'wheat_seeds') {
                await sleep(600);
                continue;
            }

            if (pos.distanceTo(target) > 4.2) {
                const goal = new goals.GoalNear(target.x, target.y + 1, target.z, 3.2);
                try {
                    await bot.pathfinder.goto(goal, { timeout: 7000 });
                } catch {
                    await randomSmallOffset();
                    continue;
                }
            }

            await bot.lookAt(lookPos, true);
            await sleep(140 + Math.random() * 180);

            const placeLoc = { 
                x: Math.floor(target.x), 
                y: Math.floor(target.y), 
                z: Math.floor(target.z) 
            };

            bot._client.write('use_item_on', {
                location: placeLoc,
                face: 1,
                hand: 0,
                cursorX: 0.5,
                cursorY: 0.5,
                cursorZ: 0.5,
                insideBlock: false
            });

            console.log(`[ekim] ✅ Ekildi (${validFarmlands.length - 1} boş kaldı)`);

        } catch (err) {
            console.log('[ekim] Hata yakalandı:', err.message?.substring(0, 100) || String(err));
        }

        await sleep(450 + Math.random() * 550);
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