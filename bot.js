const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif 🚀');
}).listen(PORT, () => console.log(`[✓] Hosting port açık: ${PORT}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Düşman mob listesi
const HOSTILE_MOBS = new Set([
    'zombie','skeleton','creeper','spider','cave_spider','witch',
    'blaze','ghast','enderman','endermite','silverfish','wither_skeleton',
    'husk','stray','drowned','phantom','pillager','vindicator',
    'evoker','vex','ravager','guardian','elder_guardian','shulker',
    'hoglin','zoglin','piglin_brute','warden','breeze'
]);

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

    // Savaş state
    let currentTarget = null;
    let isAttacking = false;
    let isRetreating = false;
    let lastAttackTime = 0;
    let followingPlayer = null;

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

        // Parkur & boşluk algılama için ayarlar
        movements.canDig = false;        // savaşta kazma yok
        movements.canJump = true;
        movements.allowSprinting = true;
        movements.allowParkour = true;   // parkur açık
        movements.allow1by1 = true;
        movements.maxDropDown = 3;       // boşluğa düşme engeli (3 bloktan fazla atlamaz)
        movements.scafoldingBlocks = []; // scaffold yok

        bot.pathfinder.setMovements(movements);
        console.log('[✓] Savaş sistemi başlatıldı.');

        // Kılıcı koy eline
        equipSword();

        // Ana döngüler
        combatLoop();
        followNearestPlayerLoop();
        safetyLoop();
        eatLoop();
    }

    // ─────────────────────────────────────────
    //   YARDIMCILAR
    // ─────────────────────────────────────────
    function equipSword() {
        const swords = bot.inventory.items()
            .filter(i => i.name.includes('sword'))
            .sort((a, b) => swordPriority(b.name) - swordPriority(a.name));
        if (swords.length > 0) {
            bot.equip(swords[0], 'hand').catch(() => {});
            console.log('[⚔] Kılıç: ' + swords[0].name);
        }
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
        return HOSTILE_MOBS.has(entity.name?.toLowerCase());
    }

    function entityHealth(entity) {
        return entity.metadata?.[9] ?? 20;
    }

    function botHealth() {
        return bot.health ?? 20;
    }

    // Boşluk kontrolü: hedefin yolu güvenli mi?
    function isSafeGround(pos) {
        const below = bot.blockAt(pos.offset(0, -1, 0));
        if (!below || below.name === 'air' || below.name === 'void_air') return false;
        return true;
    }

    // En yakın düşman mob
    function getNearestHostile(maxDist = 20) {
        let nearest = null;
        let minDist = maxDist;

        for (const entity of Object.values(bot.entities)) {
            if (!isHostile(entity)) continue;
            if (!entity.position) continue;
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = entity;
            }
        }
        return nearest;
    }

    // En yakın oyuncu (kendisi hariç)
    function getNearestPlayer(maxDist = 64) {
        let nearest = null;
        let minDist = maxDist;

        for (const player of Object.values(bot.players)) {
            if (!player.entity || player.username === bot.username) continue;
            const dist = bot.entity.position.distanceTo(player.entity.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = player;
            }
        }
        return nearest;
    }

    // ─────────────────────────────────────────
    //   SAVAŞ DÖNGÜSÜ
    // ─────────────────────────────────────────
    async function combatLoop() {
        while (true) {
            await sleep(100);

            // Can düşükse çekil
            if (botHealth() < 6) {
                if (!isRetreating) {
                    console.log('[⚠] Can kritik! Çekiliyorum...');
                    isRetreating = true;
                    isAttacking = false;
                    currentTarget = null;
                    try { bot.pathfinder.setGoal(null); } catch {}
                    await retreat();
                }
                continue;
            }

            if (botHealth() > 14) isRetreating = false;
            if (isRetreating) continue;

            // Kılıç elde mi?
            const held = bot.heldItem;
            if (!held || !held.name.includes('sword')) {
                equipSword();
            }

            // Hedef belirle: önce düşman mob, yoksa oyuncuya zarar veren mob
            const hostile = getNearestHostile(18);

            if (hostile) {
                currentTarget = hostile;
                isAttacking = true;
                await fightEntity(hostile);
            } else {
                isAttacking = false;
                currentTarget = null;
            }
        }
    }

    // ─────────────────────────────────────────
    //   ENTİTY İLE SAVAŞ
    // ─────────────────────────────────────────
    async function fightEntity(entity) {
        if (!entity || !entity.isValid) return;

        const pos = entity.position;
        const myPos = bot.entity.position;
        const dist = myPos.distanceTo(pos);

        // Güvenli zemin kontrolü
        if (!isSafeGround(myPos)) {
            console.log('[⚠] Tehlikeli zemin! Geri çekiliyorum.');
            await retreat();
            return;
        }

        // 8 bloktan uzaksa yaklaş
        if (dist > 3.5) {
            try {
                bot.pathfinder.setGoal(
                    new goals.GoalFollow(entity, 2),
                    true // dinamik — sürekli güncelle
                );
            } catch {}
            await sleep(300);
            return;
        }

        // Yakın mesafede: yüz çevir + vur
        try {
            await bot.lookAt(pos.offset(0, entity.height * 0.9, 0), true);
        } catch {}

        // Sweep attack cooldown: 1.21'de tam cooldown ~600ms
        const now = Date.now();
        const cooldown = 580;
        if (now - lastAttackTime < cooldown) {
            await sleep(cooldown - (now - lastAttackTime));
        }

        if (!entity.isValid) return;

        try {
            await bot.attack(entity);
            lastAttackTime = Date.now();
            console.log(`[⚔] Vuruldu: ${entity.name} | HP: ${Math.round(entityHealth(entity))} | Dist: ${dist.toFixed(1)}`);
        } catch {}

        // W-tap (sprint reset): vur → dur → sprint → yaklaş
        bot.setControlState('sprint', false);
        await sleep(60);
        bot.setControlState('sprint', true);

        // Öldü mü?
        if (!entity.isValid || entityHealth(entity) <= 0) {
            console.log(`[✓] ${entity.name} öldürüldü!`);
            currentTarget = null;
            try { bot.pathfinder.setGoal(null); } catch {}
        }
    }

    // ─────────────────────────────────────────
    //   GERİ ÇEKİLME
    // ─────────────────────────────────────────
    async function retreat() {
        try { bot.pathfinder.setGoal(null); } catch {}

        const pos = bot.entity.position;
        // Düşmandan ters yöne koş
        const target = currentTarget;
        let dx = 0, dz = 0;

        if (target?.position) {
            dx = pos.x - target.position.x;
            dz = pos.z - target.position.z;
            const len = Math.sqrt(dx*dx + dz*dz) || 1;
            dx = (dx/len) * 8;
            dz = (dz/len) * 8;
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
    }

    // ─────────────────────────────────────────
    //   EN YAKIN OYUNCUYU TAKİP ET
    //   (savaş yoksa)
    // ─────────────────────────────────────────
    async function followNearestPlayerLoop() {
        while (true) {
            await sleep(500);

            if (isAttacking || isRetreating) continue;

            const player = getNearestPlayer(48);
            if (!player || !player.entity) {
                followingPlayer = null;
                continue;
            }

            followingPlayer = player;
            const dist = bot.entity.position.distanceTo(player.entity.position);

            // 4 bloktan yakınsa dur (üstüne basma)
            if (dist < 4) continue;

            try {
                bot.pathfinder.setGoal(
                    new goals.GoalFollow(player.entity, 3),
                    true
                );
            } catch {}
        }
    }

    // ─────────────────────────────────────────
    //   GÜVENLİK DÖNGÜSÜ
    //   Boşluğa düşme, lav, void algılama
    // ─────────────────────────────────────────
    async function safetyLoop() {
        while (true) {
            await sleep(200);

            const pos = bot.entity.position;

            // Void kontrolü (Y < -60)
            if (pos.y < -60) {
                console.log('[⚠] VOID! Acil çıkış...');
                try { bot.pathfinder.setGoal(null); } catch {}
                bot.setControlState('jump', true);
                await sleep(500);
                bot.setControlState('jump', false);
                continue;
            }

            // Lav kontrolü
            const standingIn = bot.blockAt(pos.offset(0, 0, 0));
            const headIn = bot.blockAt(pos.offset(0, 1, 0));
            if (standingIn?.name?.includes('lava') || headIn?.name?.includes('lava')) {
                console.log('[⚠] LAV! Kaçıyorum...');
                isRetreating = true;
                await retreat();
                continue;
            }

            // Ayağının altında boşluk var mı (3 blok)
            let solidBelow = false;
            for (let dy = -1; dy >= -3; dy--) {
                const b = bot.blockAt(pos.offset(0, dy, 0));
                if (b && b.name !== 'air' && b.name !== 'void_air') {
                    solidBelow = true;
                    break;
                }
            }

            if (!solidBelow && !bot.entity.onGround) {
                console.log('[⚠] Boşlukta! Dural...');
                try { bot.pathfinder.setGoal(null); } catch {}
                bot.setControlState('sneak', true);
                await sleep(600);
                bot.setControlState('sneak', false);
            }
        }
    }

    // ─────────────────────────────────────────
    //   YEMEK YEME
    // ─────────────────────────────────────────
    const FOOD_PRIORITY = [
        'golden_apple','enchanted_golden_apple',
        'cooked_beef','cooked_porkchop','cooked_mutton',
        'cooked_chicken','cooked_salmon','cooked_cod',
        'bread','baked_potato','mushroom_stew','rabbit_stew',
        'pumpkin_pie','cookie','melon_slice','apple',
        'carrot','potato','beetroot'
    ];

    function getBestFood() {
        const items = bot.inventory.items();
        for (const name of FOOD_PRIORITY) {
            const f = items.find(i => i.name === name);
            if (f) return f;
        }
        return items.find(i => i.food);
    }

    async function eatLoop() {
        while (true) {
            await sleep(500);
            if (bot.food > 16) continue;

            const food = getBestFood();
            if (!food) continue;

            console.log(`[🍖] Açım (${bot.food}/20) → ${food.name}`);
            try {
                await bot.equip(food, 'hand');
                await bot.consume();
                console.log(`[🍖] Yendi! Açlık: ${bot.food}/20`);
                await sleep(200);
                equipSword();
            } catch (e) {
                console.log('[yemek hata]', e.message);
                equipSword();
            }
        }
    }

    // Envanter değişince kılıç kontrol
    bot.on('playerCollect', () => equipSword());

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