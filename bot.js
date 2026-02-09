const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createBot() {
    console.log('--- [Sistem] Bot Başlatılıyor ---');
    
    const bot = mineflayer.createBot({
        host: 'play.reborncraft.pw',
        port: 25565,
        username: 'slimy_koala',
        version: '1.21'
    });

    bot.loadPlugin(pathfinder);

    let isSelling = false;
    let systemsStarted = false;
    let spawnProcessed = false;

    // ──────────────────────────────
    //    SENİN ORİJİNAL GİRİŞ KISMI
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
        movements.maxDropDown = 4;
        
        bot.pathfinder.setMovements(movements);
        
        console.log('[✓] Hasat ve satış sistemleri başlatıldı.');
        
        // sadece tek döngü: sürekli en yakına yürü + yolda 5 buğday kır
        continuousHarvestAndMoveLoop();
        sellLoop();
    }

    // ───────────────────────────────────────────────
    //   SÜREKLİ EN YAKIN BUĞDAYA YÜRÜ + YOLDA 5 BUĞDAY KIR
    // ───────────────────────────────────────────────
    async function continuousHarvestAndMoveLoop() {
        while (true) {
            if (isSelling || !bot.entity?.position) {
                await sleep(800);
                continue;
            }

            try {
                // 1. Etrafta olgun buğday ara (65 blok)
                const candidates = bot.findBlocks({
                    matching: block => block.name === 'wheat' && block.metadata === 7,
                    maxDistance: 65,
                    count: 12
                });

                if (candidates.length === 0) {
                    console.log("[harvest] 65 blok içinde olgun buğday yok → bekleniyor");
                    await sleep(8000 + Math.random() * 6000);
                    continue;
                }

                // en yakını seç
                candidates.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b));
                const targetPos = candidates[0];
                const distance = bot.entity.position.distanceTo(targetPos);

                console.log(`[→] Hedef: ${distance.toFixed(1)} blok uzakta`);

                // 2. Yolda/çevrede max 5 buğday kır (hedefe giderken)
                let brokenCount = 0;
                const pathBlocks = bot.findBlocks({
                    matching: b => b.name === 'wheat' && b.metadata === 7,
                    maxDistance: 6,   // yakın çevre
                    count: 8
                });

                // en yakından kırılacak şekilde sırala
                pathBlocks.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b));

                for (const pos of pathBlocks) {
                    if (brokenCount >= 6) break;
                    
                    const block = bot.blockAt(pos);
                    if (!block || block.name !== 'wheat' || block.metadata !== 7) continue;

                    try {
                        await bot.dig(block);
                        brokenCount++;
                        await sleep(70 + Math.random() * 90); // biraz doğal gecikme
                    } catch {}
                }

                if (brokenCount > 0) {
                    console.log(`[ kırıldı ] yolda ${brokenCount} buğday kırıldı`);
                }

                // 3. Hedefe yürü (tam buğdayın üstüne değil, yanına)
                if (distance > 4.5) {
                    try {
                        await bot.pathfinder.goto(
                            new goals.GoalNear(targetPos.x, targetPos.y + 1, targetPos.z, 2.8),
                            { timeout: 14000 }
                        );
                        await sleep(60 + Math.random() * 70);
                    } catch (pathErr) {
                        console.log("[path hata]", pathErr.message?.substring(0, 70) || pathErr);
                        await randomSmallOffset();
                    }
                } else {
                    // çok yakınsa → son bir buğdayı da kırabiliriz
                    const block = bot.blockAt(targetPos);
                    if (block && block.name === 'wheat' && block.metadata === 7) {
                        try {
                            await bot.dig(block);
                            console.log("[kırıldı] Hedef buğday kırıldı");
                        } catch {}
                    }
                    await sleep(400 + Math.random() * 600);
                }

            } catch (err) {
                console.log("[loop hata]", err.message?.substring(0, 80) || err);
            }

            await sleep(200 + Math.random() * 500); // 0.9 – 2 sn arası bekleme
        }
    }

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
                { timeout: 6000 }
            );
        } catch {}
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

            if (totalWheat >= 320) {
                isSelling = true;
                console.log(`[sat] ${totalWheat} buğday → /sell all`);

                bot.pathfinder.setGoal(null);
                await sleep(1800 + Math.random() * 800);

                bot.chat('/sell all');
                await sleep(7200 + Math.random() * 3000);

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