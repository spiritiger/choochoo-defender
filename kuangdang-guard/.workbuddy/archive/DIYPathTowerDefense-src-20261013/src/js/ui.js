/* ============================================================
 * ui.js — 界面层
 * Toast 提示、HUD 数值、手牌渲染、塔信息面板、
 * 词条三选一弹窗、全局强化图鉴
 * ============================================================ */

/** 顶部悬浮提示（2.2 秒后淡出） */
function triggerToast(msg) {
    if (DOM.toastText) DOM.toastText.textContent = msg;
    if (DOM.toastMsg) {
        DOM.toastMsg.style.opacity = '100';
        setTimeout(() => { DOM.toastMsg.style.opacity = '0'; }, 2200);
    }
}

/** 刷新 HUD 数值与招募/研习价格 */
function updateHUD() {
    if (DOM.hpVal) DOM.hpVal.textContent = hp;
    if (DOM.goldVal) DOM.goldVal.textContent = gold;
    if (DOM.costTowerVal) DOM.costTowerVal.textContent = 10 + 10 * g_towerDrawCount;
    if (DOM.costAffixVal) DOM.costAffixVal.textContent = Math.round(100 * Math.pow(1.3, g_affixDrawCount));
    if (DOM.handCount) DOM.handCount.textContent = `${handTowers.length}/5`;
    renderHandUI();
}

/** 渲染手牌卡片（带星级角标） */
function renderHandUI() {
    const container = document.getElementById('hand-cards-container');
    if (handTowers.length === 0) {
        container.innerHTML = `<div class="text-[9px] text-slate-400 col-span-5 text-center py-2.5">手牌为空，点击下方招募</div>`;
        return;
    }
    container.innerHTML = handTowers.map((tower, idx) => {
        const lvl = tower.level || 1;
        const lvlBadge = lvl > 1 ? `<span class="absolute top-0 right-0 text-[8px] font-bold text-amber-600 bg-amber-100 px-0.5 rounded-bl border-l border-b border-amber-200 leading-none">${'★'.repeat(lvl)}</span>` : '';
        return `
        <div class="hand-card bg-white border border-slate-200 hover:border-emerald-500 rounded-lg p-1 flex flex-col items-center justify-center text-center shadow-xs select-none h-[50px] overflow-hidden relative"
             onmousedown="onHandCardMouseDown(event, ${idx})" ontouchstart="onHandCardMouseDown(event, ${idx})">
            ${lvlBadge}
            <span class="text-base leading-none">${tower.emoji}</span>
            <span class="text-[8px] font-bold text-slate-700 mt-0.5 leading-none w-full whitespace-nowrap">${tower.name}</span>
        </div>`;
    }).join('');
}

/** 塔信息弹窗：属性、已激活词条、升级提示；打开时暂停战局 */
function showTowerInfo(t) {
    let eff = getTowerEffStats(t);
    let lvl = t.level || 1;
    let affixList = [];
    for (let k in AFFIX_DATA) {
        if (AFFIX_DATA[k].towerId === t.id && ACTIVE_AFFIXES[k]) {
            let lvl2 = typeof ACTIVE_AFFIXES[k] === 'number' ? ` <span class='text-amber-600 font-bold'>Lv${ACTIVE_AFFIXES[k]}</span>` : '';
            affixList.push(`<div class='bg-slate-50 rounded-md px-2 py-1 border border-slate-100'><div class='text-[10px] font-bold text-slate-700'>• ${AFFIX_DATA[k].name}${lvl2}</div><div class='text-[9px] text-slate-500 mt-0.5 leading-relaxed'>${AFFIX_DATA[k].desc}</div></div>`);
        }
    }
    if (affixList.length === 0) affixList.push(`<div class='text-[10px] text-slate-400 italic py-0.5 text-center'>暂无激活词条</div>`);
    let panel = document.getElementById('tower-info-panel');
    let stars = '★'.repeat(lvl) + '<span style="color:#cbd5e1">' + '★'.repeat(MAX_TOWER_LEVEL - lvl) + '</span>';
    let isFieldTower = towers.includes(t);
    let upgradeHint = isFieldTower && lvl < MAX_TOWER_LEVEL
        ? `<div class='text-[9px] text-amber-600 font-bold text-center mt-2 pt-2 border-t border-slate-100'>拖拽相同塔至此处可升至 ${lvl+1}★</div>`
        : (lvl >= MAX_TOWER_LEVEL ? `<div class='text-[9px] text-emerald-600 font-bold text-center mt-2 pt-2 border-t border-slate-100'>已达最高星级</div>` : '');
    panel.innerHTML = `
        <div class='bg-white rounded-xl shadow-2xl border border-slate-200 p-4 w-full max-w-xs' onclick='event.stopPropagation()'>
            <div class='flex items-center gap-2 mb-3 pb-2 border-b border-slate-100'>
                <span class='text-2xl'>${t.emoji}</span>
                <div>
                    <div class='text-sm font-black text-slate-800'>${t.name} <span class='text-amber-500 text-base'>${stars}</span></div>
                    <div class='text-[9px] text-slate-500'>${t.desc || ''}</div>
                </div>
                <button onclick='closeTowerInfo()' class='ml-auto text-slate-400 hover:text-slate-600 text-sm'><i class='fa-solid fa-xmark'></i></button>
            </div>
            <div class='grid grid-cols-3 gap-2 mb-3 text-center'>
                <div class='bg-slate-50 rounded-lg p-1.5'><div class='text-[8px] text-slate-400 uppercase'>攻击</div><div class='text-sm font-bold text-rose-600'>${eff.atk}</div></div>
                <div class='bg-slate-50 rounded-lg p-1.5'><div class='text-[8px] text-slate-400 uppercase'>射程</div><div class='text-sm font-bold text-sky-600'>${Math.round(eff.range)}</div></div>
                <div class='bg-slate-50 rounded-lg p-1.5'><div class='text-[8px] text-slate-400 uppercase'>攻速</div><div class='text-sm font-bold text-emerald-600'>${eff.rate.toFixed(1)}</div></div>
            </div>
            <div class='text-[9px] font-bold text-slate-500 uppercase mb-1'>已激活词条（${affixList.length > 1 ? affixList.length : 0}）</div>
            <div class='space-y-1 max-h-32 overflow-y-auto custom-scroll'>${affixList.join('')}</div>
            ${upgradeHint}
            <div class='text-[9px] text-slate-400 text-center mt-2 pt-2 border-t border-slate-100'>点击框外任意区域关闭</div>
        </div>`;
    panel.classList.remove('hidden');
    gameTimeScale = 0;
}

/** 关闭塔信息弹窗并恢复战局 */
function closeTowerInfo() {
    document.getElementById('tower-info-panel').classList.add('hidden');
    selectedTower = null;
    gameTimeScale = 1.0;
}

/**
 * 词条三选一弹窗
 * @param towerIdFilter 限定塔系（4 级觉醒的专属恩赐）
 * @param free 免费抽取（觉醒赠送，不扣宝石）
 */
function startAffixDraft(towerIdFilter = null, free = false) {
    if (!free) {
        const cost = Math.round(100 * Math.pow(1.3, g_affixDrawCount));
        if (gold < cost) return triggerToast("宝石能量不足！");
        gold -= cost; g_affixDrawCount++; updateHUD();
    }
    let avail = Object.keys(ACTIVE_AFFIXES).filter(k => {
        if (typeof ACTIVE_AFFIXES[k] === 'number' ? ACTIVE_AFFIXES[k] >= 5 : ACTIVE_AFFIXES[k]) return false;
        if (towerIdFilter && AFFIX_DATA[k].towerId !== towerIdFilter) return false;
        return true;
    });
    if (avail.length === 0) {
        if (towerIdFilter) return triggerToast("该塔系词条已全部习得！");
        return triggerToast("已习得全部全局强化！");
    }
    const picked = avail.sort(() => 0.5 - Math.random()).slice(0, 3);
    gameTimeScale = 0;
    const container = document.getElementById('draft-options-container');
    const titleEl = document.querySelector('#draft-modal h3');
    if (titleEl) {
        titleEl.textContent = free && towerIdFilter
            ? `🌟 ${TOWER_TYPES[towerIdFilter].emoji} 4级觉醒·专属恩赐`
            : '🔮 研习全新法术秘籍';
    }
    container.innerHTML = picked.map(key => {
        const item = AFFIX_DATA[key];
        return `
            <div onclick="selectAffix('${key}')" class="bg-slate-50 border border-slate-200 hover:border-indigo-400 p-2.5 rounded-xl cursor-pointer flex items-start gap-2">
                <span class="text-xl p-1 bg-white rounded shadow-xs">${TOWER_TYPES[item.towerId].emoji}</span>
                <div><div class="font-bold text-[11px] text-slate-800">${item.name}</div><p class="text-[9px] text-slate-500 mt-0.5">${item.desc}</p></div>
            </div>`;
    }).join('');
    document.getElementById('draft-modal').classList.remove('hidden');
}

/** 选择词条：布尔型点亮、数值型升级 */
function selectAffix(key) {
    if (typeof ACTIVE_AFFIXES[key] === 'number') ACTIVE_AFFIXES[key]++; else ACTIVE_AFFIXES[key] = true;
    document.getElementById('draft-modal').classList.add('hidden');
    gameTimeScale = 1.0;
    updateCodexUI(); updateHUD(); triggerToast(`习得【${AFFIX_DATA[key].name}】！`);
}

/** 展开/收起全局强化图鉴 */
function toggleCodex() {
    const p = document.getElementById('codex-panel'); const c = document.getElementById('codex-caret');
    isCodexExpanded = !isCodexExpanded;
    p.classList.toggle('hidden', !isCodexExpanded);
    c.className = isCodexExpanded ? "fa-solid fa-caret-down" : "fa-solid fa-caret-up transition-transform";
}

/** 重绘全局强化图鉴内容 */
function updateCodexUI() {
    const p = document.getElementById('codex-panel');
    let h = ''; let count = 0;
    for (let k in ACTIVE_AFFIXES) {
        if (ACTIVE_AFFIXES[k]) {
            count++;
            let info = AFFIX_DATA[k];
            let lvl = typeof ACTIVE_AFFIXES[k] === 'number' ? `(等级 ${ACTIVE_AFFIXES[k]})` : '';
            h += `<div class="py-1 border-b border-slate-100"><span class="font-bold text-indigo-600 text-[8px]">${info.name}${lvl}</span><span class="text-slate-500 text-[7px] block mt-0.5">${info.desc}</span></div>`;
        }
    }
    p.innerHTML = count === 0 ? `<div class="py-1 text-slate-400 italic text-center">暂未获得全局强化。</div>` : h;
}
