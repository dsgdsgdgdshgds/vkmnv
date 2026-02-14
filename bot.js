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
// ───────────────────────────────────────────────
//   10 SANİYEDE RASTGELE EŞYA İLE 9×9 ALAN 
//   → SADECE TAM ORTADAKİ 1 BLOK BOŞ KALACAK
// ───────────────────────────────────────────────
async function fastBuild9x9WithCenterHole() {
    console.log("[build] 10sn içinde 9×9 (sadece orta boş) başlıyor");

    const timeoutMs = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        // Envanterden rastgele uygun BLOK eşya seç
        const placeable = bot.inventory.items().find(item => {
            if (item.count < 1) return false;
            
            const blockName = item.name;
            
            // Sadece koyulabilir bloklar
            const nonPlaceable = [
                "air", "water_bucket", "lava_bucket", "potion", "splash_potion", 
                "lingering_potion", "arrow", "spectral_arrow", "tipped_arrow", 
                "shield", "elytra", "boat", "minecart", "chest_minecart",
                "furnace_minecart", "tnt_minecart", "hopper_minecart", 
                "command_block_minecart", "farmland", "wheat_seeds", "wheat",
                "beetroot_seeds", "melon_seeds", "pumpkin_seeds", "potato", 
                "carrot", "bone_meal", "string", "stick", "diamond", "iron_ingot",
                "gold_ingot", "emerald", "coal", "redstone", "lapis_lazuli",
                "wheat", "cactus", "sugar_cane", "sapling"
            ];
            
            if (nonPlaceable.includes(blockName)) return false;
            if (blockName.includes("bucket")) return false;
            if (blockName.includes("seeds")) return false;
            if (blockName.includes("sapling")) return false;
            if (blockName.endsWith("_helmet")) return false;
            if (blockName.endsWith("_chestplate")) return false;
            if (blockName.endsWith("_leggings")) return false;
            if (blockName.endsWith("_boots")) return false;
            if (blockName.endsWith("_sword")) return false;
            if (blockName.endsWith("_pickaxe")) return false;
            if (blockName.endsWith("_axe")) return false;
            if (blockName.endsWith("_shovel")) return false;
            if (blockName.endsWith("_hoe")) return false;
            
            // Sadece solid blokları kabul et
            const validBlocks = [
                "stone", "cobblestone", "dirt", "grass_block", "podzol", "mycelium",
                "coarse_dirt", "rooted_dirt", "mud", "packed_mud", "mud_bricks",
                "sand", "red_sand", "gravel", "clay", "snow_block", "ice", "packed_ice",
                "blue_ice", "obsidian", "crying_obsidian", "netherrack", "soul_sand",
                "soul_soil", "basalt", "smooth_basalt", "blackstone", "end_stone",
                "granite", "diorite", "andesite", "calcite", "tuff", "dripstone_block",
                "moss_block", "deepslate", "cobbled_deepslate", "polished_deepslate",
                "bricks", "stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks",
                "chiseled_stone_bricks", "deepslate_bricks", "deepslate_tiles",
                "planks", "log", "wood", "stripped_log", "stripped_wood",
                "glass", "tinted_glass", "white_wool", "orange_wool", "magenta_wool",
                "light_blue_wool", "yellow_wool", "lime_wool", "pink_wool", "gray_wool",
                "light_gray_wool", "cyan_wool", "purple_wool", "blue_wool", "brown_wool",
                "green_wool", "red_wool", "black_wool", "white_concrete", "orange_concrete",
                "magenta_concrete", "light_blue_concrete", "yellow_concrete", "lime_concrete",
                "pink_concrete", "gray_concrete", "light_gray_concrete", "cyan_concrete",
                "purple_concrete", "blue_concrete", "brown_concrete", "green_concrete",
                "red_concrete", "black_concrete", "white_terracotta", "orange_terracotta",
                "magenta_terracotta", "light_blue_terracotta", "yellow_terracotta",
                "lime_terracotta", "pink_terracotta", "gray_terracotta", "light_gray_terracotta",
                "cyan_terracotta", "purple_terracotta", "blue_terracotta", "brown_terracotta",
                "green_terracotta", "red_terracotta", "black_terracotta", "terracotta"
            ];
            
            return validBlocks.includes(blockName);
        });

        if (!placeable) {
            console.log("[build] Koyulabilir blok kalmadı (dirt, cobblestone, stone vb. gerekli)");
            bot.chat("Envanterde yapı bloğu kalmadı → 9×9 durduruldu");
            return;
        }

        console.log(`[build] Kullanılan: ${placeable.name} (${placeable.count})`);

        try {
            await bot.equip(placeable, "hand");
            await sleep(100); // Eşya değiştirme için bekle
        } catch (e) {
            console.log("[build] Eşya eline alınamadı:", e.message);
            await sleep(400);
            continue;
        }

        const botPos = bot.entity.position.floored();
        const centerX = botPos.x;
        const centerZ = botPos.z;
        const placeY = botPos.y - 1;

        let placedCount = 0;

        // 9×9 alan tarama (dx -4 → +4, dz -4 → +4)
        for (let dx = -4; dx <= 4; dx++) {
            for (let dz = -4; dz <= 4; dz++) {
                if (Date.now() - startTime >= timeoutMs) break;

                // TAM ORTA → atla (boş bırak)
                if (dx === 0 && dz === 0) continue;

                const targetPos = new Vec3(centerX + dx, placeY, centerZ + dz);

                const current = bot.blockAt(targetPos);
                if (!current || (current.name !== "air" && current.name !== "cave_air")) continue;

                // Altında destek olmalı - placeBlock için reference block (tıklanan blok)
                const referencePos = targetPos.offset(0, -1, 0);
                const referenceBlock = bot.blockAt(referencePos);
                
                if (!referenceBlock || referenceBlock.name === "air" || referenceBlock.name === "cave_air") continue;
                if (!referenceBlock.boundingBox || referenceBlock.boundingBox === 'empty') continue;

                try {
                    // Bot'un hedefe bakması
                    await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
                    await sleep(50 + Math.random() * 50);

                    // placeBlock: referenceBlock'a tıklayıp üstüne (yukarı yön) koy
                    await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                    
                    placedCount++;
                    console.log(`[build] Blok koyuldu: ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`);

                    // Her 8 blokta ufak mola
                    if (placedCount % 8 === 0) {
                        await sleep(150);
                    }
                } catch (err) {
                    console.log(`[build hata] ${err.message || err}`);
                }
            }
            if (Date.now() - startTime >= timeoutMs) break;
        }

        console.log(`[build] Bu seferde ${placedCount} blok koyuldu`);

        // Eğer blok koyulabildiyse ve zaman varsa yan tarafa git
        if (placedCount > 3) {
            try {
                const offsetX = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 10);
                const offsetZ = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 10);

                await bot.pathfinder.goto(
                    new goals.GoalNear(
                        bot.entity.position.x + offsetX,
                        bot.entity.position.y,
                        bot.entity.position.z + offsetZ,
                        3.5
                    ),
                    { timeout: 8000 }
                );
                await sleep(600);
            } catch {}
        } else if (placedCount === 0) {
            // Hiç koyamadıysak biraz bekle ve tekrar dene
            await sleep(500);
        }

        await sleep(200 + Math.random() * 300);
    }

    console.log("[build] 10 saniye bitti");

    // Envanterde hala blok varsa tekrar başla
    const hasMoreBlocks = bot.inventory.items().some(item => {
        if (item.count < 1) return false;
        const blockName = item.name;
        
        const validBlocks = [
            "stone", "cobblestone", "dirt", "grass_block", "podzol", "mycelium",
            "coarse_dirt", "rooted_dirt", "mud", "packed_mud", "mud_bricks",
            "sand", "red_sand", "gravel", "clay", "snow_block", "ice", "packed_ice",
            "blue_ice", "obsidian", "crying_obsidian", "netherrack", "soul_sand",
            "soul_soil", "basalt", "smooth_basalt", "blackstone", "end_stone",
            "granite", "diorite", "andesite", "calcite", "tuff", "dripstone_block",
            "moss_block", "deepslate", "cobbled_deepslate", "polished_deepslate",
            "bricks", "stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks",
            "chiseled_stone_bricks", "deepslate_bricks", "deepslate_tiles",
            "planks", "log", "wood","farmland", "Farmland", "stripped_log", "stripped_wood",
            "glass", "tinted_glass"
        ];
        
        return validBlocks.includes(blockName);
    });
    
    if (hasMoreBlocks) {
        setTimeout(fastBuild9x9WithCenterHole, 1000);
    } else {
        bot.chat("Envanter bitti — 9×9 (orta boş) tamamlandı");
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
