/* ============================================================
 * state.js — 全局可变游戏状态（单例，跨模块共享）
 * 只存放运行时会变化的数据；静态配置见 config.js
 * ============================================================ */

/* ---- 经济与进程 ---- */
let gold = 100;
let hp = 500;
let wave = 1;

/* ---- 时间与倍速 ---- */
let gameTimeScale = 1.0;
let speedMultiplier = 1;
let isPaused = false;

/* ---- 招募/研习计数（驱动价格成长） ---- */
let g_towerDrawCount = 0;
let g_affixDrawCount = 0;

/* ---- 实体容器 ---- */
let obstacles = [];               // 静态障碍物
let towers = [];                  // 场上防御塔
let monsters = [];                // 场上怪物
let projectiles = [];             // 飞行弹道
let particles = [];               // 粒子与飘字特效
let temporaryGroundEffects = [];  // 临时地面效果（火带/地雷/霜痕/冰环）
let fogZones = [];                // 迷雾区域
let lockedFogZone = null;         // 被锁定的优先攻击迷雾
let _visCache = null;             // 可见性矩阵缓存

/* ---- 手牌与拖拽交互 ---- */
let handTowers = [];              // 手牌中的塔
let activeDragIndex = -1;         // 正在拖拽的手牌索引
let isDragging = false;
let touchX = 0, touchY = 0;       // 画布坐标系下的指针位置
let hoverGrid = null;             // 拖拽悬停的目标格
let isCodexExpanded = false;
let draggedFieldTower = null;     // 拖拽场上的塔（预留）
let mergeTarget = null;           // 合成升级目标塔
let selectedTower = null;         // 当前选中查看的塔
let simulatedPath = null;         // 拖拽预览用的模拟路径
let simulatedPathValid = false;
let handCardMouseDownInfo = null; // 手牌按下信息（区分点击与拖拽）
let dragStartInfo = null;         // 场上拖拽起点信息（区分点击与拖拽）

/* ---- 波次调度 ---- */
let waveMonsterQueue = [];
let waveSpawnTimer = 0;
let waveIntervalTimer = 0;

/* ---- 词条激活状态（值类型有含义：false/true 开关，number 为等级） ---- */
const ACTIVE_AFFIXES = { a1: false, a2: 0, a3: false, a4: false, a5: 0, c1: 0, c2: false, c3: false, c4: false, c5: 0, m1: false, m2: 0, m3: false, m4: false, m5: 0, i1: false, i2: false, i3: 0, i4: 0, i5: false };
const INITIAL_AFFIXES = JSON.parse(JSON.stringify(ACTIVE_AFFIXES));

/* ---- 塔等级上限 ---- */
const MAX_TOWER_LEVEL = 5;
