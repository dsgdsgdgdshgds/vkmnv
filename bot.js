const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot aktif 🚀');
}).listen(PORT, () => console.log(`[✓] Hosting port açık: ${PORT}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────
//   AYARLAR (liste yok — dinamik tespit)
// ─────────────────────────────────────────
const ATTACKER_TTL = 6000;          // bir mob "oyuncuya vurdu" olarak kaç ms hatırlanır
const ATTACKER_DETECT_RADIUS = 6;   // vurulan oyuncunun etrafında mob aranacak yarıçap
const MAX_SAFE_DROP = 3;            // bu kadar bloktan fazla boşluk varsa ilerlemez

// Lav, ateş, magma, kampfire vb. — isim bazlı genel tehlike tespiti.
// Yeni bir tehlikeli blok eklenmek istenirse buraya pattern eklemek yeterli.
const HAZARD_REGEX = /lava|fire|magma_block|soul_campfire|campfire/i;

// Ghast ve blaze'in attığı ateş topları — bunlar entity olarak uçar, mob değil.
const PROJECTILE_REGEX = /fireball/i;

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

    // Savaş state
    let currentTarget = null;
    let isAttacking = false;
    let isRetreating = false;
    let lastAttackTime = 0;
    let followingPlayer = null;

    // Tehlike (boşluk/lav/ateş) tespit edildiğinde true olur.
    // Diğer döngüler bu süre içinde yeni pathfinder hedefi vermekten kaçınır,
    // böylece "dur → hemen tekrar tehlikeye doğru hedef al" çakışması engellenir.
    let dangerAhead = false;

    // Can eşikleri (sarılma/çoklu mob durumlarında daha güvenli olmak için biraz yükseltildi)
    const HEALTH_RETREAT = 8;   // bu canın altına düşünce acil çekil
    const HEALTH_RESUME = 16;   // bu cana ulaşınca tekrar dövüşe dön

    // entityId -> { time, entity } : son zamanlarda bir oyuncuya/bota vurduğu tespit edilen moblar
    const recentAttackers = new Map();

    // entityId -> { lastPos, lastTime, lastSeen, aggressive } :
    // bir mobun türüne bakmadan, hareketinden "gerçekten saldırgan mı" anlamak için takip
    const mobMovementTrack = new Map();

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
        movements.maxDropDown = MAX_SAFE_DROP; // boşluğa düşme engeli
        movements.scafoldingBlocks = []; // scaffold yok

        // Pathfinder'ın kendisi de lav/ateş gibi blokların üstünden/yanından
        // geçen yolları yüksek maliyetli görüp mümkünse kaçınsın.
        movements.exclusionAreasStep.push(block => (HAZARD_REGEX.test(block.name) ? 100 : 0));

        bot.pathfinder.setMovements(movements);
        console.log('[✓] Savaş sistemi başlatıldı.');

        // Kılıcı koy eline, kalkan ve zırhı tak
        equipSword();
        equipShieldIfAvailable();
        equipArmorIfAvailable();

        // Ana döngüler
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
        const swords = bot.inventory.items()
            .filter(i => i.name.includes('sword'))
            .sort((a, b) => swordPriority(b.name) - swordPriority(a.name));
        if (swords.length > 0) {
            bot.equip(swords[0], 'hand').catch(() => {});
            console.log('[⚔] Kılıç: ' + swords[0].name);
        }
    }

    function equipShieldIfAvailable() {
        const shield = bot.inventory.items().find(i => i.name === 'shield');
        if (shield) {
            bot.equip(shield, 'off-hand').catch(() => {});
        }
    }

    // Zırh giyme — materyal önceliğine göre (netherite > diamond > iron > ...).
    // Liste yok: item adının sonundaki "_helmet/_chestplate/_leggings/_boots"
    // ekine göre slotu otomatik tespit eder.
    const ARMOR_SLOTS = {
        helmet: 'head',
        chestplate: 'torso',
        leggings: 'legs',
        boots: 'feet'
    };

    function equipArmorIfAvailable() {
        for (const [piece, slot] of Object.entries(ARMOR_SLOTS)) {
            const candidates = bot.inventory.items()
                .filter(i => i.name.endsWith(piece))
                .sort((a, b) => swordPriority(b.name) - swordPriority(a.name));
            if (candidates.length === 0) continue;

            const equipped = bot.inventory.slots[bot.getEquipmentDestSlot(slot)];
            const best = candidates[0];
            // Üstündeki zaten aynı veya daha iyi materyaldeyse tekrar giymeye çalışma
            if (equipped && equipped.name.endsWith(piece) && swordPriority(equipped.name) >= swordPriority(best.name)) {
                continue;
            }
            bot.equip(best, slot).catch(() => {});
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

    // Düşman tespiti artık sabit bir isim listesine değil,
    // oyunun kendi verisine (mcData kategorisi) dayanıyor.
    function isHostile(entity) {
        return entity?.kind === 'Hostile mobs';
    }

    // Bir mobun şu an bota/oyuncuya yaklaşıp yaklaşmadığını (yani gerçekten
    // saldırgan davranıp davranmadığını) tür adına bakmadan, hareketinden anlar.
    // Piglin gibi normalde nötr olan moblar sakin durdukça/uzaklaştıkça hedefe alınmaz;
    // yaklaşmaya başlarsa veya zaten yakına gelmişse otomatik tehdit sayılır.
    function getNearestThreatTarget(fromPos) {
        let nearest = null, minDist = Infinity;
        const candidates = [bot.entity, ...Object.values(bot.players).map(p => p.entity).filter(Boolean)];
        for (const c of candidates) {
            if (!c?.position) continue;
            const d = fromPos.distanceTo(c.position);
            if (d < minDist) { minDist = d; nearest = c; }
        }
        return nearest;
    }

    function updateAggressionTracking() {
        const now = Date.now();
        for (const entity of Object.values(bot.entities)) {
            if (!isHostile(entity) || !entity.position) continue;
            let track = mobMovementTrack.get(entity.id);
            if (!track) {
                track = { lastPos: entity.position.clone(), lastTime: now, lastSeen: now, aggressive: false };
                mobMovementTrack.set(entity.id, track);
                continue;
            }
            track.lastSeen = now;
            if (now - track.lastTime > 400) {
                const ref = getNearestThreatTarget(entity.position);
                if (ref?.position) {
                    const distBefore = track.lastPos.distanceTo(ref.position);
                    const distNow = entity.position.distanceTo(ref.position);
                    if (distNow < distBefore - 0.05 && distNow < 12) {
                        track.aggressive = true; // bize doğru yaklaşıyor → gerçek tehdit
                    } else if (distNow > distBefore + 0.3) {
                        track.aggressive = false; // uzaklaşıyor → tehdit değil
                    }
                }
                track.lastPos = entity.position.clone();
                track.lastTime = now;
            }
        }
        // Artık görünmeyen mobların kaydını temizle
        for (const [id, data] of mobMovementTrack) {
            if (now - data.lastSeen > 5000) mobMovementTrack.delete(id);
        }
    }

    function isActivelyAggressive(entity) {
        return !!mobMovementTrack.get(entity.id)?.aggressive;
    }

    // Yakındaki "gerçek" tehdit sayısı (saldırgan olarak hareket eden ya da
    // zaten temas mesafesinde olan moblar) — sarılma durumunu tespit etmek için.
    function countActiveThreatsNear(radius) {
        let count = 0;
        for (const entity of Object.values(bot.entities)) {
            if (!isHostile(entity) || !entity.position) continue;
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist <= radius && (isActivelyAggressive(entity) || dist <= 3.5)) count++;
        }
        return count;
    }

    function entityHealth(entity) {
        return entity.metadata?.[9] ?? 20;
    }

    function botHealth() {
        return bot.health ?? 20;
    }

    // Bir blok lav/ateş/magma vb. tehlikeli mi? (genel, isim bazlı)
    function isHazardBlock(block) {
        if (!block) return false;
        return HAZARD_REGEX.test(block.name);
    }

    // Belirli bir noktada (ayak, kafa ve zemin seviyesinde) tehlike var mı?
    function hasHazardAt(pos) {
        const feet = bot.blockAt(pos);
        const head = bot.blockAt(pos.offset(0, 1, 0));
        const ground = bot.blockAt(pos.offset(0, -1, 0));
        return isHazardBlock(feet) || isHazardBlock(head) || isHazardBlock(ground);
    }

    // Boşluk kontrolü: hedefin yolu güvenli mi?
    function isSafeGround(pos) {
        const below = bot.blockAt(pos.offset(0, -1, 0));
        if (!below || below.name === 'air' || below.name === 'void_air') return false;
        if (isHazardBlock(below)) return false;
        return true;
    }

    // Belirtilen noktanın altında kaç blok boşluk var, ölçer (düşme derinliği).
    function getDropDepthAt(pos, maxCheck = 6) {
        for (let dy = 1; dy <= maxCheck; dy++) {
            const b = bot.blockAt(pos.offset(0, -dy, 0));
            if (b && b.name !== 'air' && b.name !== 'void_air' && b.name !== 'cave_air') {
                return dy - 1; // bu kadar blok düşer, sonra zemine basar
            }
        }
        return maxCheck; // dipsiz / çok derin sayılır
    }

    // Botun şu an baktığı yönde belirli bir mesafe ilerideki noktayı verir
    function getAheadPosition(distance = 1) {
        const yaw = bot.entity.yaw;
        const dx = -Math.sin(yaw) * distance;
        const dz = -Math.cos(yaw) * distance;
        return bot.entity.position.offset(dx, 0, dz);
    }

    // Belirli bir noktanın etrafındaki en yakın düşman mob
    function getHostileNear(position, maxDist) {
        let nearest = null;
        let minDist = maxDist;

        for (const entity of Object.values(bot.entities)) {
            if (!isHostile(entity) || !entity.position) continue;
            const dist = position.distanceTo(entity.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = entity;
            }
        }
        return nearest;
    }

    // En yakın düşman mob — önce "az önce birine vurmuş" moblara öncelik verir.
    // Bulamazsa, sadece GERÇEKTEN saldırgan davranan (yaklaşan) veya zaten temas
    // mesafesinde olan mobları tehdit sayar (piglin gibi nötr moblara öylece
    // saldırmaz). Birden fazla tehdit varsa en az canlı olanı önce seçer ki
    // hızlıca temizlenip çoklu mob baskısı azalsın.
    function getNearestHostile(maxDist = 20) {
        const now = Date.now();
        let bestAttacker = null;
        let bestAttackerDist = maxDist;

        for (const [id, data] of recentAttackers) {
            if (now - data.time > ATTACKER_TTL) {
                recentAttackers.delete(id);
                continue;
            }
            const entity = bot.entities[id];
            if (!entity || entity.isValid === false || !isHostile(entity) || !entity.position) {
                recentAttackers.delete(id);
                continue;
            }
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist < bestAttackerDist) {
                bestAttackerDist = dist;
                bestAttacker = entity;
            }
        }

        if (bestAttacker) return bestAttacker;

        const activeThreats = [];
        for (const entity of Object.values(bot.entities)) {
            if (!isHostile(entity) || !entity.position) continue;
            const dist = bot.entity.position.distanceTo(entity.position);
            if (dist > maxDist) continue;
            if (isActivelyAggressive(entity) || dist <= 3.5) {
                activeThreats.push(entity);
            }
        }

        if (activeThreats.length === 0) return null;
        if (activeThreats.length > 1) {
            activeThreats.sort((a, b) => entityHealth(a) - entityHealth(b));
        }
        return activeThreats[0];
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

    // Bir oyuncu YA DA bot hasar aldığında: yakınındaki düşman mobu tespit edip
    // "saldırgan" olarak işaretle, böylece bot ona öncelik verip saldırsın.
    // (Önceden bot kendi hasarını atlıyordu, bu yüzden bota vuran mob bazen
    // hemen hedefe alınmıyordu — düzeltildi.)
    bot.on('entityHurt', (entity) => {
        if (!entity || entity.type !== 'player') return;

        let attacker = getHostileNear(entity.position, ATTACKER_DETECT_RADIUS);
        if (!attacker) {
            // Yakında mob yoksa menzilli bir saldırı olabilir (ghast ateş topu,
            // iskelet oku vb.) — daha geniş yarıçapta tekrar ara.
            attacker = getHostileNear(entity.position, 24);
        }

        if (attacker) {
            recentAttackers.set(attacker.id, { time: Date.now(), entity: attacker });
            const who = entity === bot.entity ? 'bota' : 'bir oyuncuya';
            console.log(`[👁] ${attacker.name} ${who} vurmuş olabilir → hedefe alındı.`);
        }
    });

    // ─────────────────────────────────────────
    //   SAVAŞ DÖNGÜSÜ
    // ─────────────────────────────────────────
    async function combatLoop() {
        while (true) {
            await sleep(100);

            updateAggressionTracking();

            // Can düşükse çekil
            if (botHealth() < HEALTH_RETREAT) {
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

            // Sarılma koruması: 3+ gerçek tehdit yakındaysa ve can güvenli aralıkta değilse
            // önce kısa bir çekiliş yap, hepsiyle aynı anda dövüşüp ölmesin.
            const threatCount = countActiveThreatsNear(5);
            if (threatCount >= 3 && botHealth() < HEALTH_RESUME && !isRetreating) {
                console.log(`[⚠] ${threatCount} mob tarafından sarıldım! Kısa çekiliş...`);
                isRetreating = true;
                isAttacking = false;
                currentTarget = null;
                try { bot.pathfinder.setGoal(null); } catch {}
                await retreat();
                continue;
            }

            if (botHealth() > HEALTH_RESUME) isRetreating = false;
            if (isRetreating) continue;

            // Kılıç elde mi?
            const held = bot.heldItem;
            if (!held || !held.name.includes('sword')) {
                equipSword();
            }

            // Hedef belirle: önce birine vuran mob, yoksa gerçekten saldırgan/temas mesafesindeki mob
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

        // 3.5 bloktan uzaksa yaklaş
        if (dist > 3.5) {
            // Tehlike algılandıysa (fallGuard/safety döngüsü çalışıyorsa) yeni hedef vermeyip bekle
            if (dangerAhead) {
                await sleep(200);
                return;
            }
            try {
                bot.pathfinder.setGoal(
                    new goals.GoalFollow(entity, 2),
                    true // dinamik — sürekli güncelle
                );
            } catch {}
            await sleep(300);
            return;
        }

        // Yakın mesafede: kalkanı indir, yüz çevir + vur
        try { bot.deactivateItem(); } catch {}
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

        // Birden fazla tehdit varsa, vuruşlar arasındaki boşlukta kalkanı kaldır (ekstra koruma)
        const threatCount = countActiveThreatsNear(6);
        if (threatCount >= 2) {
            try { bot.activateItem(true); } catch {}

            // KITING: 2+ mob aynı anda üstümüzdeyse, vurduktan sonra hedeften
            // geriye doğru kısa bir adım at. Böylece moblar arkamızdan tek
            // sıra halinde gelir, aynı anda hepsi vuramaz.
            // Önce arkada güvenli mi (uçurum/lav yok mu) diye bak — değilse geri çekilme,
            // sadece kalkanla savun.
            const behind = getAheadPosition(-1.5);
            const behindSafe = getDropDepthAt(behind) <= MAX_SAFE_DROP && !hasHazardAt(behind);

            if (behindSafe) {
                try { bot.pathfinder.setGoal(null); } catch {}
                bot.setControlState('sprint', false);
                bot.setControlState('back', true);
                await sleep(220);
                bot.setControlState('back', false);
            }
        }

        // W-tap (sprint reset): vur → dur → sprint → yaklaş
        bot.setControlState('sprint', false);
        await sleep(60);
        bot.setControlState('sprint', true);

        // Öldü mü?
        if (!entity.isValid || entityHealth(entity) <= 0) {
            console.log(`[✓] ${entity.name} öldürüldü!`);
            recentAttackers.delete(entity.id);
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

            if (isAttacking || isRetreating || dangerAhead) continue;

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

            // Lav / ateş kontrolü (genel tehlike regex'i ile)
            const standingIn = bot.blockAt(pos.offset(0, 0, 0));
            const headIn = bot.blockAt(pos.offset(0, 1, 0));
            if (isHazardBlock(standingIn) || isHazardBlock(headIn)) {
                console.log('[⚠] TEHLİKE (lav/ateş)! Kaçıyorum...');
                dangerAhead = true;
                isRetreating = true;
                try { bot.pathfinder.setGoal(null); } catch {}
                bot.clearControlStates();
                await retreat();
                dangerAhead = false;
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
    //   YÜKSEKTEN DÜŞMEYİ VE TEHLİKELİ BLOKLARI ÖNLEYEN KORUMA
    //   Önünde derin boşluk veya lav/ateş varsa ilerlemez
    // ─────────────────────────────────────────
    async function fallGuardLoop() {
        while (true) {
            await sleep(100);

            // Havadaysa (zaten düşüyor/zıplıyor) bu kontrolü atla, diğer sistemler halleder
            if (!bot.entity.onGround) continue;

            // Sprint hızındaysa daha ileriye bak, normalde yakın mesafeye bak
            const vel = bot.entity.velocity;
            const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
            const lookDistances = horizSpeed > 0.15 ? [1, 2, 3] : [1, 2];

            let danger = false;

            // Şu anki konumda da lav/ateş var mı (örn. savaşırken üstüne bastıysa)
            if (hasHazardAt(bot.entity.position)) {
                danger = true;
            }

            if (!danger) {
                for (const d of lookDistances) {
                    const ahead = getAheadPosition(d);
                    const dropDepth = getDropDepthAt(ahead);
                    if (dropDepth > MAX_SAFE_DROP || hasHazardAt(ahead)) {
                        danger = true;
                        break;
                    }
                }
            }

            if (danger) {
                dangerAhead = true;
                try { bot.pathfinder.setGoal(null); } catch {}
                bot.clearControlStates();
                bot.setControlState('sneak', true);
                await sleep(400);
                bot.setControlState('sneak', false);
                // Diğer döngülerin hemen aynı yöne tekrar hedef vermesini engellemek için kısa bekleme
                await sleep(300);
                dangerAhead = false;
            }
        }
    }

    // ─────────────────────────────────────────
    //   ATEŞ TOPU SAVUNMASI (Ghast / Blaze)
    //   Yakınsa kılıçla vurup geri yansıtır, uzaksa yana kaçar.
    // ─────────────────────────────────────────
    async function projectileDefenseLoop() {
        while (true) {
            await sleep(80);

            let nearest = null;
            let minDist = 16;
            for (const entity of Object.values(bot.entities)) {
                if (!entity?.name || !PROJECTILE_REGEX.test(entity.name) || !entity.position) continue;
                const dist = bot.entity.position.distanceTo(entity.position);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = entity;
                }
            }
            if (!nearest) continue;

            // Bize doğru geliyor mu? (hız vektörü ile bota olan yön örtüşüyor mu)
            const toBot = bot.entity.position.minus(nearest.position);
            const vel = nearest.velocity ?? { x: 0, y: 0, z: 0 };
            const approaching = (vel.x * toBot.x + vel.z * toBot.z) > 0;
            if (!approaching) continue;

            if (minDist <= 4) {
                // Yakınsa kılıçla vur — Minecraft'ta bu ateş topunu kaynağına geri yansıtır
                try {
                    await bot.lookAt(nearest.position, true);
                    await bot.attack(nearest);
                    console.log('[🔥] Ateş topu yansıtıldı!');
                } catch {}
            } else if (minDist <= 12) {
                // Uzaktaysa yansıtmak riskli, yana kaçarak kaçın
                try { bot.pathfinder.setGoal(null); } catch {}
                const side = Math.random() < 0.5 ? 'left' : 'right';
                bot.setControlState(side, true);
                await sleep(300);
                bot.setControlState(side, false);
            }
        }
    }

    // ─────────────────────────────────────────
    //   YEMEK YEME
    // ─────────────────────────────────────────
    function getBestFood() {
        // minecraft-data'dan item'ın food değerini oku — listeye gerek yok
        const mcData = require('minecraft-data')(bot.version);
        return bot.inventory.items()
            .filter(i => {
                const itemData = mcData.itemsByName[i.name];
                return itemData && itemData.food !== undefined;
            })
            .sort((a, b) => {
                const fa = mcData.itemsByName[a.name].food ?? 0;
                const fb = mcData.itemsByName[b.name].food ?? 0;
                return fb - fa; // en doyurucu önce
            })[0] ?? null;
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

    // Envanter değişince kılıç/kalkan/zırh kontrol
    bot.on('playerCollect', () => {
        equipSword();
        equipShieldIfAvailable();
        equipArmorIfAvailable();
    });

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