const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

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

            await sleep(15000);
            console.log("[build] Otomatik 9×9 platform yapımı başlıyor...");
            await fastBuild9x9WithCenterHole();  // await eklendi

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
    //   ÇOK HIZLI HASAT (DEĞİŞMEDİ)
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
    //   SATIŞ (DEĞİŞMEDİ)
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
    //   10 SANİYEDE RASTGELE EŞYA İLE 9×9 ALAN 
    //   → SADECE TAM ORTADAKİ 1 BLOK BOŞ KALACAK
    // ───────────────────────────────────────────────
    async function fastBuild9x9WithCenterHole() {
        console.log("[build] 10sn içinde 9×9 (sadece orta boş) başlıyor – gelişmiş versiyon");

        const timeoutMs = 10000;
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            // Envanterden blok seç (farmland öncelikli)
            let placeable = bot.inventory.items().find(item => item.name.toLowerCase() === 'farmland' && item.count > 0);
            if (!placeable) {
                placeable = bot.inventory.items().find(item => {
                    if (item.count < 1) return false;
                    const blockName = item.name.toLowerCase();
                    return blockName.includes('dirt') || blockName.includes('stone') ||
                           blockName.includes('cobblestone') || blockName.includes('planks') || blockName.includes('wool') ||
                           blockName.includes('concrete');
                });
            }

            if (!placeable) {
                console.log("[build] Koyulabilir blok kalmadı");
                bot.chat("Envanterde blok kalmadı → 9×9 durduruldu");
                return;
            }

            console.log(`[build] Kullanılan: \( {placeable.name} ( \){placeable.count})`);

            try {
                await bot.equip(placeable, "hand");
                await sleep(200 + Math.random() * 150);
            } catch (e) {
                console.log("[build] Equip hata:", e.message || e);
                await sleep(600);
                continue;
            }

            const botPos = bot.entity.position.floored();
            const centerX = botPos.x;
            const centerZ = botPos.z;
            const placeY = botPos.y - 1;

            let placedCount = 0;

            outer: for (let dx = -4; dx <= 4; dx++) {
                for (let dz = -4; dz <= 4; dz++) {
                    if (Date.now() - startTime >= timeoutMs) break outer;

                    if (dx === 0 && dz === 0) continue;

                    const targetX = centerX + dx;
                    const targetY = placeY;
                    const targetZ = centerZ + dz;

                    const targetPos = new Vec3(targetX, targetY, targetZ);
                    const refPos = new Vec3(targetX, targetY - 1, targetZ);

                    const targetBlock = bot.blockAt(targetPos);
                    if (!targetBlock || (targetBlock.name !== "air" && targetBlock.name !== "cave_air")) continue;

                    const referenceBlock = bot.blockAt(refPos);
                    if (!referenceBlock || referenceBlock.name === "air" || referenceBlock.name === "cave_air") continue;

                    // Mesafe kontrolü ve bot'u yaklaştır
                    let dist = bot.entity.position.distanceTo(targetPos);
                    if (dist > 3.5) {
                        console.log(`[build] Uzak (${dist.toFixed(1)}) → yaklaşıyor...`);
                        try {
                            await bot.pathfinder.goto(new goals.GoalNear(targetX, targetY + 1, targetZ, 1.5), { timeout: 5000 });
                            dist = bot.entity.position.distanceTo(targetPos);  // yeniden hesapla
                        } catch (err) {
                            console.log("[path hata] Yaklaşma başarısız:", err.message || err);
                            continue;
                        }
                    }

                    let success = false;
                    for (let retry = 0; retry < 3; retry++) {
                        try {
                            await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
                            await sleep(100 + Math.random() * 100);

                            console.log(`[build retry \( {retry+1}] Yerleştirme: ref= \){referenceBlock.name} @ \( {refPos}, hedef= \){targetPos}, dist=${dist.toFixed(1)}`);

                            await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));

                            await sleep(300 + Math.random() * 200); // Update bekle

                            const updatedBlock = bot.blockAt(targetPos);
                            if (updatedBlock.name !== "air" && updatedBlock.name !== "cave_air") {
                                success = true;
                                placedCount++;
                                console.log(`[build SUCCESS] Blok koyuldu: ${updatedBlock.name} @ ${targetPos}`);
                                break;
                            } else {
                                console.log("[build] Hala hava – retry");
                            }
                        } catch (err) {
                            console.log(`[build error retry ${retry+1}] ${err.message || err}`);
                            if (err.message && err.message.includes("item")) bot.updateHeldItem(); // Item sync
                        }
                    }

                    if (!success) {
                        // Alternatif: activateBlock dene
                        try {
                            console.log("[build] placeBlock fail – activateBlock deneniyor");
                            await bot.activateBlock(referenceBlock, new Vec3(0, 1, 0));
                            await sleep(300);
                            const altBlock = bot.blockAt(targetPos);
                            if (altBlock.name !== "air" && altBlock.name !== "cave_air") {
                                placedCount++;
                                console.log(`[build ALT SUCCESS] Blok koyuldu (activate): ${altBlock.name} @ ${targetPos}`);
                                success = true;
                            } else {
                                console.log("[build] activateBlock de başarısız");
                            }
                        } catch (altErr) {
                            console.log("[build ALT error] " + (altErr.message || altErr));
                        }
                    }

                    if (placedCount % 4 === 0) await sleep(250);
                }
            }

            console.log(`[build] Bu turda ${placedCount} blok koyuldu`);

            if (placedCount > 0) {
                await randomSmallOffset(); // Hareket et
            } else {
                console.log("[build] Hiç koyulmadı – random offset");
                await randomSmallOffset();
            }

            await sleep(200 + Math.random() * 200);
        }

        console.log("[build] 10 saniye bitti");

        // Tekrar kontrol
        const hasMoreBlocks = bot.inventory.items().some(item => {
            if (item.count < 1) return false;
            const blockName = item.name.toLowerCase();
            return blockName === 'farmland' || blockName.includes('dirt') || blockName.includes('stone') ||
                   blockName.includes('cobblestone') || blockName.includes('planks') || blockName.includes('wool') ||
                   blockName.includes('concrete');
        });
        
        if (hasMoreBlocks) {
            setTimeout(fastBuild9x9WithCenterHole, 1200);
        } else {
            bot.chat("9×9 (orta boş) tamamlandı – blok kalmadı");
        }
    }

    // ───────────────────────────────────────────────
    //   BOŞ FARMLAND ÜZERİNE TOHUM EKME (FARMLAND İSMİ DEĞİŞTİ)
    // ───────────────────────────────────────────────
    async function seedPlantingLoop() {
        let debugPrinted = false;

        while (true) {
            if (isSelling) {
                await sleep(3000);
                continue;
            }

            try {
                // Bir kereye mahsus yakındaki olası farmland isimlerini logla
                if (!debugPrinted) {
                    console.log("[DEBUG] Yakındaki olası farmland / toprak blokları taranıyor...");
                    const nearby = bot.findBlocks({
                        matching: () => true,
                        maxDistance: 12,
                        count: 80
                    });

                    const seen = new Set();
                    nearby.forEach(p => {
                        const b = bot.blockAt(p);
                        if (b && (b.name.includes('dirt') || b.name.includes('Farmland') || b.name.includes('soil') || b.name.includes('farm') || b.metadata === 0 || b.metadata === 7)) {
                            if (!seen.has(b.name)) {
                                console.log(`   → ${b.name} (metadata: ${b.metadata}) @ ${p.x} ${p.y} ${p.z}`);
                                seen.add(b.name);
                            }
                        }
                    });
                    debugPrinted = true;
                }

                // Esnek farmland tarama
                const emptyFarmlands = bot.findBlocks({
                    matching: block => {
                        if (!block) return false;

                        // Üstü tamamen hava olmalı
                        const above = bot.blockAt(block.position.offset(0,1,0));
                        if (above.name !== 'air' && above.name !== 'cave_air') return false;

                        // Üstünde ürün olmamalı
                        if (above.name.includes('wheat') || above.name.includes('carrot') || above.name.includes('potato') ||
                            above.name.includes('beetroot') || above.name.includes('melon') || above.name.includes('pumpkin')) {
                            return false;
                        }

                        // Farmland benzeri kontrol (sunucuya göre genişletildi)
                        return (
                            block.name === 'Farmland' ||
                            block.name.toLowerCase() === 'farmland' ||
                            block.name.includes('Farmland') ||
                            block.name.includes('soil') ||
                            block.name.includes('farm') ||
                            block.name.includes('cultivat') ||
                            (block.name.includes('dirt') && block.metadata !== 0)  // çoğu sunucuda tilled dirt metadata değişir
                        );
                    },
                    maxDistance: 48,
                    count: 12
                });

                if (emptyFarmlands.length === 0) {
                    await sleep(2500 + Math.random() * 1500);
                    continue;
                }

                console.log(`[seed] ${emptyFarmlands.length} adet boş ekilebilir alan bulundu`);

                const botPos = bot.entity.position;
                emptyFarmlands.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b));

                for (const pos of emptyFarmlands) {
                    const safePos = pos.floored();
                    const block = bot.blockAt(safePos);

                    if (!block) continue;

                    const seedItem = bot.inventory.items().find(item =>
                        item.name.endsWith('_seeds') ||
                        item.name === 'wheat_seeds' ||
                        item.name === 'beetroot_seeds' ||
                        item.name === 'melon_seeds' ||
                        item.name === 'pumpkin_seeds' ||
                        item.name === 'potato' ||
                        item.name === 'carrot'
                    );

                    if (!seedItem) {
                        console.log("[seed] Tohum kalmadı");
                        await sleep(12000);
                        break;
                    }

                    try {
                        await bot.equip(seedItem, 'hand');
                        await bot.lookAt(safePos.offset(0.5, 0.1, 0.5), true);
                        await sleep(60 + Math.random() * 90);

                        await bot.placeBlock(block, new Vec3(0, 1, 0));

                        console.log(`[seed] Ekildi: ${seedItem.name} → ${safePos.x}, ${safePos.y}, ${safePos.z} (zemin: ${block.name})`);
                    } catch (err) {
                        console.log(`[seed hata] ${err.message || err}  (zemin: ${block.name})`);
                    }

                    await sleep(200 + Math.random() * 100);
                }

            } catch (err) {
                console.log("[seed loop hata]", err.message || err);
            }

            await sleep(1800 + Math.random() * 1200);
        }
    }

}

createBot();