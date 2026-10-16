/* ============================================================
 * renderer.js — Canvas 渲染层
 * 每帧完整重绘：棋盘格 → 障碍 → 塔（含合成高亮） → 怪物 →
 * 地面效果 → 弹道 → 粒子 → 迷雾 → 英雄行 → 拖拽预览
 * ============================================================ */

/** 通用血条绘制 */
function drawHpBar(cx, cy, hpRatio, width) {
    ctx.fillStyle = "rgba(0,0,0,0.1)"; ctx.fillRect(cx - width/2, cy, width, 4);
    ctx.fillStyle = hpRatio > 0.5 ? "#10b981" : "#ef4444"; ctx.fillRect(cx - width/2, cy, width * hpRatio, 4);
}

/** 主绘制函数（每帧调用） */
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let vis = getVisibilityMatrix();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            ctx.fillStyle = (r+c)%2 === 0 ? "#f8fafc" : "#f1f5f9";
            if (r <= 1) ctx.fillStyle = "#fee2e2";
            ctx.fillRect(c*CELL_SIZE, r*CELL_SIZE, CELL_SIZE, CELL_SIZE);
            if (vis[r][c] && r > 1 && r < HERO_ROW) {
                ctx.strokeStyle = "rgba(16, 185, 129, 0.08)";
                ctx.lineWidth = 1; ctx.strokeRect(c*CELL_SIZE, r*CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }
    obstacles.forEach(o => {
        let ow = o.width || 1, oh = o.height || 1;
        ctx.fillStyle = "#475569"; ctx.beginPath();
        ctx.roundRect(o.c*CELL_SIZE+4, o.r*CELL_SIZE+4, ow*CELL_SIZE-8, oh*CELL_SIZE-8, 12); ctx.fill();
        ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#fbbf24"; ctx.font = (ow*oh >= 4 ? "44px" : "40px") + " Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("🗿", o.c*CELL_SIZE+(ow*CELL_SIZE)/2, o.r*CELL_SIZE+(oh*CELL_SIZE)/2);
    });
    towers.forEach(t => {
        let lvl = t.level || 1;
        let tw = t.width || 1, th = t.height || 1;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(t.c*CELL_SIZE+4, t.r*CELL_SIZE+4, tw*CELL_SIZE-8, th*CELL_SIZE-8, 12); ctx.fill(); ctx.stroke();
        if (isDragging && activeDragIndex !== -1 && handTowers[activeDragIndex] && t.id === handTowers[activeDragIndex].id && lvl < MAX_TOWER_LEVEL) {
            let pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
            ctx.fillStyle = "rgba(251, 191, 36, " + (0.12 + pulse * 0.18) + ")";
            ctx.beginPath(); ctx.roundRect(t.c*CELL_SIZE-4, t.r*CELL_SIZE-4, tw*CELL_SIZE+8, th*CELL_SIZE+8, 16); ctx.fill();
            ctx.fillStyle = "rgba(251, 191, 36, " + (0.2 + pulse * 0.2) + ")";
            ctx.beginPath(); ctx.roundRect(t.c*CELL_SIZE-1, t.r*CELL_SIZE-1, tw*CELL_SIZE+2, th*CELL_SIZE+2, 14); ctx.fill();
            ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 4 + pulse * 1.5;
            ctx.beginPath(); ctx.roundRect(t.c*CELL_SIZE+1, t.r*CELL_SIZE+1, tw*CELL_SIZE-2, th*CELL_SIZE-2, 13); ctx.stroke();
            let arwY = t.r*CELL_SIZE - 12;
            ctx.fillStyle = "#fbbf24";
            ctx.beginPath(); ctx.arc(t.x, arwY, 11, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = "#fff"; ctx.font = "bold 15px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
            ctx.fillText("⬆", t.x, arwY + 1);
        }
        if (mergeTarget === t) {
            ctx.strokeStyle = "#10b981"; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.roundRect(t.c*CELL_SIZE+2, t.r*CELL_SIZE+2, tw*CELL_SIZE-4, th*CELL_SIZE-4, 14); ctx.stroke();
            ctx.fillStyle = "#10b981"; ctx.font = "bold 20px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
            ctx.fillText("⬆", t.x, t.y - tw*CELL_SIZE/2 - 6);
        }
        if (selectedTower === t) {
            let eff = getTowerEffStats(t);
            ctx.fillStyle = t.color + '20';
            ctx.beginPath(); ctx.arc(t.x, t.y, eff.range, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = t.color + 'aa'; ctx.lineWidth = 2; ctx.setLineDash([6,6]);
            ctx.beginPath(); ctx.arc(t.x, t.y, eff.range, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
            ctx.strokeStyle = "#10b981"; ctx.lineWidth = 2; ctx.setLineDash([4,4]);
            ctx.beginPath(); ctx.roundRect(t.c*CELL_SIZE+4, t.r*CELL_SIZE+4, tw*CELL_SIZE-8, th*CELL_SIZE-8, 12); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = "#000"; ctx.font = (tw*th >= 4 ? "36px" : "32px") + " Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(t.emoji, t.x, t.y+2);
        {
            let stars = '★'.repeat(lvl);
            ctx.font = "bold " + (lvl >= 4 ? "10px" : "11px") + " Arial";
            ctx.textAlign="center"; ctx.textBaseline="middle";
            ctx.fillStyle = lvl >= 4 ? "#f59e0b" : t.color;
            ctx.fillText(stars, t.x, t.r*CELL_SIZE + 10);
        }
    });
    monsters.forEach(m => {
        let { r: mr, c: mc } = cellOf(m.x, m.y);
        let inFog = !vis[mr]?.[mc];
        if (!inFog) {
            ctx.font="32px Arial"; ctx.fillText(m.emoji, m.x, m.y);
            drawHpBar(m.x, m.y-24, m.hp/m.maxHp, 36);
        }
    });
    temporaryGroundEffects.forEach(ge => {
        if (ge.type === 'fire') {
            ctx.fillStyle = "rgba(249, 115, 22, 0.2)";
            ctx.beginPath(); ctx.arc(ge.x, ge.y, 40, 0, Math.PI*2); ctx.fill();
            ctx.font = "20px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
            ctx.fillText("🔥", ge.x, ge.y);
        } else if (ge.type === 'frost') {
            ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
            ctx.beginPath(); ctx.arc(ge.x, ge.y, 30, 0, Math.PI*2); ctx.fill();
        } else if (ge.type === 'mine') {
            ctx.fillStyle = "rgba(245, 158, 11, 0.3)";
            ctx.beginPath(); ctx.arc(ge.x, ge.y, 8, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#f59e0b";
            ctx.beginPath(); ctx.arc(ge.x, ge.y, 4, 0, Math.PI*2); ctx.fill();
        } else if (ge.type === 'icering') {
            let progress = 1 - ge.life / 20;
            let r = ge.radius * progress;
            ctx.strokeStyle = "rgba(59, 130, 246, " + (ge.life/20 * 0.8) + ")";
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(ge.x, ge.y, r, 0, Math.PI*2); ctx.stroke();
            ctx.fillStyle = "rgba(96, 165, 250, " + (ge.life/20 * 0.15) + ")";
            ctx.beginPath(); ctx.arc(ge.x, ge.y, r, 0, Math.PI*2); ctx.fill();
        }
    });
    projectiles.forEach(p => { ctx.fillStyle=TOWER_TYPES[p.towerId].color; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill(); });
    particles.forEach(p => {
        if (p.type === 'text') { ctx.fillStyle="rgba(245, 158, 11, 0.9)"; ctx.font="bold 16px Arial"; ctx.fillText(p.text, p.x, p.y); }
        else { ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill(); }
    });
    let fogCells = new Set();
    fogZones.forEach(fz => {
        if (fz.hp > 0) { let s = fz.size || 1; for (let dr = 0; dr < s; dr++) for (let dc = 0; dc < s; dc++) fogCells.add((fz.r+dr) + ',' + (fz.c+dc)); }
    });
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!vis[r][c]) {
                ctx.fillStyle = "#334155"; ctx.fillRect(c*CELL_SIZE, r*CELL_SIZE, CELL_SIZE, CELL_SIZE);
                if (!fogCells.has(r + ',' + c)) {
                    ctx.font = "32px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
                    ctx.fillText("☁️", c*CELL_SIZE+CELL_SIZE/2, r*CELL_SIZE+CELL_SIZE/2);
                }
            }
        }
    }
    monsters.forEach(m => {
        let { r: mr, c: mc } = cellOf(m.x, m.y);
        if (!vis[mr]?.[mc]) {
            let pulse = 1 + 0.2 * Math.sin(Date.now() / 200);
            ctx.fillStyle = "#ef4444";
            ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(m.x, m.y, 7 * pulse, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        }
    });
    fogZones.forEach(fz => {
        if (fz.hp <= 0) return;
        let s = fz.size || 1;
        let px = fz.c * CELL_SIZE, py = fz.r * CELL_SIZE;
        let pw = s * CELL_SIZE, ph = s * CELL_SIZE;
        let iconSize = s === 1 ? 32 : s === 2 ? 44 : 56;
        ctx.font = iconSize + "px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("☁️", fz.x, fz.y);
        let pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
        ctx.strokeStyle = "rgba(139, 92, 246, " + (0.5 + pulse * 0.3) + ")"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(px+2, py+2, pw-4, ph-4, 8); ctx.stroke();
        {
            let bw = s * 36;
            drawHpBar(fz.x, py + 4, fz.hp/fz.maxHp, bw);
        }
        if (lockedFogZone === fz) {
            ctx.strokeStyle = "#facc15"; ctx.lineWidth = 3;
            let r = s * CELL_SIZE / 2 + 4;
            ctx.beginPath(); ctx.arc(fz.x, fz.y, r, 0, Math.PI*2); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(fz.x - r - 6, fz.y); ctx.lineTo(fz.x - r + 4, fz.y);
            ctx.moveTo(fz.x + r - 4, fz.y); ctx.lineTo(fz.x + r + 6, fz.y);
            ctx.moveTo(fz.x, fz.y - r - 6); ctx.lineTo(fz.x, fz.y - r + 4);
            ctx.moveTo(fz.x, fz.y + r - 4); ctx.lineTo(fz.x, fz.y + r + 6);
            ctx.stroke();
        }
    });
    for (let c = 0; c < COLS; c++) {
        let cx = c*CELL_SIZE+CELL_SIZE/2, cy = HERO_ROW*CELL_SIZE+CELL_SIZE/2;
        if(c === HERO_COL) { ctx.font="42px Arial"; ctx.fillText("🧙‍♂️", cx, cy); }
        else { ctx.font="30px Arial"; ctx.fillText("🔥", cx, cy); }
    }
    if (isDragging && activeDragIndex !== -1 && hoverGrid) {
        let tr = hoverGrid.r, tc = hoverGrid.c;
        let bt = handTowers[activeDragIndex];
        let tw = bt.width || 1, th = bt.height || 1;
        if (mergeTarget) {
            let mt = mergeTarget;
            let newLvl = Math.min(MAX_TOWER_LEVEL, (mt.level || 1) + 1);
            ctx.fillStyle = "#10b981"; ctx.font = "bold 14px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
            ctx.fillText("⬆ " + newLvl + "★", mt.x, mt.y - (mt.width||1)*CELL_SIZE/2 - 14);
        } else {
            ctx.strokeStyle = simulatedPathValid ? "#10b981" : "#ef4444";
            ctx.lineWidth = 3; ctx.setLineDash([6,6]);
            ctx.strokeRect(tc*CELL_SIZE, tr*CELL_SIZE, tw*CELL_SIZE, th*CELL_SIZE); ctx.setLineDash([]);
            if (simulatedPathValid && bt) {
                let eff = getTowerEffStats(bt);
                let cx = tc*CELL_SIZE + (tw*CELL_SIZE)/2, cy = tr*CELL_SIZE + (th*CELL_SIZE)/2;
                ctx.fillStyle = bt.color + '15';
                ctx.beginPath(); ctx.arc(cx, cy, eff.range, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = bt.color + '80'; ctx.lineWidth = 1.5; ctx.setLineDash([4,4]);
                ctx.beginPath(); ctx.arc(cx, cy, eff.range, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
            }
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.strokeStyle = bt.color;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.roundRect(tc*CELL_SIZE+4, tr*CELL_SIZE+4, tw*CELL_SIZE-8, th*CELL_SIZE-8, 12); ctx.fill(); ctx.stroke();
            ctx.globalAlpha = 1.0;
            ctx.fillStyle="#000"; ctx.font = (tw*th >= 4 ? "36px" : "32px") + " Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
            ctx.fillText(bt.emoji, tc*CELL_SIZE+(tw*CELL_SIZE)/2, tr*CELL_SIZE+(th*CELL_SIZE)/2+2);
        }
    }
}
