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

        // Düşen elmas item'larını otomatik topla
        bot.on('entitySpawn', (entity) => {
            if (entity.name === 'item') {
                const meta = entity.metadata;
                // item entity'sinin adını kontrol et
                try {
                    const itemData = meta?.find(m => m?.value?.itemId !== undefined);
                    if (itemData) {
                        // elmas mı diye yakın mı diye kontrol
                        const dist = bot.entity.position.distanceTo(entity.position);
                        if (dist < 10) {
                            collectNearbyItems();
                        }
                    }
                } catch {}
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

    // Yakındaki item'ları topla (en fazla 3 sn bekle)
    async function collectNearbyItems() {
        const items = Object.values(bot.entities).filter(e =>
            e.name === 'item' &&
            bot.entity.position.distanceTo(e.position) < 8
        );
        if (items.length === 0) return;

        // En yakın item'a git
        items.sort((a, b) =>
            bot.entity.position.distanceTo(a.position) -
            bot.entity.position.distanceTo(b.position)
        );

        for (const item of items.slice(0, 5)) {
            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(
                        item.position.x,
                        item.position.y,
                        item.position.z,
                        1
                    ),
                    { timeout: 3000 }
                );
                await sleep(200);
            } catch {}
        }
    }

    // Tek blok kaz
    async function digBlock(block) {
        if (!block || !block.diggable || block.name === 'air') return false;
        try {
            await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), false);
            await sleep(50);
            const check = bot.blockAt(block.position);
            if (!check || check.name === 'air' || check.type !== block.type) return false;
            await bot.dig(check, true);
            await sleep(100); // drop'un spawn olması için bekle
            return true;
        } catch (e) {
            const m = e.message || '';
            if (!m.includes('diggable') && !m.includes('No block') &&
                !m.includes('aborted') && !m.includes('dig')) {
                console.log('[dig]', m.slice(0, 60));
            }
            return false;
        }
    }

    // Pathfinder ile git, takılırsa force move
    async function moveTo(x, y, z, range = 2, timeout = 6000) {
        try {
            await bot.pathfinder.goto(
                new goals.GoalNear(x, y, z, range),
                { timeout }
            );
            return true;
        } catch {
            // Takıldı — durumu sıfırla
            try { bot.pathfinder.setGoal(null); } catch {}
            // Küçük zıplama
            bot.setControlState('jump', true);
            await sleep(300);
            bot.setControlState('jump', false);
            return false;
        }
    }

    // ─────────────────────────────────────────
    //   ANA MADENCİLİK DÖNGÜSÜ
    // ─────────────────────────────────────────
    const TARGET_Y = -58;
    let stripDir = 1;
    let stripStep = 0;
    const STRIP_LENGTH = 60;

    async function miningLoop() {
        while (true) {
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
                // Görünür elmas var mı?
                const visible = bot.findBlocks({
                    matching: b => b.name === 'diamond_ore' || b.name === 'deepslate_diamond_ore',
                    maxDistance: 12,
                    count: 5
                });

                if (visible.length > 0) {
                    const pos = bot.entity.position;
                    visible.sort((a, b) => pos.distanceTo(a) - pos.distanceTo(b));
                    await mineOreVein(visible[0]);
                } else {
                    await stripMineStep();
                }

                // Her adımdan sonra yakın item topla
                await collectNearbyItems();

            } catch (err) {
                console.log('[loop hata]', err.message?.slice(0, 80));
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   DAMAR KAZMA
    // ─────────────────────────────────────────
    async function mineOreVein(startPos) {
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

            // Yaklaş
            const reached = await moveTo(pos.x, pos.y, pos.z, 2, 6000);
            if (!reached) {
                // Uzaktan dene
                await moveTo(pos.x, pos.y, pos.z, 3, 4000);
            }

            const ok = await digBlock(block);
            if (ok) {
                console.log(`[✓] Elmas! Toplam: ${getDiamondCount()}`);
                await sleep(300); // item toplamak için
                await collectNearbyItems();

                // Komşuları kontrol
                const offsets = [
                    [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]
                ];
                for (const [dx,dy,dz] of offsets) {
                    const nb = bot.blockAt(pos.offset(dx,dy,dz));
                    if (nb && (nb.name === 'diamond_ore' || nb.name === 'deepslate_diamond_ore')) {
                        toMine.push(nb.position);
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────
    //   STRİP MİNİNG
    // ─────────────────────────────────────────
    async function stripMineStep() {
        const pos = bot.entity.position;

        // Y=-58'e in
        if (Math.abs(pos.y - TARGET_Y) > 2) {
            console.log(`[strip] Y=${Math.floor(pos.y)} → -58`);
            // Aşağı dog bloğu kaz
            for (let dy = -1; dy >= TARGET_Y - Math.floor(pos.y); dy--) {
                const b = bot.blockAt(pos.offset(0, dy, 0));
                if (b && b.diggable && b.name !== 'air') await digBlock(b);
            }
            try {
                await bot.pathfinder.goto(new goals.GoalY(TARGET_Y), { timeout: 20000 });
            } catch {}
            return;
        }

        const cx = Math.floor(pos.x);
        const cy = TARGET_Y;
        const cz = Math.floor(pos.z);
        const nx = cx + stripDir;

        // İki blok yüksek tünel kaz
        const foot = bot.blockAt({ x: nx, y: cy,   z: cz });
        const head = bot.blockAt({ x: nx, y: cy+1, z: cz });

        if (foot && foot.diggable && foot.name !== 'air') await digBlock(foot);
        if (head && head.diggable && head.name !== 'air') await digBlock(head);

        // İleri git (kısa timeout, takılınca geç)
        try {
            await bot.pathfinder.goto(
                new goals.GoalBlock(nx, cy, cz),
                { timeout: 3000 }
            );
        } catch {
            // Takıldı — zıpla ve devam et
            bot.setControlState('jump', true);
            await sleep(400);
            bot.setControlState('jump', false);
            bot.setControlState('forward', true);
            await sleep(400);
            bot.setControlState('forward', false);
        }

        // Yan duvarları tara (3 kat: -1, 0, +1, +2)
        for (const side of [-1, 1]) {
            for (let dy = -1; dy <= 2; dy++) {
                const sb = bot.blockAt({ x: nx, y: cy+dy, z: cz+side });
                if (sb && (sb.name === 'diamond_ore' || sb.name === 'deepslate_diamond_ore')) {
                    console.log('[scan] Yan elmas!');
                    await mineOreVein(sb.position);
                }
            }
        }

        stripStep++;
        if (stripStep >= STRIP_LENGTH) {
            stripStep = 0;
            stripDir *= -1;
            console.log('[strip] Yön değişti');
        }
    }

    // ─────────────────────────────────────────
    //   ELMAS ATMA — oyuncunun tam dibine git
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

            // Oyuncunun TAM yanına git (1 blok mesafe)
            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(
                        nearest.entity.position.x,
                        nearest.entity.position.y,
                        nearest.entity.position.z,
                        1
                    ),
                    { timeout: 20000 }
                );
            } catch { console.log('[elmas] Gidilemedi, yerinde at'); }

            // Oyuncuya yüz çevir
            try {
                await bot.lookAt(nearest.entity.position.offset(0, 1, 0), true);
                await sleep(300);
            } catch {}

            // Elmasları at
            for (const item of bot.inventory.items().filter(i => i.name === 'diamond')) {
                try {
                    await bot.toss(item.type, null, item.count);
                    console.log(`[elmas] ${item.count} atıldı → ${nearest.username}`);
                    await sleep(200);
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