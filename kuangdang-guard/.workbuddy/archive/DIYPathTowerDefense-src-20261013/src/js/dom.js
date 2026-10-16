/* ============================================================
 * dom.js — DOM / Canvas 基础设施与通用坐标工具
 * 必须最先加载（其他模块依赖 canvas 与 DOM 缓存）
 * ============================================================ */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

/** 统一提取鼠标/触摸事件的客户端坐标 */
function getCoord(e) {
    let t = e.touches && e.touches[0] || e.changedTouches && e.changedTouches[0];
    return { x: e.clientX || (t && t.clientX) || 0, y: e.clientY || (t && t.clientY) || 0 };
}

/** 将像素坐标换算为所在网格单元格 */
function cellOf(x, y) { return { r: Math.floor(y / CELL_SIZE), c: Math.floor(x / CELL_SIZE) }; }

/** 缓存常用 DOM 元素（id 下划线转驼峰，如 hp-val → hpVal） */
const DOM = {};
['hp-val','gold-val','cost-tower-val','cost-affix-val','hand-count','game-overlay','toast-msg','toast-text','speed-btn','hand-cards-container'].forEach(id => {
    let el = document.getElementById(id); if (el) DOM[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = el;
});
