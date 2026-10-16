/* ============================================================
 * config.js — 静态游戏配置
 * 数据来源：src/data/*.json（构建时内联注入 window.__GameData__）
 * 改数值请改 JSON 文件，改完跑 node build.js
 * ============================================================ */

const GAMEDATA = window.__GameData__;

/* ---- 网格与战场结构（data/grid.json） ---- */
const COLS = GAMEDATA.grid.cols;
const ROWS = GAMEDATA.grid.rows;
const CELL_SIZE = GAMEDATA.grid.cellSize;
const HERO_ROW = GAMEDATA.grid.heroRow;
const HERO_COL = GAMEDATA.grid.heroCol;

/* ---- 防御塔静态数据（data/towers.json） ---- */
const TOWER_TYPES = GAMEDATA.towers;

/* ---- 怪物静态数据（data/monsters.json） ---- */
const MONSTER_TYPES = GAMEDATA.monsters;

/* ---- 词条静态描述（data/affixes.json） ---- */
const AFFIX_DATA = GAMEDATA.affixes;
