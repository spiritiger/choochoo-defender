/* ============================================================
 * combat.js — 战斗核心
 * 伤害结算与词条反应、弹道更新、塔索敌开火、地面效果、
 * 怪物移动与攻城、波次调度、粒子特效
 * ============================================================ */

/** 通用粒子迸溅 */
function spawnParticles(x, y, color) {
    for(let i=0; i<6; i++) particles.push({x, y, vx: (Math.random()-0.5)*4, vy: (Math.random()-0.5)*4, life: 15, color, size: Math.random()*3+1});
}

/** 伤害结算：物法抗性减伤、融穿削抗、冷血追击增伤、钉刺定身、能量溢出爆破 */
function dealDamage(m, dmg, type, sourceTowerId) {
    if(m.hp <= 0) return;
    let res = type === 'physical' ? m.armor : m.mr;
    if (type === 'magic' && sourceTowerId === 'magic' && ACTIVE_AFFIXES.m2 > 0) {
        m.mr = Math.max(0, m.mr * (1 - 0.09 * ACTIVE_AFFIXES.m2));
        res = m.mr;
    }
    if ((m.slowT > 0 || m.freezeT > 0) && sourceTowerId === 'ice' && ACTIVE_AFFIXES.i5) dmg *= 1 + 0.3;
    m.hp -= Math.max(1, Math.floor(dmg * (100 / (100 + res))));
    spawnParticles(m.x, m.y, type === 'magic' ? '#a855f7' : '#ef4444');
    if (sourceTowerId === 'arrow' && ACTIVE_AFFIXES.a2 > 0 && Math.random() < 0.09 * ACTIVE_AFFIXES.a2) m.freezeT = Math.max(m.freezeT, 18);
    if (sourceTowerId === 'magic' && ACTIVE_AFFIXES.m3 && m.hp <= 0) {
        let overflow = -m.hp;
        if (overflow > 0) monsters.forEach(other => { if (other !== m && other.hp > 0 && Math.hypot(other.x-m.x, other.y-m.y) < 80) { dealDamage(other, Math.floor(overflow * 0.3), 'magic', 'magic'); spawnParticles(other.x, other.y, '#a855f7'); } });
    }
    if (m.hp <= 0) killMonster(m);
}

/** 对迷雾区域造成伤害；击破后发奖励并解锁区域 */
function damageFogZone(fz, dmg) {
    if (fz.hp <= 0) return;
    fz.hp -= dmg;
    spawnParticles(fz.x, fz.y, '#6366f1');
    if (fz.hp <= 0) {
        gold += fz.reward; updateHUD();
        particles.push({type: 'text', text: `+${fz.reward}💎`, x: fz.x, y: fz.y, life: 40});
        if (lockedFogZone === fz) lockedFogZone = null;
        triggerToast("迷雾已驱散！区域已解锁！");
    }
}

/** 战斗主更新（每帧调用，dtScale 为时间缩放） */
function updateCombat(dtScale) {
    let vis = getVisibilityMatrix();
    function isVisible(x, y) {
        let r = Math.floor(y / CELL_SIZE), c = Math.floor(x / CELL_SIZE);
        return r >= 0 && r < ROWS && c >= 0 && c < COLS && vis[r][c];
    }
    function repath(m) {
        m.pathIndex = 0;
        let cr = Math.max(0, Math.floor(m.y/CELL_SIZE)), cc = Math.max(0, Math.min(COLS-1, Math.floor(m.x/CELL_SIZE)));
        m.activePath = findAStarPath(cr, cc);
    }
    /* 炮塔命中后的词条反应：震退/分裂/燃地带/布雷 */
    function cannonAffixHit(p) {
        if (p.isSplit) return;
        if (ACTIVE_AFFIXES.c2) monsters.forEach(m => { if (m.hp > 0 && Math.hypot(m.x-p.x, m.y-p.y) < 60) { let dx = m.x-p.x, dy = m.y-p.y, len = Math.hypot(dx,dy)||1; m.x += (dx/len)*CELL_SIZE*0.5; m.y += (dy/len)*CELL_SIZE*0.5; repath(m); } });
        if (ACTIVE_AFFIXES.c3) for (let k=0; k<2; k++) { let a = (k/2)*Math.PI*2; projectiles.push({x:p.x, y:p.y, vx:Math.cos(a)*6, vy:Math.sin(a)*6, dmg:p.dmg*0.3, towerId:'cannon', life:30, target:'monster', aoeRadius:0, isSplit:true}); }
        if (ACTIVE_AFFIXES.c4) temporaryGroundEffects.push({x:p.x, y:p.y, life:120, type:'fire', dmg:3});
        if (ACTIVE_AFFIXES.c1) for (let i=0; i<2; i++) { let a = Math.random()*Math.PI*2, d = 20+Math.random()*30; temporaryGroundEffects.push({x:p.x+Math.cos(a)*d, y:p.y+Math.sin(a)*d, life:600, type:'mine', dmg:p.dmg*0.3}); }
    }
    /* 法塔命中后的词条反应：电弧弹射/磁极吸引 */
    function magicAffixHit(p) {
        if (ACTIVE_AFFIXES.m1) { let last = monsters.find(mo => mo.hp > 0 && Math.hypot(mo.x-p.x, mo.y-p.y) < 25); if (last) { let bounced = [last]; for (let b=0; b<2; b++) { let next = monsters.find(mo => !bounced.includes(mo) && mo.hp > 0 && Math.hypot(mo.x-last.x, mo.y-last.y) < 120); if (!next) break; dealDamage(next, p.dmg*0.36, 'magic', 'magic'); spawnParticles(next.x, next.y, '#fbbf24'); bounced.push(next); last = next; } } }
        if (ACTIVE_AFFIXES.m4) { let near = monsters.filter(mo => mo.hp > 0 && Math.hypot(mo.x-p.x, mo.y-p.y) < 100).slice(0,2); if (near.length === 2) { let cx = (near[0].x+near[1].x)/2, cy = (near[0].y+near[1].y)/2; near.forEach(mo => { mo.x += (cx-mo.x)*0.3; mo.y += (cy-mo.y)*0.3; repath(mo); }); } }
    }
    /* ---- 弹道更新 ---- */
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        if (p.target === 'fogZone' && (!p.fogZoneRef || p.fogZoneRef.hp <= 0)) { projectiles.splice(i, 1); continue; }
        p.x += p.vx * dtScale; p.y += p.vy * dtScale; p.life -= dtScale;
        let hitM = null;
        for (let j = 0; j < monsters.length; j++) {
            let m = monsters[j];
            if (isVisible(m.x, m.y) && m.hp > 0 && Math.hypot(p.x-m.x, p.y-m.y) < 25) { hitM = m; break; }
        }
        let hitFog = (p.target === 'fogZone' && p.fogZoneRef?.hp > 0 && Math.hypot(p.x-p.fogZoneRef.x, p.y-p.fogZoneRef.y) < 32) ? p.fogZoneRef : null;
        if (!hitM && !hitFog) { if (p.life <= 0) projectiles.splice(i, 1); continue; }
        if (hitM) dealDamage(hitM, p.dmg, p.towerId === 'magic' ? 'magic' : 'physical', p.towerId);
        if (hitFog) damageFogZone(hitFog, p.dmg);
        if (p.towerId === 'cannon' && p.aoeRadius > 0) {
            monsters.forEach(mo => { if (mo !== hitM && mo.hp > 0 && isVisible(mo.x, mo.y) && Math.hypot(mo.x-p.x, mo.y-p.y) < p.aoeRadius) { dealDamage(mo, p.dmg*0.6, 'physical', 'cannon'); spawnParticles(mo.x, mo.y, '#f59e0b'); } });
            fogZones.forEach(fz => { if (fz !== hitFog && fz.hp > 0) { let halfS = fz.size*CELL_SIZE/2, dx = Math.max(Math.abs(p.x-fz.x)-halfS, 0), dy = Math.max(Math.abs(p.y-fz.y)-halfS, 0); if (Math.hypot(dx, dy) < p.aoeRadius) { damageFogZone(fz, p.dmg*0.6); spawnParticles(fz.x, fz.y, '#f59e0b'); } } });
            spawnParticles(p.x, p.y, '#f59e0b');
        }
        if (hitM) {
            if (p.towerId === 'arrow' && ACTIVE_AFFIXES.a3) hitM.tornMark = true;
            if (p.towerId === 'cannon' && hitM.tornMark && ACTIVE_AFFIXES.a3) { dealDamage(hitM, p.dmg*0.3, 'physical', 'cannon'); hitM.tornMark = false; }
            if (p.towerId === 'arrow' && ACTIVE_AFFIXES.a4 && hitM.hp > 0) { let link = monsters.find(mo => mo !== hitM && mo.hp > 0 && Math.hypot(mo.x-hitM.x, mo.y-hitM.y) < 100); if (link) { dealDamage(link, p.dmg*0.18, 'physical', 'arrow'); spawnParticles((hitM.x+link.x)/2, (hitM.y+link.y)/2, '#6366f1'); for (let pi=0; pi<3; pi++) { let t = pi/3; particles.push({x:hitM.x+(link.x-hitM.x)*t, y:hitM.y+(link.y-hitM.y)*t, vx:0, vy:0, life:10, color:'#6366f1', size:2}); } } }
        }
        if (p.towerId === 'cannon') cannonAffixHit(p);
        if (p.towerId === 'magic') magicAffixHit(p);
        projectiles.splice(i, 1);
    }
    /* ---- 塔索敌与开火 ---- */
    let heroCX = HERO_COL * CELL_SIZE + CELL_SIZE/2, heroCY = HERO_ROW * CELL_SIZE + CELL_SIZE/2;
    towers.forEach(t => {
        if (t.cooldown > 0) t.cooldown -= dtScale;
        let rateMult = (t.id === 'magic' && ACTIVE_AFFIXES.m5 > 0 && t.lastTarget) ? 1 + Math.min(5, t.comboStacks||0) * 0.07 : 1;
        if (t.cooldown > 0) {
            if (t.id === 'cannon' && ACTIVE_AFFIXES.c5 > 0) t.idleTime = (t.idleTime||0) + dtScale;
            return;
        }
        let eff = getTowerEffStats(t);
        let effRange = eff.range * (t.id === 'ice' && ACTIVE_AFFIXES.i4 > 0 ? 1 + 0.09 * ACTIVE_AFFIXES.i4 : 1);
        let inRange = monsters.filter(m => m.hp > 0 && isVisible(m.x, m.y) && Math.hypot(m.x-t.x, m.y-t.y) <= effRange);
        let fogDist = (fz) => { let halfS = fz.size * CELL_SIZE / 2; return Math.hypot(fz.x-t.x, fz.y-t.y) - halfS; };
        let fogTargets = fogZones.filter(fz => fz.hp > 0 && fogDist(fz) <= effRange);
        let aim = null;
        let lockedFog = (lockedFogZone && lockedFogZone.hp > 0 && fogDist(lockedFogZone) <= effRange) ? lockedFogZone : null;
        if (lockedFog) aim = { x: lockedFog.x, y: lockedFog.y, fog: lockedFog };
        else if (inRange.length > 0) { let tgt = inRange.reduce((b, m) => { let d = Math.hypot(m.x-heroCX, m.y-heroCY); return !b || d < b.d ? {m, d} : b; }, null).m; aim = { x: tgt.x, y: tgt.y, fog: null, m: tgt }; }
        else if (fogTargets.length > 0) { let fz = fogTargets.reduce((b, f) => { let d = Math.hypot(f.x-t.x, f.y-t.y); return !b || d < b.d ? {f, d} : b; }, null).f; aim = { x: fz.x, y: fz.y, fog: fz }; }
        if (!aim) return;
        t.cooldown = 60 / (eff.rate * rateMult);
        if (t.id === 'ice') {
            temporaryGroundEffects.push({x:t.x, y:t.y, life:20, type:'icering', radius:effRange});
            inRange.forEach(m => {
                dealDamage(m, eff.atk, 'magic', 'ice');
                m.slowT = Math.max(m.slowT, 120);
                if (ACTIVE_AFFIXES.i1 && Math.random() < 0.15) { m.freezeT = Math.max(m.freezeT, 45); spawnParticles(m.x, m.y, '#3b82f6'); }
                if (ACTIVE_AFFIXES.i2 && m.freezeT > 0) { monsters.forEach(o => { if (o.hp > 0) o.slowT = Math.max(o.slowT, 54); }); spawnParticles(m.x, m.y, '#06b6d4'); }
                if (ACTIVE_AFFIXES.i3 > 0) temporaryGroundEffects.push({x:m.x, y:m.y, life:36*ACTIVE_AFFIXES.i3, type:'frost'});
            });
            fogTargets.forEach(fz => damageFogZone(fz, eff.atk));
        } else {
            let dx = aim.x - t.x, dy = aim.y - t.y, len = Math.hypot(dx, dy) || 1, aoeR = t.id === 'cannon' ? 55 : 0;
            let mkProj = (vx, vy) => projectiles.push({x:t.x, y:t.y, vx, vy, dmg:eff.atk, towerId:t.id, life:120, target:aim.fog ? 'fogZone' : 'monster', fogZoneRef:aim.fog, aoeRadius:aoeR});
            if (t.id === 'arrow' && ACTIVE_AFFIXES.a1) { for (let k=-1; k<=1; k++) { let a = Math.atan2(dy, dx) + k*0.25; mkProj(Math.cos(a)*9, Math.sin(a)*9); } }
            else mkProj((dx/len)*9, (dy/len)*9);
            if (t.id === 'cannon' && ACTIVE_AFFIXES.c5 > 0 && (t.idleTime||0) > 180) { let p = projectiles[projectiles.length-1]; if (p) p.dmg *= 1.5; }
            if (aim.m && t.id === 'magic' && ACTIVE_AFFIXES.m5 > 0) { t.lastTarget = (t.lastTarget === aim.m.id) ? (t.comboStacks = Math.min(5, (t.comboStacks||0)+1), aim.m.id) : (t.comboStacks = 1, aim.m.id); }
            if (aim.m && t.id === 'arrow' && ACTIVE_AFFIXES.a5 > 0) { t.attackCount = (t.attackCount||0)+1; if (t.attackCount >= 8) { t.attackCount = 0; inRange.slice(0,5).forEach(tg => { let ddx=tg.x-t.x, ddy=tg.y-t.y, ll=Math.hypot(ddx,ddy)||1; projectiles.push({x:t.x, y:t.y-60, vx:(ddx/ll)*12, vy:(ddy/ll)*12, dmg:eff.atk*0.6, towerId:'arrow', life:90, target:'monster', aoeRadius:0}); }); } }
        }
        if (t.id === 'cannon' && ACTIVE_AFFIXES.c5 > 0) t.idleTime = 0;
    });
    let gameRunning = DOM.gameOverlay.style.display === 'none';
    /* ---- 清理已破迷雾 ---- */
    if (fogZones.some(fz => fz.hp <= 0)) fogZones = fogZones.filter(fz => fz.hp > 0);
    let hX = HERO_COL * CELL_SIZE + CELL_SIZE/2;
    let hY = HERO_ROW * CELL_SIZE + CELL_SIZE/2;
    /* ---- 地面效果更新（火带灼烧 / 地雷触发） ---- */
    for (let gi = temporaryGroundEffects.length - 1; gi >= 0; gi--) {
        let ge = temporaryGroundEffects[gi];
        ge.life -= dtScale;
        if (ge.type === 'fire') {
            monsters.forEach(mo => {
                if (mo.hp > 0 && Math.hypot(mo.x-ge.x, mo.y-ge.y) < 40) {
                    mo.hp -= ge.dmg * dtScale;
                    if (Math.random() < 0.1) spawnParticles(mo.x, mo.y, '#f97316');
                    if (mo.hp <= 0) killMonster(mo);
                }
            });
        } else if (ge.type === 'mine') {
            let trig = monsters.find(mo => mo.hp > 0 && Math.hypot(mo.x-ge.x, mo.y-ge.y) < 25);
            if (trig) {
                trig.freezeT = Math.max(trig.freezeT, 40);
                dealDamage(trig, ge.dmg, 'physical', 'cannon');
                spawnParticles(ge.x, ge.y, '#f59e0b');
                ge.life = 0;
            }
        }
        if (ge.life <= 0) temporaryGroundEffects.splice(gi, 1);
    }
    /* ---- 怪物更新：攻城 / 冰冻减速 / 迷雾潜行加速 / 沿路径移动 ---- */
    for (let i = monsters.length - 1; i >= 0; i--) {
        let m = monsters[i];
        if (m.hp <= 0) { monsters.splice(i, 1); continue; }
        let { r: cr, c: cc } = cellOf(m.x, m.y);
        if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS && vis[cr][cc]) m.visibleOnce = true;
        if (Math.hypot(hX - m.x, hY - m.y) <= m.range * CELL_SIZE) {
            m.atkCd -= dtScale;
            if (m.atkCd <= 0) {
                m.atkCd = 60 / m.asp;
                hp -= m.atk; updateHUD();
                spawnParticles(m.x, hY, '#f97316');
                if (hp <= 0) {
                    if (DOM.gameOverlay) { DOM.gameOverlay.style.display = 'flex'; DOM.gameOverlay.querySelector('h1').textContent = "守护防线被突破"; }
                    gameTimeScale = 0;
                }
            }
        } else {
            let spdMult = 1;
            if (m.freezeT > 0) { m.freezeT -= dtScale; spdMult = 0; }
            else if (m.slowT > 0) { m.slowT -= dtScale; spdMult = 0.4; }
            temporaryGroundEffects.forEach(ge => {
                if (ge.type === 'frost' && Math.hypot(m.x-ge.x, m.y-ge.y) < 40) spdMult *= 0.5;
            });
            let inFog = cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS && !vis[cr][cc];
            if (inFog) spdMult *= 2;
            let effSpd = m.speed * spdMult;
            if (effSpd > 0 && m.activePath && m.pathIndex < m.activePath.length) {
                let node = m.activePath[m.pathIndex];
                let dx = node.c * CELL_SIZE + CELL_SIZE/2 - m.x;
                let dy = node.r * CELL_SIZE + CELL_SIZE/2 - m.y;
                let dist = Math.hypot(dx, dy);
                if (dist < effSpd * dtScale) { m.x += dx; m.y += dy; m.pathIndex++; }
                else { m.x += (dx/dist)*effSpd*dtScale; m.y += (dy/dist)*effSpd*dtScale; }
            } else if (cr >= 0 && m.freezeT <= 0) {
                m.activePath = findAStarPath(cr, cc); m.pathIndex = 0;
            }
        }
    }
    /* ---- 波次调度：出怪间隔与波间倒计时 ---- */
    if (waveMonsterQueue.length > 0) {
        waveSpawnTimer -= dtScale;
        if (waveSpawnTimer <= 0) {
            spawnMonster(waveMonsterQueue.shift());
            waveSpawnTimer = 90;
            if (waveMonsterQueue.length === 0) waveIntervalTimer = 10 * 60;
        }
    } else if (waveIntervalTimer > 0) {
        waveIntervalTimer -= dtScale;
        if (monsters.length === 0) {
            waveIntervalTimer = 0;
            wave++; updateHUD(); startWave();
        } else {
            document.getElementById('wave-val').textContent = `下波: ${Math.ceil(waveIntervalTimer/60)}s`;
            if (waveIntervalTimer <= 0) { wave++; updateHUD(); startWave(); }
        }
    }
    /* ---- 粒子与飘字更新 ---- */
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.life -= dtScale;
        if (p.type === 'text') p.y -= 1.5 * dtScale;
        else { p.x += p.vx * dtScale; p.y += p.vy * dtScale; }
        if (p.life <= 0) particles.splice(i, 1);
    }
}
