/* ============================================================
 * input.js — 输入交互
 * 手牌/场上拖拽（拖拽时战局慢放 10 倍）、点击选中塔与锁定迷雾、
 * 部署落子与合成升级判定、键盘快捷键
 * ============================================================ */

/* ---- 手牌按下：记录起点以区分"点击查看"与"拖拽上阵" ---- */
function onHandCardMouseDown(e, index) {
    let {x: clientX, y: clientY} = getCoord(e);
    handCardMouseDownInfo = { index, startX: clientX, startY: clientY, time: Date.now() };
    onDragStartEvent(e, index);
}

/** 松手时若位移极小且时间短，判定为点击手牌 → 查看塔详情 */
function checkHandCardClick(clientX, clientY) {
    if (!handCardMouseDownInfo) return false;
    let dt = Date.now() - handCardMouseDownInfo.time;
    let dx = Math.abs((clientX || 0) - handCardMouseDownInfo.startX);
    let dy = Math.abs((clientY || 0) - handCardMouseDownInfo.startY);
    let info = handCardMouseDownInfo;
    handCardMouseDownInfo = null;
    if (dt < 250 && dx < 10 && dy < 10) {
        let tower = handTowers[info.index];
        if (tower) { selectedTower = null; showTowerInfo(tower); return true; }
    }
    return false;
}

/* ---- 开始拖拽：进入慢放预演模式 ---- */
function onDragStartEvent(e, index) {
    e.preventDefault();
    activeDragIndex = index;
    draggedFieldTower = null;
    isDragging = true;
    gameTimeScale = 0.1;
    document.getElementById('drag-overlay-tip').classList.remove('hidden');
    let {x: clientX, y: clientY} = getCoord(e);
    updateDragCoordinates(clientX, clientY);
}

/* ---- 点击画布：优先命中塔（选中查看），其次迷雾（锁定集火），否则取消选中 ---- */
function onCanvasDragStart(e) {
    let {x: clientX, y: clientY} = getCoord(e);
    if (!clientX) return;
    const rect = canvas.getBoundingClientRect();
    let cx = (clientX - rect.left) / rect.width * canvas.width;
    let cy = (clientY - rect.top) / rect.height * canvas.height;
    let tower = towers.find(t => Math.hypot(t.x - cx, t.y - cy) < 30);
    if (tower) {
        selectedTower = tower;
        showTowerInfo(tower);
    } else {
        let clickedFog = fogZones.find(fz => {
            if (fz.hp <= 0) return false;
            let s = fz.size || 1;
            return cx >= fz.c*CELL_SIZE && cx <= (fz.c+s)*CELL_SIZE && cy >= fz.r*CELL_SIZE && cy <= (fz.r+s)*CELL_SIZE;
        });
        if (clickedFog) {
            lockedFogZone = (lockedFogZone === clickedFog) ? null : clickedFog;
            triggerToast(lockedFogZone ? "已锁定迷雾为优先攻击目标！" : "已取消优先攻击目标");
        } else {
            if (selectedTower) { selectedTower = null; closeTowerInfo(); }
        }
    }
}

/** 场上拖拽松手时若判定为点击，还原塔位置并弹出详情 */
function checkClickAfterDrag() {
    if (!dragStartInfo) return false;
    let rect = canvas.getBoundingClientRect();
    let dt = Date.now() - dragStartInfo.time;
    let dx = Math.abs(touchX - ((dragStartInfo.startX - rect.left) / rect.width * canvas.width));
    let dy = Math.abs(touchY - ((dragStartInfo.startY - rect.top) / rect.height * canvas.height));
    if (dt < 250 && dx < 15 && dy < 15 && dragStartInfo.tower) {
        selectedTower = dragStartInfo.tower;
        showTowerInfo(dragStartInfo.tower);
        towers.push(dragStartInfo.tower);
        dragStartInfo = null;
        return true;
    }
    dragStartInfo = null;
    return false;
}

/**
 * 拖拽坐标实时演算：
 * 换算画布坐标 → 计算悬停格 → 检查重叠/迷雾/合成候选 → 演算放置后通路是否可达
 */
function updateDragCoordinates(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    touchX = (clientX - rect.left) / rect.width * canvas.width;
    touchY = (clientY - rect.top) / rect.height * canvas.height;
    let draggedT = activeDragIndex !== -1 ? handTowers[activeDragIndex] : draggedFieldTower;
    let tw = draggedT ? (draggedT.width || 1) : 1;
    let th = draggedT ? (draggedT.height || 1) : 1;
    let c = Math.floor((touchX - tw * CELL_SIZE / 2) / CELL_SIZE);
    let r = Math.floor((touchY - th * CELL_SIZE / 2) / CELL_SIZE);
    if (r >= 1 && r + th <= HERO_ROW && c >= 0 && c + tw <= COLS) {
        hoverGrid = { r, c };
        let vis = getVisibilityMatrix();
        let blocked = false;
        let potentialMerge = null;
        for(let dr=0; dr<th && !blocked; dr++) for(let dc=0; dc<tw && !blocked; dc++) {
            if (obstacles.some(o => o.r <= r+dr && o.r + (o.height||1) > r+dr && o.c <= c+dc && o.c + (o.width||1) > c+dc)) blocked = true;
            if (fogZones.some(fz => fz.hp > 0 && fz.r <= r+dr && fz.r + (fz.size||1) > r+dr && fz.c <= c+dc && fz.c + (fz.size||1) > c+dc)) blocked = true;
            let overlapTower = towers.find(t => t.r <= r+dr && t.r + (t.height||1) > r+dr && t.c <= c+dc && t.c + (t.width||1) > c+dc);
            if (overlapTower) {
                if (overlapTower === potentialMerge) {
                } else if (!potentialMerge && draggedT && overlapTower.id === draggedT.id && (overlapTower.level || 1) < MAX_TOWER_LEVEL) {
                    potentialMerge = overlapTower;
                } else {
                    blocked = true;
                }
            }
            if (!vis[r+dr][c+dc]) blocked = true;
        }
        if (!blocked && potentialMerge) {
            mergeTarget = potentialMerge;
            simulatedPathValid = false;
            simulatedPath = null;
        } else if (!blocked) {
            mergeTarget = null;
            simulatedPathValid = checkPlacementValid(r, c, tw, th);
            simulatedPath = simulatedPathValid ? findAStarPath(0, c, {r, c, width: tw, height: th}) : null;
        } else {
            mergeTarget = null; simulatedPathValid = false; simulatedPath = null;
        }
    } else {
        hoverGrid = null; mergeTarget = null; simulatedPathValid = false; simulatedPath = null;
    }
}

/* ---- 拖拽结束：合成升级 / 部署落子 / 非法位置回弹 ---- */
function onDragEndEvent(e) {
    if (!isDragging) return;
    let {x: clientX, y: clientY} = getCoord(e);
    if (checkHandCardClick(clientX, clientY)) {
        isDragging = false;
        document.getElementById('drag-overlay-tip').classList.add('hidden');
        activeDragIndex = -1; draggedFieldTower = null; hoverGrid = null; simulatedPath = null; mergeTarget = null;
        return;
    }
    isDragging = false; gameTimeScale = 1.0;
    document.getElementById('drag-overlay-tip').classList.add('hidden');
    let draggedT = activeDragIndex !== -1 ? handTowers[activeDragIndex] : draggedFieldTower;
    if (mergeTarget && draggedT && activeDragIndex !== -1) {
        mergeTarget.level = Math.min(MAX_TOWER_LEVEL, (mergeTarget.level || 1) + 1);
        handTowers.splice(activeDragIndex, 1);
        triggerToast(mergeTarget.name + " 升级至 " + mergeTarget.level + "★！");
        renderHandUI();
    } else if (hoverGrid && draggedT && activeDragIndex !== -1 && simulatedPathValid) {
        let tr = hoverGrid.r, tc = hoverGrid.c;
        let tw = draggedT.width || 1, th = draggedT.height || 1;
        towers.push({
            ...draggedT, r: tr, c: tc, width: tw, height: th,
            x: tc * CELL_SIZE + (tw * CELL_SIZE) / 2, y: tr * CELL_SIZE + (th * CELL_SIZE) / 2,
            cooldown: 0
        });
        handTowers.splice(activeDragIndex, 1);
        triggerToast("防线部署完成！");
        repathMonsters();
    } else if (activeDragIndex !== -1) {
        triggerToast("位置不合法、有迷雾阻挡或堵死了终点路段！");
    }
    activeDragIndex = -1; draggedFieldTower = null; hoverGrid = null; simulatedPath = null; simulatedPathValid = false; mergeTarget = null;
    renderHandUI();
    updateHUD();
}

/* ---- 全局事件绑定（脚本加载即生效） ---- */
window.addEventListener('mousemove', e => { if (isDragging) { let {x, y} = getCoord(e); updateDragCoordinates(x, y); } });
window.addEventListener('touchmove', e => { if (isDragging && e.touches[0]) { let {x, y} = getCoord(e); updateDragCoordinates(x, y); } }, { passive: false });
window.addEventListener('mouseup', onDragEndEvent);
window.addEventListener('touchend', onDragEndEvent);
canvas.addEventListener('mousedown', onCanvasDragStart);
canvas.addEventListener('touchstart', onCanvasDragStart, { passive: false });

/* ---- 键盘快捷键：空格倍速 · D 招募 · F 词条 · Q/Esc 取消 ---- */
window.addEventListener('keydown', e => {
    if (e.repeat) return;
    const overlay = DOM.gameOverlay;
    if (!overlay || overlay.style.display !== 'none') return;
    switch (e.key.toLowerCase()) {
        case ' ': e.preventDefault(); toggleSpeed(); break;
        case 'd': drawTowerToHand(); break;
        case 'f': startAffixDraft(); break;
        case 'q':
        case 'escape':
            if (!document.getElementById('tower-info-panel').classList.contains('hidden')) { closeTowerInfo(); }
            else if (!document.getElementById('draft-modal').classList.contains('hidden')) { }
            else if (selectedTower) { selectedTower = null; }
            break;
    }
});
