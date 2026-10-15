# 任务：发布会话页吸收适配页 + 主页瘦身（2026-10-15）

用户拍板（grill-me 全默认 + 「2 是，同时需要能够补齐媒体」）：
1. 方案卡挪进对话流内（不再聊天框外独立区块）；点卡片=生成该平台**方案**（非直接出稿）
2. 方案确定后聊天内问「是否生成」（按钮：生成/调整），点了才生成出稿
3. 右栏产物区显示出稿 + 吸收适配页功能（媒体补齐=上传、封面、批准、发布到平台）
4. /publish/variants 适配页删除
5. 主页 /publish：a. 去「去适配」、排版整理；b. 每条可删除 + 状态显示；c. 每条只留「发布」按钮=进聊天页

## 步骤

- [x] worker runPlanSession 加 focus 参数（指定模板→只出 1 个该平台方案）+ /session/plan 路由透传
- [x] easelApi.plan 加 focus；模板卡点击→plan(turn, focus)
- [x] EaselShell：①卡挪进对话流（开屏=助手引导气泡内嵌 3 张模板卡）②方案确认=聊天内「生成/调整」按钮（去上一轮自动出稿）③右栏加「适配版」区：状态/媒体上传/封面/批准并发布/job 轮询；post DTO（mediaPaths+variants+job）进 props
- [x] 主页：去去适配链接、每行删「适配」留「发布」、加删除按钮（新 client 组件）、文案/排版整理
- [x] API：DELETE /api/publish/posts/[id]（DB 级联 variants/job/logs）
- [x] 删 /publish/variants 页；检查 schedule-board 对 variant-cards 的依赖
- [x] tsc + eslint + npm run check；worker 重启后冒烟 plan focus=1

## 坑

- worker tsx 非 watch：改完 kill + 重启 :3022，sleep 3 再 curl
- react-hooks 编译器拒 effect 引用后置 useCallback；tsc2448 声明顺序坑
- `pkill -f "next dev"` 会连用户正在用的 dev 一起杀（2026-10-15 误杀 :3005，重起在 :3000）；起 dev 前先 `lsof -ti:3000/3005` 探活

## 第三轮（2026-10-15 02:xx 用户四条 + 全默认）

- [x] 删除/重置确认=自定义 ConfirmDialog（弃 window.confirm；主页+侧栏统一）
- [x] 3 卡对齐：等高+文案精简+按钮贴底（plan-grid flex 布局）
- [x] 流式过程：worker SSE（delta/done）+ API 透传 + 前端逐字进气泡（方案/生成两路都流式）
- [x] 右栏：方案卡不进产物栏；出稿卡直接「发布」（/api/publish/publish 一键 upsert+APPROVED+job）；弃采纳/批准环节；媒体缺=禁用+红字
- [x] 真凶 C：删污染留痕文件 + prompt 护栏（planner 禁写文件）
- 验证：SSE 冒烟 ✓（delta 逐字→done）；tsc/eslint/check 全绿；浏览器未验（dev :3000 已起，用户自测）
- 坑：后台 pi 带仓库 AGENTS.md 上下文=记忆/留痕污染风险（planner 真写过 记忆增量 文件，日期编造）；长期考虑 pi 隔离 cwd

## 第四轮（2026-10-15 03:xx 用户 6 条问题 + browser-skill 自测；指令：真发布不测，媒体补齐过审核即可）

- [x] 1 两个会话：ensureChat 模块级 in-flight 去重 + 合并规则「优先有内容的」（worker hasContent）
- [x] 2 问答无过程：SSE 工具动作行（→ 执行 read：…）+ 基线/文件切换防回放
- [x] 3 产物页=直接发布内容预览（标题/正文/标签/封面分区+缩略图+补传），去备注/去平台适配版区
- [x] 4 二次进入不一致：合并规则 + readChatHistory 合并 plan-sessions + writeChatMeta 回填 firstAsk
- [x] 5 把所有技能都显示出来：listSkills 全库 114（去首批白名单），测试改别名表口径
- [x] 6 browser-skill 自测循环：主页✓ 会话✓ 删除弹框✓ 二次进入✓ 流式✓ 技能菜单✓ 媒体预览✓；bsk 补传被 Chrome 文件权限拦→落盘+PATCH 验证（未点真发布）
- 验证：npm run check 219/219；dev :3000 / worker :3022 活
- 明早验收备注：若要用 UI 补传，需在 chrome://extensions 给 BrowserSkill 开「允许访问文件 URL」
