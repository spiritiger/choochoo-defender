# 项目记忆 · kuangdang-guard（哐当哐当守卫战）

> 长期结论索引。过程数据在 `docs/` 与 `.workbuddy/memory/YYYY-MM-DD.md`；这里只放"会咬人的"约定与不变量。

## ⛔ 铁律
1. **只有明确说「打包成单文件」才跑 `build_single.js`**；改完源码即停手，产物与源码不同步是允许状态。发布/部署/导出同理等下令。
2. **无 git/VCS**（唯一历史=`archive/` 快照）⇒ 废弃函数/资源**保留+注释**，不删（`__chevron_retired` 即此类）。
3. **不擅自改行为**：先结论+请拍板；改行为**必须先改 `docs/设计规格.md`**。
4. **「精简/优化」默认=不动行为** ⇒ 固定种子大批量逐盘 diff 证等价；动"并列解取舍顺序/环走向"先问。
5. **`node --check` 只查语法** ⇒ 必须真跑求解器+全套回归。

## 版本摘要
- v1.0 主解 mm=2+端头禁令；v1.1 起点全量 Bl；v1.2 ③兜底闸门；v1.3-rc 塔防（快照 `.workbuddy/archive/snapshot-v1.2-full-20260928/`）；v1.4.4~v1.5 见 2026-10-08/09 日志；v1.6 求解后台化+并行分片已落地（p90 -45%）；v1.6.7 种子盲区兜底；v1.6.8 列车射程 3.75→4.5（大王令）；**v1.6.9 补格 H 铺两层**（深腹地盲区修复：17:04 盘 rail(0) 被旧环沿用掩盖 → rail(40) 满覆盖；代价=难盘烧穿率 0.4%→9.4%，Worker 兜住，详见 2026-10-09 日志）；**v1.6.10 手牌直接合成**（英雄卡拖到同名 1 星塔=直接升星；虚源 c=-1 走同一 canMerge/merge 路径、`src.c>=0` 守卫跳 remove、LOG merge.from='hand'；⚠️ 勿另立第二套合成判据）；**v1.6.11 列车射程环改点选显示**（常驻退役：`UI.trainSel`+`UI.pickTrain` 最近单元 0.55 格命中；车头/车厢各画自己 RANGE；wagonPos 是浮点格坐标，点击换算必须走 CFG.ccx/ccy；**v1.6.13 定稿=长按显示、松手消失**，trainSel=按住态，onUp/onCancel 先清再结算）；**v1.6.12 金币格/废墟视觉重订**（大王令"金币格太像空地"：金色=金币格——埋着=废墟底+金裂纹+金框+**REND.coin 双层硬币**（v1.6.12b：重构曾把 rubble+gold 的金币图标弄丢，拆 if 前先枚举四态全集）、清出=空白底+金框+双层硬币、harvested 降淡；红色=废墟——红裂纹+斜纹；底色仍不叠黄 tint，v0.6.7 棕褐教训保留）。度4混合贴片刀系误诊已撤——**度数=不同口数非口次数**，"一直一弯"必度3 T岔。
- 满覆盖率口径：真实 93.6%~100%，**保守报 94%+**（老苛刻工装已删）。
- 单文件产物停在 v0.8.x，只在发布时重建。
- **白天卡顿定案（2026-10-09 解剖）**：最难盘 ~1s = NP-hard 失败证明的真实代价（L1 阶梯 851ms 全是"证明无解"+择优 519ms+⑤150ms）；2-core 必要条件预检已证伪（零误杀但判不死）；file:// 下源码四通道全拦，Worker 仅 http 可用（手机 OK、本地双击降级同步）。

## 技术形态
- **免构建**：`index.html` + 11 经典 script（CFG/GS/STATION/TOWERS/FOES/CLOCK/TRANS/ENG/REND/UI/LAY）+1 CSS。加载序=依赖序：config/map→state→station→towers→foes→clock→transport→engine→renderer→ui→main。
- 画布 390×844；地图 9×13；内区 3×5（列3-5/行4-8）；外圈 5×7；镇中心 (4,6)；尺寸走 `CFG.layout()` 别写死。
- `main.js` 需 DOM ⇒ Node 沙箱测试只到 `js/ui.js`；`test_rail` 沙箱只载 map/state/engine ⇒ 跨模块调用加 `typeof X!=='undefined'` 守卫。
- renderer 逐格贴片：**一条边要标两端格的方向集**；方向箭头已移除，pass 向量保留（喇叭口依赖）。

## ⭐ 三个量口径
步数=`railPath.length`（含重复）·格数=去重·十字=走≥2次的格。**步数≥格数；步数−格数=十字数**。测试术语"十字"≠渲染十字贴片（重走折返同边=T岔度3、走新边=十字度4）。

## 铁轨求解链
`floodU→thinNeck→keepCoreComponent→pruneU→normalize→boundaryOf→helpersOf→closedTrail→enclosesCore`（闭合迹围住镇中心）
- 上限：XMAX=6 / HMAX_CAP=16 / TOL_MAX=6 / RANK_CAP=19；SPUR_XMAX=8。主解两阶段：①定档爬补格阶梯→k* ②k* 档全起点择优（覆盖↑→十字↓→格数↓；**补格数不在序**，顺序不可颠倒）。
- **H 两层（v1.6.9）**：H1=邻 B；H2=非 B 非 H1 且邻「B∪H1」。⚠️ 第二轮**不能排除 H1 本体**——排除即环缺格断成树 ⇒ 端头禁令把 DFS 锁死在起点（实验期踩过）。
- 四级兜底（各级独立 freshBudget）：①容差阶梯→②快速兜底 150ms→③圈空间枚举（250 档内，与 DFS 双路择优）→④剥层。
- ⑤spurSolver：每边≤2次第2次反向；循环层级顺序不可换；`SPUR_BUDGET_MS=150` 硬闸。⑥trimDetours（三道闸，圈内只增不减）。⑦reweaveTwins（v1.4.9 相邻双十字重织）。
- 预算：主解节点 150 万+墙钟阶梯 **700ms（别再往下调）**；快速档 `railFast=90ms`（预览用，跳②⑤⑥⑦）；v1.5 ②择优早停双闸 `bestCross===0&&bestCover>=Bl.length`。
- 节奏刷怪：`FOES.pending+spawnCd+spawnOne`；**v1.6.16 定稿=固定批数+固定时长**：`BURSTS=6` 批/波 × `BURST_GAP=3.6s` ⇒ 总刷怪时长恒 18s；每批 = ceil(count/6)=2w+4 恒满额；spawn 计时块排在 `!foes.length` 早退**之前**；cd 溢出保留（CFG.gap 已无消费者，历史参数）。
- 数值终态（v1.6.14 大王五连令）：count `24+12w`、hp `4+8w`（w1=12=车头一刀/w2 起两刀，起点 4 保口径）、speed `min(0.5,.2+.01w)`（v1.6.18 大王定案，封顶 w30 才触）、dmg **1**、车头 `8+4w`、车厢 `×star`、`drawCost=10+10×drawCount`（v1.6.15 大王令，开局 30 金币恰抽 2 次）、`CORE_HP=100`。

## ⚠️ 别动清单（拆了出事）
- spurSolver 铁闸 `if(st.cov<=cov0)continue` 不可拆（拆了低覆盖脏解顶掉主解）。
- 桥边约束：重数 2 边必须是割边（Tarjan, mm=2）；预计算块别引用后面才赋值的 var。
- 圈空间枚举必须真异或（置 1 置 0 退化成并集⇒走出"路"非"环"）。
- finalRing 反缩水：沿用旧环条件=**覆盖格数≥新解**（不是环长）。
- 几何铁律：单格脖子半岛永远围不进环；thinNeck 截肢是正确行为。
- closedTrail 里 `budget.left=left` 写回不能删。零拐弯与大环互斥（≤36 格）；直行优先两处。
- 洞冻结 bug（v0.7.1）两修法已否决；thinNeck 扩"桥边截肢"等拍板（0721 盘）。

## 真实瓶颈（2026-09-28 定案）
- 主矛盾=主解缺往返自由度 ⇒ mm=2 已落地（满覆盖 75.8%→93.6%、中位 166→19ms）。
- **已证伪**：扩搜索空间（HMAX 32/48）满覆盖反降 70%；加预算 ×13 仅 +6.4pp 耗时 ×3.8。瓶颈是自由度不是搜索能力；min-cut/T-join 不推荐（目标函数不匹配、割集未必连通曲线）。真时钟下结果确定。

## 开局与经济
- 开局 3×5 无障碍；外圈 5×7 全障碍；开局铁轨 12 格小环；`GOLD_TILES=14` 金币地块**初始即障碍**（placeGoldInit 只置 gold 不动 t）。
- 驶入 +5→`train.cargo`→到站 deliver；harvested 防双计；金币格在轨上/圈内算区域、荒野不算。
- 清理形状须与区域 ≥1 格相接或压内区；越界忽略+**居中锚定**（`ENG.shapeAnchor`，三处同走一函数）；三选一去重=尺寸家族+经济卡≤1（别用拒绝采样）。
- 站台/昼夜：`STATION.solve` 由 recomputeRails 尾调（**两条 return 路径都调**）；day/night/dusk 三相位；判"回到站台**下标**"非踩站台格；advanceTrain 先 serviceCell 再判到站。

## 文档与调试
- `设计规格.md` 权威；`铁轨bug诊断-001.md` 实验数据；`轨道用例-001.md` 黄金用例；**`求解链病灶档案.md`（2026-10-09 建）= 四族 14 条病历 + 已证伪 7 条 + 待解清单——重构前必读**。诊断脚本一律 `%TEMP%/<项目>-run/`，跑完删。
- 地图导出通道=剪贴板 ASCII，报 bug 贴文本程序重放，别解析截图。
- 回归：test_rail 63 + test_rules 40 + test_tower 113 + test_build（v1.6.10 基线全绿）；test_rules 载 map/state/station/clock/engine；test_tower 沙箱不含 ui/renderer（交互逻辑进 towers 才可测）；[60]=H 两层盲区盘锁测试（T→E 占位手法）、[120-126]=手牌直接合成。
- 用例先改地形后挑样本；断言口径选玩家关心的量。

## 🔬 方法论（详见技能 ab-experiment-prove-refactor-safe）
1. 采样证存在、穷举证不存在；A/B 先掐旁路；必加去约束对照。
2. 性能对照**自造固定种子盘**（连 `GS.newGame()` 都不能用——Math.random 分叉）；记与求解无关的地形指纹。
3. 必须报被测分支覆盖率。4. 探针字段每样本前 `=null`；互补统计相加 100% 自检。
5. 大批量 A/B 用真时钟；关墙钟样本要小；脚本边跑边 print。6. 别用单字母 L 同当日志和环长。
7. 测试抄实现比没测试更坏；同一判据两条路径，最危险"改 A 忘 B"。
- 零行为变更验证：双沙箱 vm×固定种子盘比对外露产物；别用 debugNoDeadline 跑大样本→用假时钟。

## 环境坑（本机）
- Bash 首选；cmd /c 被拦；PS stdout 会吞 ⇒ node 自己 `fs.writeFileSync` 再 Read；Set-Content UTF8 加 BOM ⇒ WriteAllText+UTF8Encoding($false)。
- index.html 是 CRLF（替换先探测 EOL）；node 脚本挂 uncaughtException 兜底写日志；递归 readdirSync+动态 RegExp 会被安全策略拦 ⇒ 落成 .js 跑。

## 与大王协作
- 简洁利落、结论先行、带数据；改行为先翻规格；不擅自改代码/收尾动作；解释通俗+配图；交付用 present_files；实测优先。
- 口癖：接指令「**好的大王**」；拍板「**请大王定夺**」；坏消息「**不瞒大王**」。
