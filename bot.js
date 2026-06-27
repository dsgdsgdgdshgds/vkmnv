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
        username: 'Hateke',
        version: '1.21'
    });

    bot.loadPlugin(pathfinder);

    let systemsStarted = false;
    let spawnProcessed = false;
    let waitingForPickaxe = false;

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

    bot.on('spawn', () => {
        console.log('[!] Spawn. Version:', bot.version);
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
        console.log('[✓] Sistemler başlatıldı.');

        bot.on('playerCollect', () => {
            if (waitingForPickaxe && hasDiamondPickaxe()) {
                console.log('[kazma] Kazma geldi, devam.');
                waitingForPickaxe = false;
            }
        });

        miningLoop();
        dropDiamondsLoop();
    }

    // ─────────────────────────────────────────
    //   YARDIMCILAR
    // ─────────────────────────────────────────
    function hasDiamondPickaxe() {
        return bot.inventory.items().some(i => i.name === 'diamond_pickaxe');
    }
    function getDiamondCount() {
        return bot.inventory.items()
            .filter(i => i.name === 'diamond')
            .reduce((s, i) => s + i.count, 0);
    }
    function equipPickaxe() {
        const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe');
        if (pick) bot.equip(pick, 'hand').catch(() => {});
    }

    // Tek blok kaz — hata sessiz
    async function digBlock(block) {
        if (!block || !block.diggable) return false;
        try {
            await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), false);
            await sleep(60);
            // blok hâlâ orada mı?
            const check = bot.blockAt(block.position);
            if (!check || check.type !== block.type) return false;
            await bot.dig(check, true);
            return true;
        } catch (e) {
            const m = e.message || '';
            if (!m.includes('diggable') && !m.includes('No block') && !m.includes('aborted') && !m.includes('dig')) {
                console.log('[dig]', m.slice(0, 60));
            }
            return false;
        }
    }

    // ─────────────────────────────────────────
    //   ANA MADENCİLİK DÖNGÜSÜ
    //   Strip mining: X yönünde düz tünel, her
    //   adımda yan/üst/alt elmas taraması
    // ─────────────────────────────────────────
    const TARGET_Y = -58;

    async function miningLoop() {
        while (true) {
            // Kazma kontrolü
            if (!hasDiamondPickaxe()) {
                if (!waitingForPickaxe) {
                    console.log('[kazma] Kazma yok → bekleniyor...');
                    waitingForPickaxe = true;
                    try { bot.pathfinder.setGoal(null); } catch {}
                }
                await sleep(2000);
                continue;
            }
            waitingForPickaxe = false;
            equipPickaxe();

            try {
                // 1. Önce görünen elmasa bak (chunk yüklüyse)
                const visible = bot.findBlocks({
                    matching: b => b.name === 'diamond_ore' || b.name === 'deepslate_diamond_ore',
                    maxDistance: 16,
                    count: 5
                });

                if (visible.length > 0) {
                    const pos = bot.entity.position;
                    visible.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));
                    await mineOreVein(visible[0]);
                    continue;
                }

                // 2. Elmas yok → strip mining
                await stripMineStep();

            } catch (err) {
                console.log('[loop hata]', err.message?.slice(0, 80));
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   DAMAR KAZMA: Elmasa git + komşuları da kaz
    // ─────────────────────────────────────────
    async function mineOreVein(startPos) {
        // Önce elmasa yaklaş
        try {
            await bot.pathfinder.goto(
                new goals.GoalNear(startPos.x, startPos.y, startPos.z, 2),
                { timeout: 12000 }
            );
        } catch {
            return;
        }

        // Komşu elmasları da topla (damar kazma)
        const toMine = [startPos];
        const mined = new Set();

        while (toMine.length > 0) {
            if (!hasDiamondPickaxe()) break;

            const pos = toMine.shift();
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (mined.has(key)) continue;
            mined.add(key);

            const block = bot.blockAt(pos);
            if (!block || (block.name !== 'diamond_ore' && block.name !== 'deepslate_diamond_ore')) continue;

            // 1 blok içine gel
            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(pos.x, pos.y, pos.z, 2),
                    { timeout: 8000 }
                );
            } catch {}

            const ok = await digBlock(block);
            if (ok) {
                console.log(`[✓] Elmas kazıldı! Toplam: ${getDiamondCount()}`);
                // Komşuları kontrol et
                const neighbors = [
                    pos.offset(1,0,0), pos.offset(-1,0,0),
                    pos.offset(0,1,0), pos.offset(0,-1,0),
                    pos.offset(0,0,1), pos.offset(0,0,-1),
                ];
                for (const n of neighbors) {
                    const nb = bot.blockAt(n);
                    if (nb && (nb.name === 'diamond_ore' || nb.name === 'deepslate_diamond_ore')) {
                        toMine.push(n);
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────
    //   STRİP MİNİNG: 2 blok yüksek tünel kaz
    //   Her adımda yan duvarları tara
    // ─────────────────────────────────────────
    let stripDir = 1; // +X yönü, karşıya gelince -X
    let stripStep = 0;
    const STRIP_LENGTH = 50;

    async function stripMineStep() {
        const pos = bot.entity.position;

        // Y=-58'e in (gerekirse)
        if (Math.abs(pos.y - TARGET_Y) > 2) {
            console.log(`[strip] Y=${Math.floor(pos.y)} → ${TARGET_Y}'e iniliyor`);
            try {
                await bot.pathfinder.goto(
                    new goals.GoalY(TARGET_Y),
                    { timeout: 30000 }
                );
            } catch {
                // İnemezse önündeki bloğu kaz
                const down = bot.blockAt(pos.offset(0, -1, 0));
                if (down && down.diggable) await digBlock(down);
            }
            return;
        }

        // İleri doğru 1 adım kazan (2 blok yüksek tünel)
        const cx = Math.floor(pos.x);
        const cy = TARGET_Y;
        const cz = Math.floor(pos.z);

        const nx = cx + stripDir;

        // Ayak hizası + baş hizası
        const footBlock = bot.blockAt({ x: nx, y: cy, z: cz });
        const headBlock = bot.blockAt({ x: nx, y: cy + 1, z: cz });

        let dug = false;
        if (footBlock && footBlock.diggable && footBlock.name !== 'air') {
            await digBlock(footBlock);
            dug = true;
        }
        if (headBlock && headBlock.diggable && headBlock.name !== 'air') {
            await digBlock(headBlock);
            dug = true;
        }

        // İleri git
        try {
            await bot.pathfinder.goto(
                new goals.GoalBlock(nx, cy, cz),
                { timeout: 5000 }
            );
        } catch {}

        // Yan duvarlara bak (elmas taraması — 3 kat)
        for (let dy = -1; dy <= 2; dy++) {
            for (const side of [-1, 1]) {
                const sideBlock = bot.blockAt({ x: nx, y: cy + dy, z: cz + side });
                if (sideBlock && (sideBlock.name === 'diamond_ore' || sideBlock.name === 'deepslate_diamond_ore')) {
                    console.log('[scan] Yanda elmas!');
                    await mineOreVein(sideBlock.position);
                }
                // Z yönünde de tara
                const sideBlock2 = bot.blockAt({ x: nx + side, y: cy + dy, z: cz });
                if (sideBlock2 && (sideBlock2.name === 'diamond_ore' || sideBlock2.name === 'deepslate_diamond_ore')) {
                    console.log('[scan] Önde elmas!');
                    await mineOreVein(sideBlock2.position);
                }
            }
        }

        stripStep++;
        if (stripStep >= STRIP_LENGTH) {
            stripStep = 0;
            stripDir *= -1;
            console.log('[strip] Yön değişti');
        }

        // Dug olmadıysa (hava tünel) hızlıca geç
        if (!dug) await sleep(50);
    }

    // ─────────────────────────────────────────
    //   ELMAS ATMA — 10 olunca
    // ─────────────────────────────────────────
    async function dropDiamondsLoop() {
        while (true) {
            await sleep(3000);
            if (getDiamondCount() < 10) continue;

            const players = Object.values(bot.players).filter(
                p => p.entity && p.username !== bot.username
            );
            if (players.length === 0) { console.log('[elmas] Oyuncu yok'); continue; }

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
                        nearest.entity.position.z, 2
                    ),
                    { timeout: 20000 }
                );
            } catch { console.log('[elmas] Gidilemedi'); }

            for (const item of bot.inventory.items().filter(i => i.name === 'diamond')) {
                try {
                    await bot.toss(item.type, null, item.count);
                    console.log(`[elmas] ${item.count} atıldı → ${nearest.username}`);
                    await sleep(300);
                } catch (e) { console.log('[toss]', e.message); }
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