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
        username: 'Xkakashi',
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
            fastBuild9x9WithCenterHole();

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
// ──────────────────────────────────────────────// ───────────────────────────────────────────────async function fastBuild9x9WithCenterHole() {
    console.log("[build] 10sn içinde 9×9 (sadece orta boş) başlıyor");

    const timeoutMs = 10000;
    const startTime = Date.now();

    const MAX_PLACE_DISTANCE = 5.0; // bot ile hedef arası mesafe sınırı

    while (Date.now() - startTime < timeoutMs) {
        const placeable = bot.inventory.items().find(item => {
            if (item.count < 1) return false;
            const n = item.name.toLowerCase();
            // genişletilmiş liste - farmland da dahil
            return n.includes('dirt') || n.includes('stone') || n.includes('cobblestone') || 
                   n.includes('planks') || n.includes('wool') || n.includes('concrete') || n.includes('farmland');
        });

        if (!placeable) {
            console.log("[build] Uygun blok kalmadı (farmland, dirt, stone vs.)");
            bot.chat("Yapı bloğu bitti – 9×9 durduruldu");
            return;
        }

        console.log(`[build] Elinde: \( {placeable.name} ( \){placeable.count})`);

        try {
            await bot.equip(placeable, "hand");
            await sleep(200 + Math.random() * 150);
        } catch (e) {
            console.log("[equip hata]", e.message || e);
            await sleep(800);
            continue;
        }

        const botPos = bot.entity.position;
        const centerX = Math.floor(botPos.x);
        const centerZ = Math.floor(botPos.z);
        const placeY = Math.floor(botPos.y) - 1;

        let placedCount = 0;

        outerLoop: for (let dx = -4; dx <= 4; dx++) {
            for (let dz = -4; dz <= 4; dz++) {
                if (Date.now() - startTime >= timeoutMs) break outerLoop;
                if (dx === 0 && dz === 0) continue;

                const tx = centerX + dx;
                const ty = placeY;
                const tz = centerZ + dz;

                const targetPos = new Vec3(tx, ty, tz);
                const refPos    = new Vec3(tx, ty - 1, tz);

                const targetBlock = bot.blockAt(targetPos);
                if (targetBlock.name !== 'air' && targetBlock.name !== 'cave_air') continue;

                const refBlock = bot.blockAt(refPos);
                if (refBlock.name === 'air' || refBlock.name === 'cave_air') continue;

                // Mesafe kontrolü - çok uzaktaysa atla
                const dist = bot.entity.position.distanceTo(targetPos);
                if (dist > MAX_PLACE_DISTANCE) {
                    console.log(`[build] Çok uzak (${dist.toFixed(1)} blok) → atlanıyor ${tx} ${ty} ${tz}`);
                    continue;
                }

                let success = false;
                for (let attempt = 1; attempt <= 3; attempt++) {  // retry 3 kez
                    try {
                        await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
                        await sleep(80 + Math.random() * 70);

                        console.log(`[build deneme ${attempt}] Yerleştirme deneniyor → ref: ${refBlock.name} @ ${refPos}, hedef: ${tx} ${ty} ${tz}, mesafe: ${dist.toFixed(1)}`);

                        await bot.placeBlock(refBlock, new Vec3(0, 1, 0));

                        // Yerleştirme sonrası kısa bekle + kontrol et
                        await sleep(120 + Math.random() * 80);

                        const newBlock = bot.blockAt(targetPos);
                        if (newBlock.name !== 'air' && newBlock.name !== 'cave_air') {
                            success = true;
                            placedCount++;
                            console.log(`[build BAŞARILI] ${placedCount}. blok: ${newBlock.name} @ ${tx} ${ty} ${tz}`);
                            break;
                        } else {
                            console.log(`[build] placeBlock sonrası hala hava → başarısız`);
                        }
                    } catch (err) {
                        console.log(`[build hata deneme ${attempt}] ${err.message || err}`);
                        await sleep(150);
                    }
                }

                if (!success && placedCount === 0 && Math.random() < 0.3) {
                    // Hiçbir şey koyulmadıysa küçük random hareket
                    await randomSmallOffset();
                }

                if (placedCount % 4 === 0) await sleep(200);
            }
        }

        console.log(`[build] Tur sonu: ${placedCount} blok koyuldu`);

        if (placedCount > 0) {
            try {
                const rx = (Math.random() > 0.5 ? 1 : -1) * (6 + Math.floor(Math.random() * 10));
                const rz = (Math.random() > 0.5 ? 1 : -1) * (6 + Math.floor(Math.random() * 10));
                await bot.pathfinder.goto(
                    new goals.GoalNear(bot.entity.position.x + rx, bot.entity.position.y, bot.entity.position.z + rz, 3),
                    { timeout: 5000 }
                );
                await sleep(400);
            } catch {}
        } else {
            // Hiçbir şey koyulmadı → belki bot yanlış yerde, biraz dolaş
            await randomSmallOffset();
        }

        await sleep(180 + Math.random() * 220);
    }

    console.log("[build] 10 saniye bitti");

    // Tekrar için kontrol (daha geniş)
    const hasBlocks = bot.inventory.items().some(i => i.count > 0 && (
        i.name.includes('farmland') || i.name.includes('dirt') || i.name.includes('stone') ||
        i.name.includes('planks') || i.name.includes('wool') || i.name.includes('concrete')
    ));

    if (hasBlocks) {
        setTimeout(fastBuild9x9WithCenterHole, 1500);
    } else {
        bot.chat("9×9 (orta boş) tamam – blok kalmadı");
    }
}
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

                    await sleep(140 + Math.random() * 100);
                }

            } catch (err) {
                console.log("[seed hata]", err.message?.substring(0, 100) || err);
            }

            await sleep(6000 + Math.random() * 7000);
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