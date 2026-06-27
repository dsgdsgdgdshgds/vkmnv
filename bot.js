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
        host: '78.167.243.121',
        port: 25565,
        username: 'Awe'
    });

    bot.loadPlugin(pathfinder);

    let systemsStarted = false;
    let spawnProcessed = false;
    let waitingForPickaxe = false;

    // ──────────────────────────────
    //    GİRİŞ KISMI
    // ──────────────────────────────
    async function performLoginSequence() {
        if (systemsStarted) return;

        console.log('[→] Login sırası başlatılıyor...');

        try {
            await sleep(30000);
            bot.chat(`/register Batuhan78 Batuhan78`);
            console.log('[→] /login gönderildi');

            await sleep(30000);
            bot.chat('/login Batuhan78');
            console.log('[→] /skyblock gönderildi');

            await sleep(30000);

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
        const movements = new Movements(bot);

        movements.canDig = true;
        movements.canJump = true;
        movements.allowSprinting = true;
        movements.allowParkour = true;
        movements.allow1by1 = true;
        movements.maxDropDown = 5;

        bot.pathfinder.setMovements(movements);

        console.log('[✓] Elmas madenciliği sistemi başlatıldı.');

        // Envanter değişimini izle (kazma gelince uyar)
        bot.on('playerCollect', () => {
            if (waitingForPickaxe && hasDiamondPickaxe()) {
                console.log('[kazma] Elmas kazma envantere geldi, devam ediliyor.');
                waitingForPickaxe = false;
            }
        });

        diamondMiningLoop();
        dropDiamondsLoop();
    }

    // ──────────────────────────────
    //   YARDIMCI FONKSİYONLAR
    // ──────────────────────────────
    function hasDiamondPickaxe() {
        return bot.inventory.items().some(
            i => i.name === 'diamond_pickaxe' && i.durabilityUsed < (i.maxDurability || 1561)
        );
    }

    function getDiamondCount() {
        return bot.inventory.items()
            .filter(i => i.name === 'diamond')
            .reduce((sum, item) => sum + item.count, 0);
    }

    function equipBestPickaxe() {
        const pickaxe = bot.inventory.items().find(
            i => i.name === 'diamond_pickaxe' && i.durabilityUsed < (i.maxDurability || 1561)
        );
        if (pickaxe) {
            bot.equip(pickaxe, 'hand').catch(() => {});
        }
    }

    // ──────────────────────────────
    //   ELMAS MADENCİLİĞİ DÖNGÜSÜ
    //   Y = -58 seviyesinde elmas arar
    // ──────────────────────────────
    async function diamondMiningLoop() {
        while (true) {
            // Kazma kırıksa bekle
            if (!hasDiamondPickaxe()) {
                if (!waitingForPickaxe) {
                    console.log('[kazma] Elmas kazma yok veya kırık → bekleniyor...');
                    waitingForPickaxe = true;
                    bot.pathfinder.setGoal(null);
                }
                await sleep(2000);
                continue;
            }

            waitingForPickaxe = false;
            equipBestPickaxe();

            try {
                // -58 katında elmas ara
                const diamonds = bot.findBlocks({
                    matching: block => block.name === 'diamond_ore' || block.name === 'deepslate_diamond_ore',
                    maxDistance: 32,
                    count: 10
                });

                if (diamonds.length === 0) {
                    console.log('[maden] Yakında elmas yok → rastgele kazmaya devam...');
                    await mineRandomly();
                    continue;
                }

                // En yakın elması seç
                const pos = bot.entity.position;
                diamonds.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));
                const target = diamonds[0];

                console.log(`[maden] Elmas bulundu: ${target.x}, ${target.y}, ${target.z}`);

                // Elmasa git
                try {
                    await bot.pathfinder.goto(
                        new goals.GoalNear(target.x, target.y, target.z, 3),
                        { timeout: 15000 }
                    );
                } catch {
                    console.log('[path] Elmasa gidilemedi, yakındaki kazılabilir bloğu ara');
                    await mineRandomly();
                    continue;
                }

                // Kazma kırıldı mı kontrol et
                if (!hasDiamondPickaxe()) continue;

                // Elmas bloğunu kaz
                const block = bot.blockAt(target);
                if (!block || (block.name !== 'diamond_ore' && block.name !== 'deepslate_diamond_ore')) continue;

                await bot.lookAt(target.offset(0.5, 0.5, 0.5), false);
                await sleep(100);

                try {
                    await bot.dig(block, true);
                    console.log('[maden] Elmas kazıldı!');
                } catch (digErr) {
                    const msg = digErr.message || '';
                    if (msg.includes('is not diggable') || msg.includes('No block') || msg.includes('Digging aborted')) {
                        // sessiz geç
                    } else {
                        console.log('[dig uyarı]', msg.substring(0, 80));
                    }
                }

            } catch (err) {
                console.log('[maden hata]', err.message?.substring(0, 90) || err);
            }

            await sleep(200 + Math.random() * 300);
        }
    }

    // Yakında elmas yoksa -58'de rastgele tünel kaz
    async function mineRandomly() {
        if (!hasDiamondPickaxe()) return;

        const pos = bot.entity.position;
        const targetY = -58;

        // Önce -58 katına in
        if (Math.abs(pos.y - targetY) > 3) {
            const directions = [
                { x: pos.x, z: pos.z },
                { x: pos.x + 10, z: pos.z },
                { x: pos.x - 10, z: pos.z },
                { x: pos.x, z: pos.z + 10 },
                { x: pos.x, z: pos.z - 10 },
            ];

            for (const dir of directions) {
                try {
                    await bot.pathfinder.goto(
                        new goals.GoalXZ(dir.x, dir.z),
                        { timeout: 5000 }
                    );
                    break;
                } catch { continue; }
            }
        }

        // Önündeki bloğu kaz (tünel)
        const yaw = bot.entity.yaw;
        const dx = -Math.sin(yaw);
        const dz = -Math.cos(yaw);

        const frontBlock = bot.blockAt(
            bot.entity.position.offset(
                Math.round(dx) * 2,
                0,
                Math.round(dz) * 2
            )
        );

        if (frontBlock && frontBlock.diggable) {
            try {
                await bot.lookAt(frontBlock.position.offset(0.5, 0.5, 0.5), false);
                await sleep(80);
                await bot.dig(frontBlock, true);
            } catch { /* sessiz */ }
        } else {
            // Yön değiştir
            await sleep(1500 + Math.random() * 1500);
            bot.entity.yaw = Math.random() * Math.PI * 2;
        }
    }

    // ──────────────────────────────
    //   ELMAS ATMA DÖNGÜSÜ
    //   10 elmas olunca en yakın oyuncuya git ve at
    // ──────────────────────────────
    async function dropDiamondsLoop() {
        while (true) {
            await sleep(3000);

            const diamondCount = getDiamondCount();
            if (diamondCount < 10) continue;

            console.log(`[elmas] ${diamondCount} elmas var → en yakın oyuncuya gidiliyor`);

            // En yakın oyuncuyu bul (kendisi hariç)
            const players = Object.values(bot.players).filter(
                p => p.entity && p.username !== bot.username
            );

            if (players.length === 0) {
                console.log('[elmas] Yakında oyuncu yok, bekleniyor...');
                continue;
            }

            const pos = bot.entity.position;
            players.sort((a, b) =>
                pos.distanceTo(a.entity.position) - pos.distanceTo(b.entity.position)
            );

            const nearest = players[0];
            console.log(`[elmas] En yakın oyuncu: ${nearest.username}`);

            // Oyuncuya git
            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(
                        nearest.entity.position.x,
                        nearest.entity.position.y,
                        nearest.entity.position.z,
                        2
                    ),
                    { timeout: 20000 }
                );
            } catch {
                console.log('[elmas] Oyuncuya gidilemedi, yerinde at');
            }

            // Elmasları at
            const diamonds = bot.inventory.items().filter(i => i.name === 'diamond');
            for (const item of diamonds) {
                try {
                    await bot.toss(item.type, null, item.count);
                    console.log(`[elmas] ${item.count} elmas atıldı → ${nearest.username}`);
                    await sleep(300);
                } catch (tossErr) {
                    console.log('[elmas] Atma hatası:', tossErr.message);
                }
            }

            console.log('[elmas] Elmaslar teslim edildi, madenciliğe devam...');
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