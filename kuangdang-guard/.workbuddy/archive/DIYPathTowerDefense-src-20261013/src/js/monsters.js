/* ============================================================
 * monsters.js — 怪物与波次
 * 波次编队、怪物生成（随波次成长）、击杀奖励
 * ============================================================ */

/** 开启新波次：按波数决定总量，随机编入五种怪物 */
function startWave() {
    document.getElementById('wave-val').textContent = `第 ${wave} 波`;
    const total = 5 + 2 * wave;
    const typeKeys = Object.keys(MONSTER_TYPES);
    waveMonsterQueue = [];
    for (let i = 0; i < total; i++) waveMonsterQueue.push(typeKeys[Math.floor(Math.random() * typeKeys.length)]);
    waveSpawnTimer = 60;
    waveIntervalTimer = 0;
}

/** 从顶行随机列出生一只怪物，属性随波次成长并乘以类型倍率 */
function spawnMonster(type) {
    let sc = Math.floor(Math.random() * COLS);
    let sr = 0;
    let sx = sc * CELL_SIZE + CELL_SIZE/2;
    let sy = -CELL_SIZE;
    const mtype = MONSTER_TYPES[type] || MONSTER_TYPES.normal;
    let baseHP = 50 + (wave - 1) * 50, baseArmor = 10 + wave * 5, baseMR = 10 + wave * 5;
    let finalHP = Math.round(baseHP * mtype.hpMult), finalArmor = Math.round(baseArmor * mtype.armorMult), finalMR = Math.round(baseMR * mtype.mrMult), finalSpeed = 1.5 * mtype.speedMult;
    let m = {
        id: Math.random().toString(),
        x: sx, y: sy,
        hp: finalHP, maxHp: finalHP,
        speed: finalSpeed, armor: finalArmor, mr: finalMR,
        atk: 2, asp: 1.0, range: 1.0,
        emoji: mtype.emoji,
        typeName: mtype.name,
        atkCd: 0, slowT: 0, freezeT: 0,
        pathIndex: 0, visibleOnce: false
    };
    m.activePath = findAStarPath(sr, sc);
    monsters.push(m);
}

/** 防线变动后让所有怪物立即重新寻路 */
function repathMonsters() {
    monsters.forEach(m => {
        m.pathIndex = 0;
        let clampR = Math.max(0, Math.floor(m.y/CELL_SIZE));
        let clampC = Math.max(0, Math.min(COLS - 1, Math.floor(m.x/CELL_SIZE)));
        m.activePath = findAStarPath(clampR, clampC);
    });
}

/** 击杀奖励：金币入账并飘字提示 */
function killMonster(m) {
    let reward = 8 + wave * 2;
    gold += reward;
    updateHUD();
    particles.push({type: 'text', text: `+${reward}💎`, x: m.x, y: m.y, life: 30});
}
