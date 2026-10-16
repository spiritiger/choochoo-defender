/* ============================================================
 * towers.js — 防御塔业务逻辑
 * 属性成长公式、手牌招募（抽塔）
 * ============================================================ */

/** 按星级换算塔的有效属性（攻/射程/攻速随等级线性成长） */
function getTowerEffStats(t) {
    const lvl = t.level || 1;
    return { atk: t.baseAtk * (1 + (lvl - 1) * 0.5), range: t.range * (1 + (lvl - 1) * 0.08), rate: t.rate * (1 + (lvl - 1) * 0.1) };
}

/** 招募：随机抽一座塔进手牌，价格随招募次数递增（10、20、30...） */
function drawTowerToHand() {
    if (handTowers.length >= 5) return triggerToast("手牌已满，请先放下一座塔！");
    const cost = 10 + 10 * g_towerDrawCount;
    if (gold < cost) return triggerToast("能量宝石不足！");
    gold -= cost; g_towerDrawCount++;
    const keys = Object.keys(TOWER_TYPES);
    const rK = keys[Math.floor(Math.random() * keys.length)];
    handTowers.push({ ...TOWER_TYPES[rK], level: 1 });
    updateHUD();
    triggerToast(`已招募: ${TOWER_TYPES[rK].emoji} (Lv.1)！拖拽上阵。`);
}
