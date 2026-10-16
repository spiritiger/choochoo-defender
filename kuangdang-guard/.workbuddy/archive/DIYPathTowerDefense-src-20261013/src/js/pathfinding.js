/* ============================================================
 * pathfinding.js — A* 寻路与放置合法性校验
 * 怪物从出生行走向英雄格；任何部署不能堵死所有通路
 * ============================================================ */

class PathNode {
    constructor(r, c, parent = null, g = 0, h = 0) {
        this.r = r; this.c = c; this.parent = parent;
        this.g = g; this.h = h; this.f = g + h;
    }
}

/** 构建阻挡图：障碍物 + 塔身 + 可选的虚拟障碍（拖拽预演），可忽略某格 */
function buildBlockMap(virtualObstacle = null, ignoreCell = null) {
    let blockMap = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    obstacles.forEach(o => {
        for(let dr=0; dr<(o.height||1); dr++) for(let dc=0; dc<(o.width||1); dc++) {
            if(o.r+dr < ROWS && o.c+dc < COLS) blockMap[o.r+dr][o.c+dc] = true;
        }
    });
    towers.forEach(t => {
        for(let dr=0; dr<(t.height||1); dr++) for(let dc=0; dc<(t.width||1); dc++) {
            if(t.r+dr < ROWS && t.c+dc < COLS) blockMap[t.r+dr][t.c+dc] = true;
        }
    });
    if (virtualObstacle) {
        for(let dr=0; dr<(virtualObstacle.height||1); dr++) for(let dc=0; dc<(virtualObstacle.width||1); dc++) {
            if(virtualObstacle.r+dr < ROWS && virtualObstacle.c+dc < COLS) blockMap[virtualObstacle.r+dr][virtualObstacle.c+dc] = true;
        }
    }
    if (ignoreCell) blockMap[ignoreCell.r][ignoreCell.c] = false;
    return blockMap;
}

/** 在给定阻挡图上从任意顶行入口寻找通向英雄格的路径（4 向） */
function findAStarPathOnMap(blockMap, startR, startC) {
    startR = Math.max(0, Math.min(ROWS - 1, startR));
    startC = Math.max(0, Math.min(COLS - 1, startC));
    if (blockMap[startR][startC]) return null;
    let openList = [];
    let closedSet = new Set();
    openList.push(new PathNode(startR, startC, null, 0, Math.abs(startR - HERO_ROW) + Math.abs(startC - HERO_COL)));
    while(openList.length > 0) {
        openList.sort((a, b) => a.f - b.f);
        let current = openList.shift();
        if (current.r === HERO_ROW && current.c === HERO_COL) {
            let path = []; let temp = current;
            while(temp) { path.push({r: temp.r, c: temp.c}); temp = temp.parent; }
            return path.reverse();
        }
        closedSet.add(`${current.r},${current.c}`);
        [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr, dc]) => {
            let nr = current.r + dr, nc = current.c + dc;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;
            if (blockMap[nr][nc] || closedSet.has(`${nr},${nc}`)) return;
            let g = current.g + 1;
            let exist = openList.find(n => n.r === nr && n.c === nc);
            if (exist) { if (g < exist.g) { exist.g = g; exist.f = g + exist.h; exist.parent = current; } }
            else openList.push(new PathNode(nr, nc, current, g, Math.abs(nr - HERO_ROW) + Math.abs(nc - HERO_COL)));
        });
    }
    return null;
}

/** 便捷封装：实时构建阻挡图后寻路 */
function findAStarPath(startR, startC, virtualObstacle = null, ignoreCell = null) {
    return findAStarPathOnMap(buildBlockMap(virtualObstacle, ignoreCell), startR, startC);
}

/** 放置校验：将候选位置视为虚拟障碍后，仍需存在至少一条顶行到英雄的通路 */
function checkPlacementValid(tr, tc, tw = 1, th = 1) {
    let blockMap = buildBlockMap({r: tr, c: tc, width: tw, height: th});
    for (let c = 0; c < COLS; c++) {
        if (findAStarPathOnMap(blockMap, 0, c)) return true;
    }
    return false;
}
