/* ============================================================
 * mapgen.js — 地图生成与可见性
 * 程序化障碍布局、迷雾区域生成、迷雾可见性矩阵（带缓存）
 * ============================================================ */

/**
 * 程序化生成障碍：
 * - 上半场随机 1~2 个 2x2 障碍
 * - 下半场 S 形通道两侧各放 2x2 障碍收窄路线
 * - 英雄上方 3 行×5 列为保护区，且保证放置后不堵死通路
 */
function generateProceduralObstacles() {
    obstacles = [];
    const aboveRow = HERO_ROW - 1;
    const centerCol = HERO_COL;
    const safeRows = new Set([aboveRow, aboveRow-1, aboveRow-2]);
    const safeCols = new Set([centerCol - 2, centerCol - 1, centerCol, centerCol + 1, centerCol + 2].filter(c => c >= 0 && c < COLS));
    function hasEnoughSpace(r, c, w, h) {
        return !obstacles.some(o => {
            let ow = o.width || 1, oh = o.height || 1;
            return r < o.r + oh && r + h > o.r && c < o.c + ow && c + w > o.c;
        });
    }
    function tryPlace(r, c, w, h, checkSafeCols) {
        if (r < 1 || c < 0 || r + h > ROWS - 1 || c + w > COLS) return false;
        for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) {
            if (safeRows.has(r + dr) && safeCols.has(c + dc)) return false;
        }
        if (checkSafeCols) { for (let dc = 0; dc < w; dc++) if (safeCols.has(c + dc)) return false; }
        if (!hasEnoughSpace(r, c, w, h)) return false;
        obstacles.push({ r, c, width: w, height: h });
        if (!checkPlacementValid(r, c, w, h)) { obstacles.pop(); return false; }
        return true;
    }
    const upperTarget = 1 + Math.floor(Math.random() * 2);
    let tries = 0;
    while (obstacles.length < upperTarget && tries < 300) {
        tries++;
        let r = 2 + Math.floor(Math.random() * 15);
        let c = Math.floor(Math.random() * (COLS - 1));
        tryPlace(r, c, 2, 2, false);
    }
    const sSegments = [
        { minR: 17, maxR: 18, side: 'left',  count: 1 },
        { minR: 19, maxR: 20, side: 'right', count: 1 + Math.floor(Math.random() * 2) },
    ];
    for (let seg of sSegments) {
        for (let n = 0; n < seg.count; n++) {
            tries = 0;
            let placed = false;
            while (!placed && tries < 200) {
                tries++;
                let r = seg.minR + Math.floor(Math.random() * (seg.maxR - seg.minR + 1));
                let c = seg.side === 'left' ? Math.floor(Math.random() * 5) : COLS - 4 + Math.floor(Math.random() * 4);
                if (tryPlace(r, c, 2, 2, true)) placed = true;
            }
        }
    }
}

/**
 * 生成迷雾区域：从第 2~16 行自上而下、由大到小（3x3 → 1x1）贪心铺放，
 * 按尺寸随机跳过一部分，形成大小混排的迷雾带；不同尺寸对应不同血量与奖励
 */
function generateFogZones() {
    fogZones = [];
    const R_START = 2, R_END = 16;
    let occupied = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    const hpTable = { 1: { hp: 250, reward: 100 }, 2: { hp: 600, reward: 250 }, 3: { hp: 1200, reward: 500 } };
    for (let size = 3; size >= 1; size--) {
        for (let r = R_START; r <= R_END - size + 1; r++) {
            for (let c = 0; c <= COLS - size; c++) {
                let free = true;
                for (let dr = 0; dr < size && free; dr++)
                    for (let dc = 0; dc < size && free; dc++)
                        if (occupied[r+dr][c+dc]) free = false;
                if (!free) continue;
                if (size === 3 && Math.random() < 0.55) continue;
                if (size === 2 && Math.random() < 0.20) continue;
                let cfg = hpTable[size];
                fogZones.push({
                    r, c, size,
                    x: c * CELL_SIZE + size * CELL_SIZE / 2,
                    y: r * CELL_SIZE + size * CELL_SIZE / 2,
                    hp: cfg.hp, maxHp: cfg.hp, reward: cfg.reward
                });
                for (let dr = 0; dr < size; dr++)
                    for (let dc = 0; dc < size; dc++)
                        occupied[r+dr][c+dc] = true;
            }
        }
    }
}

/**
 * 迷雾可见性矩阵（带脏检查缓存）：
 * 迷雾存活的格子为不可见；只有迷雾血量/数量变化时才重建
 */
function getVisibilityMatrix() {
    let needsRebuild = !_visCache || fogZones.some(fz => fz._dirty);
    if (!needsRebuild && _visCache._fogSig !== fogZones.length) needsRebuild = true;
    if (!needsRebuild) {
        for (let fz of fogZones) { if (fz._lastHp !== fz.hp) { needsRebuild = true; break; } }
    }
    if (!needsRebuild) return _visCache;
    let vis = Array(ROWS).fill(null).map(() => Array(COLS).fill(true));
    fogZones.forEach(fz => {
        fz._lastHp = fz.hp;
        if (fz.hp > 0) {
            let s = fz.size || 1;
            for (let dr = 0; dr < s; dr++)
                for (let dc = 0; dc < s; dc++)
                    if (fz.r + dr < ROWS && fz.c + dc < COLS) vis[fz.r + dr][fz.c + dc] = false;
        }
    });
    vis._fogSig = fogZones.length;
    _visCache = vis;
    return vis;
}
