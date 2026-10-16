/* ============================================================
 * main.js — 游戏流程与主循环
 * 开局初始化、每帧驱动、倍速切换、入口挂载
 * ============================================================ */

/** 开新局：重置全部状态并生成地图，随后进入第一波 */
function startGame() {
    if (DOM.gameOverlay) DOM.gameOverlay.style.display = 'none';
    hp = 500; gold = 100; wave = 1; gameTimeScale = 1.0;
    speedMultiplier = 1; isPaused = false;
    const sl = document.getElementById('speed-label'); if (sl) sl.textContent = '1×';
    const sb = document.getElementById('speed-btn');
    if (sb) sb.classList.remove('bg-emerald-600/80', 'border-emerald-400/50', 'bg-rose-600/80', 'border-rose-400/50');
    g_towerDrawCount = 0; g_affixDrawCount = 0;
    towers = []; monsters = []; projectiles = []; particles = []; handTowers = []; fogZones = []; temporaryGroundEffects = [];
    draggedFieldTower = null; mergeTarget = null; activeDragIndex = -1; isDragging = false; selectedTower = null; dragStartInfo = null; lockedFogZone = null;
    for (let k in ACTIVE_AFFIXES) ACTIVE_AFFIXES[k] = INITIAL_AFFIXES[k];
    updateCodexUI();
    document.getElementById('tower-info-panel').classList.add('hidden');
    generateProceduralObstacles();
    generateFogZones();
    updateHUD(); startWave();
}

/** 主循环：暂停时仅重绘（保持界面响应），否则按时间缩放推进战斗 */
function engineLoop() {
    if (isPaused) { draw(); requestAnimationFrame(engineLoop); return; }
    let effScale = gameTimeScale < 1 ? gameTimeScale : gameTimeScale * speedMultiplier;
    updateCombat(effScale); draw(); requestAnimationFrame(engineLoop);
}

/** 倍速切换：1× → 2× → 4× → 暂停 → 1× */
function toggleSpeed() {
    if (isPaused) { isPaused = false; speedMultiplier = 1; }
    else if (speedMultiplier === 1) speedMultiplier = 2;
    else if (speedMultiplier === 2) speedMultiplier = 4;
    else { isPaused = true; speedMultiplier = 1; }
    const btn = document.getElementById('speed-btn');
    const label = document.getElementById('speed-label');
    label.textContent = isPaused ? '❚❚' : speedMultiplier + '×';
    btn.classList.toggle('bg-emerald-600/80', !isPaused && speedMultiplier > 1);
    btn.classList.toggle('border-emerald-400/50', !isPaused && speedMultiplier > 1);
    btn.classList.toggle('bg-rose-600/80', isPaused);
    btn.classList.toggle('border-rose-400/50', isPaused);
    triggerToast(isPaused ? '已暂停' : `已切换 ${speedMultiplier} 倍速`);
}

/* ---- 入口：页面加载后先生成一张预览地图，再启动主循环 ---- */
window.onload = () => { generateProceduralObstacles(); generateFogZones(); engineLoop(); };
