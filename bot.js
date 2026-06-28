const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');

// ─────────────────────────────────────────
//   GLOBAL GÜVENLİK AĞI
//   Yakalanmamış herhangi bir hata process'i çökertmesin.
// ─────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
    console.error('[!] Yakalanmamış Promise Hatası:', reason?.message ?? reason);
});
process.on('uncaughtException', (err) => {
    console.error('[!] Yakalanmamış İstisna:', err.message);
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif 🚀');
}).listen(PORT, () => console.log(`[✓] Hosting port açık: ${PORT}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────
//   AYARLAR
// ─────────────────────────────────────────
const MAX_SAFE_DROP = 3;
const ATTACKER_TTL = 6000;
const ATTACKER_DETECT_RADIUS = 6;
const HAZARD_REGEX = /lava|fire|magma_block|soul_campfire|campfire/i;
const PROJECTILE_REGEX = /fireball/i;

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

    let currentTarget = null;
    let isAttacking = false;
    let isRetreating = false;
    let lastAttackTime = 0;
    let followingPlayer = null;
    let dangerAhead = false;

    const HEALTH_RETREAT = 8;
    const recentAttackers = new Map();
    let isMeleeEngaged = false;

    async function performLoginSequence() {
        if (systemsStarted) return;
        console.log('[→] Login başlatılıyor...');
        try {
            await sleep(30000);
            bot.chat(`/login ${process.env.SIFRE}`);
            await sleep(30000);
            bot.chat('/skyblock');
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

        movements.canDig = false;
        movements.canJump = true;
        movements.allowSprinting = true;
        movements.allowParkour = true;
        movements.allow1by1 = true;
        movements.maxDropDown = MAX_SAFE_DROP;
        movements.scafoldingBlocks = [];
        movements.exclusionAreasStep.push(block => (HAZARD_REGEX.test(block.name) ? 100 : 0));

        bot.pathfinder.setMovements(movements);
        console.log('[✓] Savaş sistemi başlatıldı.');

        equipSword();
        equipShieldIfAvailable();
        equipArmorIfAvailable();

        combatLoop();
        followNearestPlayerLoop();
        safetyLoop();
        fallGuardLoop();
        eatLoop();
        projectileDefenseLoop();
    }

    // ─────────────────────────────────────────
    //   YARDIMCILAR
    // ─────────────────────────────────────────
    function equipSword() {
        try {
            const swords = bot.inventory.items()
                .filter(i => i.name.includes('sword'))
                .sort((a, b) => swordPriority(b.name) - swordPriority(a.name));
            if (swords.length > 0) {
                bot.equip(swords[0], 'hand').catch(() => {});
                console.log('[⚔] Kılıç: ' + swords[0].name);
            }
        } catch {}
    }

    function equipShieldIfAvailable() {
        try {
            const shield = bot.inventory.items().find(i => i.name === 'shield');
            if (shield) bot.equip(shield, 'off-hand').catch(() => {});
        } catch {}
    }

    const ARMOR_SLOTS = {
        helmet: 'head',
        chestplate: 'torso',
        leggings: 'legs',
        boots: 'feet'
    };

    function equipArmorIfAvailable() {
        try {
            for (const [piece, slot] of Object.entries(ARMOR_SLOTS)) {
                const candidates = bot.inventory.items()
                    .filter(i => i.name.endsWith(piece))
                    .sort((a, b) => swordPriority(b.name) - swordPriority(a.name));
                if (candidates.length === 0) continue;

                const equipped = bot.inventory.slots[bot.getEquipmentDestSlot(slot)];
                const best = candidates[0];
                if (equipped && equipped.name.endsWith(piece) && swordPriority(equipped.name) >= swordPriority(best.name)) {
                    continue;
                }
                bot.equip(best, slot).catch(() => {});
            }
        } catch {}
    }

    function swordPriority(name) {
        if (name.includes('netherite')) return 5;
        if (name.includes('diamond'))   return 4;
        if (name.includes('iron'))      return 3;
        if (name.includes('stone'))     return 2;
        if (name.includes('gold'))      return 1;
        return 0;
    }

    function isHostile(entity) {
        return entity?.kind === 'Hostile mobs';
    }

    function entityHealth(entity) {
        return entity.metadata?.[9] ?? 20;
    }

    function botHealth() {
        return bot.health ?? 20;
    }

    function isHazardBlock(block) {
        if (!block) return false;
        return HAZARD_REGEX.test(block.name);
    }

    function hasHazardAt(pos) {
        try {
            const feet   = bot.blockAt(pos);
            const head   = bot.blockAt(pos.offset(0, 1, 0));
            const ground = bot.blockAt(pos.offset(0, -1, 0));
            return isHazardBlock(feet) || isHazardBlock(head) || isHazardBlock(ground);
        } catch {
            return false;
        }
    }

    function getDropDepthAt(pos, maxCheck = 6) {
        try {
            for (let dy = 1; dy <= maxCheck; dy++) {
                const b = bot.blockAt(pos.offset(0, -dy, 0));
                if (b && b.name !== 'air' && b.name !== 'void_air' && b.name !== 'cave_air') {
                    return dy - 1;
                }
            }
            return maxCheck;
        } catch {
            return maxCheck;
        }
    }

    function getAheadPosition(distance = 1) {
        try {
            const yaw = bot.entity.yaw;
            const dx = -Math.sin(yaw) * distance;
            const dz = -Math.cos(yaw) * distance;
            return bot.entity.position.offset(dx, 0, dz);
        } catch {
            return bot.entity.position;
        }
    }

    function getHostileNear(position, maxDist) {
        try {
            let nearest = null;
            let minDist = maxDist;
            for (const entity of Object.values(bot.entities)) {
                if (!isHostile(entity) || !entity.position) continue;
                const dist = position.distanceTo(entity.position);
                if (dist < minDist) { minDist = dist; nearest = entity; }
            }
            return nearest;
        } catch {
            return null;
        }
    }

    function getNearestPlayer(maxDist = 64) {
        try {
            let nearest = null;
            let minDist = maxDist;
            for (const player of Object.values(bot.players)) {
                if (!player.entity || player.username === bot.username) continue;
                const dist = bot.entity.position.distanceTo(player.entity.position);
                if (dist < minDist) { minDist = dist; nearest = player; }
            }
            return nearest;
        } catch {
            return null;
        }
    }

    bot.on('entityHurt', (entity) => {
        try {
            if (!entity) return;
            const isBot = entity === bot.entity;
            const isFollowedPlayer = followingPlayer && entity === followingPlayer.entity;
            if (!isBot && !isFollowedPlayer) return;

            const attacker = getHostileNear(entity.position, ATTACKER_DETECT_RADIUS);
            if (attacker) {
                recentAttackers.set(attacker.id, { time: Date.now(), entity: attacker });
                const who = isBot ? 'bota' : 'takip edilen oyuncuya';
                console.log(`[👁] ${attacker.name} ${who} vurdu → hedefe alındı.`);
            }
        } catch (err) {
            console.error('[!] entityHurt hatası:', err.message);
        }
    });

    // ─────────────────────────────────────────
    //   SAVAŞ DÖNGÜSÜ
    // ─────────────────────────────────────────
    const STRIKE_RANGE = 3.5;

    async function combatLoop() {
        while (true) {
            try {
                await sleep(80);

                if (botHealth() < HEALTH_RETREAT) {
                    if (!isRetreating) {
                        console.log('[⚠] Can kritik! Çekiliyorum...');
                        isRetreating = true;
                        isAttacking = false;
                        currentTarget = null;
                        try { bot.pathfinder.setGoal(null); } catch {}
                        await retreat();
                        isRetreating = false;
                    }
                    continue;
                }

                const held = bot.heldItem;
                if (!held || !held.name.includes('sword')) equipSword();

                const now = Date.now();
                let target = null;
                let minDist = Infinity;
                for (const [id, data] of recentAttackers) {
                    if (now - data.time > ATTACKER_TTL) { recentAttackers.delete(id); continue; }
                    const entity = bot.entities[id];
                    if (!entity || entity.isValid === false || !isHostile(entity) || !entity.position) {
                        recentAttackers.delete(id);
                        continue;
                    }
                    const dist = bot.entity.position.distanceTo(entity.position);
                    if (dist < minDist) { minDist = dist; target = entity; }
                }

                if (target) {
                    currentTarget = target;
                    isAttacking = true;
                    await fightEntity(target);
                } else {
                    isAttacking = false;
                    isMeleeEngaged = false;
                    currentTarget = null;
                }
            } catch (err) {
                console.error('[!] combatLoop hatası:', err.message);
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   ENTİTY İLE SAVAŞ
    // ─────────────────────────────────────────
    async function fightEntity(entity) {
        try {
            if (!entity || !entity.isValid) return;

            const dist = bot.entity.position.distanceTo(entity.position);

            if (dist > STRIKE_RANGE) {
                isMeleeEngaged = false;
                if (dangerAhead) { await sleep(200); return; }
                try { bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true); } catch {}
                await sleep(250);
                return;
            }

            isMeleeEngaged = true;
            try { bot.pathfinder.setGoal(null); } catch {}
            try { await bot.lookAt(entity.position.offset(0, entity.height * 0.9, 0), true); } catch {}

            const now = Date.now();
            const cooldown = 580;
            if (now - lastAttackTime < cooldown) {
                await sleep(cooldown - (now - lastAttackTime));
            }

            if (!entity.isValid) return;

            try {
                await bot.attack(entity);
                lastAttackTime = Date.now();
                console.log(`[⚔] Vuruldu: ${entity.name} | HP: ${Math.round(entityHealth(entity))}`);
            } catch {}

            if (!entity.isValid || entityHealth(entity) <= 0) {
                console.log(`[✓] ${entity.name} öldürüldü!`);
                recentAttackers.delete(entity.id);
                currentTarget = null;
                isMeleeEngaged = false;
                try { bot.pathfinder.setGoal(null); } catch {}
            }
        } catch (err) {
            console.error('[!] fightEntity hatası:', err.message);
        }
    }

    // ─────────────────────────────────────────
    //   GERİ ÇEKİLME
    // ─────────────────────────────────────────
    async function retreat() {
        try {
            try { bot.pathfinder.setGoal(null); } catch {}

            const pos = bot.entity.position;
            const target = currentTarget;
            let dx = 0, dz = 0;

            if (target?.position) {
                dx = pos.x - target.position.x;
                dz = pos.z - target.position.z;
                const len = Math.sqrt(dx * dx + dz * dz) || 1;
                dx = (dx / len) * 8;
                dz = (dz / len) * 8;
            } else {
                dx = (Math.random() - 0.5) * 10;
                dz = (Math.random() - 0.5) * 10;
            }

            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(pos.x + dx, pos.y, pos.z + dz, 2),
                    { timeout: 4000 }
                );
            } catch {}

            await sleep(1500);
        } catch (err) {
            console.error('[!] retreat hatası:', err.message);
        }
    }

    // ─────────────────────────────────────────
    //   EN YAKIN OYUNCUYU TAKİP ET
    // ─────────────────────────────────────────
    async function followNearestPlayerLoop() {
        while (true) {
            try {
                await sleep(500);

                if (isAttacking || isRetreating || dangerAhead) continue;

                const player = getNearestPlayer(48);
                if (!player || !player.entity) { followingPlayer = null; continue; }

                followingPlayer = player;
                const dist = bot.entity.position.distanceTo(player.entity.position);
                if (dist < 4) continue;

                try {
                    bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 3), true);
                } catch {}
            } catch (err) {
                console.error('[!] followLoop hatası:', err.message);
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   GÜVENLİK DÖNGÜSÜ
    // ─────────────────────────────────────────
    async function safetyLoop() {
        while (true) {
            try {
                await sleep(200);

                const pos = bot.entity.position;

                if (pos.y < -60) {
                    console.log('[⚠] VOID! Acil çıkış...');
                    try { bot.pathfinder.setGoal(null); } catch {}
                    bot.setControlState('jump', true);
                    await sleep(500);
                    bot.setControlState('jump', false);
                    continue;
                }

                const standingIn = bot.blockAt(pos.offset(0, 0, 0));
                const headIn     = bot.blockAt(pos.offset(0, 1, 0));
                if (isHazardBlock(standingIn) || isHazardBlock(headIn)) {
                    console.log('[⚠] TEHLİKE (lav/ateş)! Kaçıyorum...');
                    dangerAhead = true;
                    isRetreating = true;
                    try { bot.pathfinder.setGoal(null); } catch {}
                    bot.clearControlStates();
                    await retreat();
                    isRetreating = false;
                    dangerAhead = false;
                    continue;
                }

                let solidBelow = false;
                for (let dy = -1; dy >= -3; dy--) {
                    const b = bot.blockAt(pos.offset(0, dy, 0));
                    if (b && b.name !== 'air' && b.name !== 'void_air') { solidBelow = true; break; }
                }

                if (!solidBelow && !bot.entity.onGround) {
                    console.log('[⚠] Boşlukta! Dural...');
                    try { bot.pathfinder.setGoal(null); } catch {}
                    bot.setControlState('sneak', true);
                    await sleep(600);
                    bot.setControlState('sneak', false);
                }
            } catch (err) {
                console.error('[!] safetyLoop hatası:', err.message);
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   DÜŞME KORUMA DÖNGÜSÜ
    // ─────────────────────────────────────────
    async function fallGuardLoop() {
        while (true) {
            try {
                await sleep(100);

                if (isMeleeEngaged) continue;
                if (!bot.entity.onGround) continue;

                const vel = bot.entity.velocity;
                const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                const lookDistances = horizSpeed > 0.15 ? [1, 2, 3] : [1, 2];

                let danger = false;

                if (hasHazardAt(bot.entity.position)) danger = true;

                if (!danger) {
                    for (const d of lookDistances) {
                        const ahead = getAheadPosition(d);
                        const dropDepth = getDropDepthAt(ahead);
                        if (dropDepth > MAX_SAFE_DROP || hasHazardAt(ahead)) { danger = true; break; }
                    }
                }

                if (danger) {
                    dangerAhead = true;
                    try { bot.pathfinder.setGoal(null); } catch {}
                    bot.clearControlStates();
                    bot.setControlState('sneak', true);
                    await sleep(400);
                    bot.setControlState('sneak', false);
                    await sleep(300);
                    dangerAhead = false;
                }
            } catch (err) {
                console.error('[!] fallGuardLoop hatası:', err.message);
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   YİYECEK DÖNGÜSÜ
    // ─────────────────────────────────────────
    async function eatLoop() {
        while (true) {
            try {
                await sleep(1000);
                if (bot.food > 16) continue;
                if (isAttacking || isRetreating) continue;

                const food = bot.inventory.items().find(i =>
                    i.name.includes('bread') ||
                    i.name.includes('cooked') ||
                    i.name.includes('golden_apple') ||
                    i.name.includes('apple')
                );
                if (!food) continue;

                await bot.equip(food, 'hand').catch(() => {});
                bot.setControlState('sprint', false);
                await bot.consume().catch(() => {});
                equipSword();
            } catch (err) {
                console.error('[!] eatLoop hatası:', err.message);
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   ATEŞ TOPU SAVUNMA DÖNGÜSÜ
    // ─────────────────────────────────────────
    async function projectileDefenseLoop() {
        while (true) {
            try {
                await sleep(100);

                const botPos = bot.entity.position;
                for (const entity of Object.values(bot.entities)) {
                    if (!PROJECTILE_REGEX.test(entity.name ?? '')) continue;
                    if (!entity.position || !entity.velocity) continue;

                    const dist = botPos.distanceTo(entity.position);
                    if (dist > 12) continue;

                    // Fireball bota doğru mu yaklaşıyor?
                    const rel = botPos.minus(entity.position);
                    const dot = rel.x * entity.velocity.x + rel.y * entity.velocity.y + rel.z * entity.velocity.z;
                    if (dot <= 0) continue; // uzaklaşıyor

                    console.log(`[🔥] Ateş topu geliyor (${entity.name}) — kaçıyorum!`);
                    dangerAhead = true;
                    try { bot.pathfinder.setGoal(null); } catch {}

                    const yaw = bot.entity.yaw + Math.PI / 2; // sağa kaç
                    const ex = botPos.x - Math.sin(yaw) * 5;
                    const ez = botPos.z - Math.cos(yaw) * 5;

                    try {
                        await bot.pathfinder.goto(
                            new goals.GoalNear(ex, botPos.y, ez, 1),
                            { timeout: 2000 }
                        );
                    } catch {}

                    dangerAhead = false;
                    break;
                }
            } catch (err) {
                console.error('[!] projectileDefenseLoop hatası:', err.message);
                await sleep(500);
            }
        }
    }

    // ─────────────────────────────────────────
    //   BAĞLANTI OLAYLARI
    // ─────────────────────────────────────────
    bot.on('kicked', (reason) => {
        console.log('[!] Sunucudan atıldı:', reason);
        setTimeout(createBot, 5000);
    });

    bot.on('error', (err) => {
        console.error('[!] Bot bağlantı hatası:', err.message);
    });

    bot.on('end', (reason) => {
        console.log('[!] Bağlantı kapandı:', reason, '— 5 sn sonra yeniden bağlanılıyor...');
        setTimeout(createBot, 5000);
    });
}

createBot();