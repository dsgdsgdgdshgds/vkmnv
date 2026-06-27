const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
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
        host: '78.167.243.121',
        port: 25565,
        username: 'Awe',
        version: '1.21.4'
    });

    bot.loadPlugin(pathfinder);

    let systemsStarted = false;
    let spawnProcessed = false;
    let waitingForPickaxe = false;

    // ──────────────────────────────
    //    GİRİŞ
    // ──────────────────────────────
    async function performLoginSequence() {
        if (systemsStarted) return;
        console.log('[→] Login sırası başlatılıyor...');
        try {
            await sleep(30000);
            bot.chat(`/login ${process.env.SIFRE}`);
            console.log('[→] /login gönderildi');

            await sleep(30000);
            bot.chat('/skyblock');
            console.log('[→] /skyblock gönderildi');

            await sleep(30000);
            systemsStarted = true;
            startSystems();
        } catch (err) {
            console.log('[!] Giriş hatası:', err.message);
        }
    }

    bot.once('spawn', () => {
        console.log('[!] Bot spawn oldu. version:', bot.version);
        if (spawnProcessed) return;
        spawnProcessed = true;

        // Movements burada oluşturuluyor — bot.version artık kesinlikle hazır
        try {
            const movements = new Movements(bot);
            movements.canDig = true;
            movements.canJump = true;
            movements.allowSprinting = true;
            movements.allowParkour = true;
            movements.allow1by1 = true;
            movements.maxDropDown = 5;
            bot.pathfinder.setMovements(movements);
            console.log('[✓] Pathfinder hazır.');
        } catch (e) {
            console.log('[!] Movements hatası:', e.message);
        }

        performLoginSequence();
    });

    // ──────────────────────────────
    //    SİSTEMLER
    // ──────────────────────────────
    function startSystems() {
        console.log('[✓] Elmas madenciliği sistemi başlatıldı.');

        bot.on('playerCollect', () => {
            if (waitingForPickaxe && hasDiamondPickaxe()) {
                console.log('[kazma] Elmas kazma geldi, devam ediliyor.');
                waitingForPickaxe = false;
            }
        });

        diamondMiningLoop();
        dropDiamondsLoop();
    }

    // ──────────────────────────────
    //    YARDIMCILAR
    // ──────────────────────────────
    function hasDiamondPickaxe() {
        return bot.inventory.items().some(i => i.name === 'diamond_pickaxe');
    }

    function getDiamondCount() {
        return bot.inventory.items()
            .filter(i => i.name === 'diamond')
            .reduce((s, i) => s + i.count, 0);
    }

    function equipBestPickaxe() {
        const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe');
        if (pick) bot.equip(pick, 'hand').catch(() => {});
    }

    // ──────────────────────────────
    //    ELMAS MADENCİLİĞİ — Y=-58
    // ──────────────────────────────
    async function diamondMiningLoop() {
        while (true) {
            if (!hasDiamondPickaxe()) {
                if (!waitingForPickaxe) {
                    console.log('[kazma] Elmas kazma yok → bekleniyor...');
                    waitingForPickaxe = true;
                    try { bot.pathfinder.setGoal(null); } catch {}
                }
                await sleep(2000);
                continue;
            }

            waitingForPickaxe = false;
            equipBestPickaxe();

            try {
                const diamonds = bot.findBlocks({
                    matching: b => b.name === 'diamond_ore' || b.name === 'deepslate_diamond_ore',
                    maxDistance: 32,
                    count: 10
                });

                if (diamonds.length === 0) {
                    await mineRandomly();
                    continue;
                }

                const pos = bot.entity.position;
                diamonds.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));
                const target = diamonds[0];

                console.log(`[maden] Elmas: ${target.x} ${target.y} ${target.z}`);

                try {
                    await bot.pathfinder.goto(
                        new goals.GoalNear(target.x, target.y, target.z, 3),
                        { timeout: 15000 }
                    );
                } catch {
                    await mineRandomly();
                    continue;
                }

                if (!hasDiamondPickaxe()) continue;

                const block = bot.blockAt(target);
                if (!block || (block.name !== 'diamond_ore' && block.name !== 'deepslate_diamond_ore')) continue;

                await bot.lookAt(target.offset(0.5, 0.5, 0.5), false);
                await sleep(100);

                try {
                    await bot.dig(block, true);
                    console.log('[maden] ✓ Elmas kazıldı!');
                } catch (e) {
                    const m = e.message || '';
                    if (!m.includes('diggable') && !m.includes('No block') && !m.includes('aborted')) {
                        console.log('[dig]', m.slice(0, 80));
                    }
                }

            } catch (err) {
                console.log('[maden hata]', err.message?.slice(0, 90));
            }

            await sleep(200 + Math.random() * 300);
        }
    }

    async function mineRandomly() {
        if (!hasDiamondPickaxe()) return;

        // Önünde ne varsa kaz
        const yaw = bot.entity.yaw;
        const dx = Math.round(-Math.sin(yaw));
        const dz = Math.round(-Math.cos(yaw));
        const pos = bot.entity.position;

        for (let i = 1; i <= 3; i++) {
            const b = bot.blockAt(pos.offset(dx * i, 0, dz * i));
            if (b && b.diggable && b.name !== 'air') {
                try {
                    await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), false);
                    await sleep(80);
                    await bot.dig(b, true);
                } catch {}
                break;
            }
        }

        await sleep(500 + Math.random() * 500);
    }

    // ──────────────────────────────
    //    ELMAS ATMA — 10 olunca
    // ──────────────────────────────
    async function dropDiamondsLoop() {
        while (true) {
            await sleep(3000);

            if (getDiamondCount() < 10) continue;

            const players = Object.values(bot.players).filter(
                p => p.entity && p.username !== bot.username
            );

            if (players.length === 0) {
                console.log('[elmas] Oyuncu yok, bekle...');
                continue;
            }

            const pos = bot.entity.position;
            players.sort((a, b) =>
                pos.distanceTo(a.entity.position) - pos.distanceTo(b.entity.position)
            );
            const nearest = players[0];
            console.log(`[elmas] ${getDiamondCount()} elmas → ${nearest.username}`);

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
                console.log('[elmas] Gidilemedi, yerinde at');
            }

            for (const item of bot.inventory.items().filter(i => i.name === 'diamond')) {
                try {
                    await bot.toss(item.type, null, item.count);
                    console.log(`[elmas] ${item.count} atıldı`);
                    await sleep(300);
                } catch (e) {
                    console.log('[elmas toss]', e.message);
                }
            }
        }
    }

    bot.on('end', reason => {
        console.log(`[!] Bağlantı kesildi: ${reason}`);
        systemsStarted = false;
        spawnProcessed = false;
        setTimeout(createBot, 14000);
    });

    bot.on('kicked', reason => console.log('[ATILDI]', JSON.stringify(reason)));
    bot.on('error', err => console.log('[HATA]', err.message));
}

createBot();