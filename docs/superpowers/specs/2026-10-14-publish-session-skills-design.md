# 发布会话 + 技能工作流（对齐 Easel 会话驱动形态）设计 spec

> 2026-10-14 · 分支 selbylei/workbench · 拍板记录：并存（表单保留为快通道）/ 首批 5 技能 / Post 级会话

## 1. 背景与定位

P1 交付的是「表单驱动」发布链（内容→Variant→批准→排期）。Easel 的真实形态是**会话驱动**：
一个发布会话里，选完题后**选技能（=选工作流）**，agent 按 SKILL.md 步骤出稿。本 spec 把该层
补上，与表单**并存**：表单 = 30 秒快通道；会话 = 深度工作流（视频/卡片/长文等形式由技能自带）。

Easel 对齐点：「每个发布一个聊天会话」+「选完题能选技能对应一个工作流」。

## 2. 数据与依赖

- **Conversation**：新 surface 取值 `publish`，`refId = Post.id`（Post 级会话，一篇内容一个会话，
  多平台适配在同一会话内完成——符合「一稿多发」意图）。conversation.surface 是自由 String，
  仅 UPDATE 现有口径注释，**无 schema 变更**
- **技能源**：vendor 5 个 Easel SKILL.md（Apache-2.0）到 `server/publish/skills/`（+ATTRIBUTION）：
  `xhs-note-creator`（小红书笔记）/ `skill-douyin-upload`（抖音，含视频+图文分路）/
  `card-xiaohongshu`（卡片图文）/ `copywriting`（文案）/ `post-formatter`（格式适配）
- **产物目录**：`data/publish/drafts/<sessionId>/<技能slug>.json`（gitignore data/publish/ 已覆盖）

## 3. 会话流程（UI：内容页「会话创作」→ /publish/session/<postId>）

```
[Post 源内容(标题/正文/媒体)]
   ↓ 会话首步：选技能卡片（5 选 1，展示技能名+适用形式+一句话说明）
   ↓ 「开始工作流」= POST /api/publish/session/run
       worker spawn pi（--tools read/write，session-dir 隔离，cwd=仓库根）
       prompt = 源内容 + 技能 SKILL.md 全文 + 平台约束(format-check LIMITS)
                + 产物契约：按 SKILL 步骤执行，最终把各平台稿写进 drafts/<sid>/<slug>.json
   ↓ 流式展示 agent 执行过程（复用 /api/ai 的流式面板组件形态；MVP 可先轮询 pi session jsonl 尾部）
   ↓ 出稿卡：JSON 里每平台 {title, body, tags, format, media?} → 「采纳」
   ↓ 采纳 = 对每个平台写 Variant（已有 → 409/422 走既有闸；format=VIDEO 时校验媒体是视频文件）
   ↓ 之后走既有批准闸 + 排期发布（worker 按 variant.format 分路 publish / publish-video）
```

## 4. 改动清单（模块级）

| 模块 | 改动 | 风险 |
|---|---|---|
| `PostVariant.format` | 新列 String?（IMAGE_TEXT/VIDEO，默认 IMAGE_TEXT；旧数据=图文零风险）+ SQL 迁移 | 低 |
| `GET /api/publish/skills` | 读 server/publish/skills/* 列表（name/desc/形式） | 低 |
| `POST /api/publish/session/run` | 鉴权+域隔离 → worker `POST /publish-run`：pi 带 read/write 工具执行技能工作流，300s 上限 | 中（工具面最小化：仅读 skills 目录+写 drafts） |
| `/publish/session/[postId]` | 会话页：技能选择 → 执行态（流/轮询）→ 出稿卡（多平台草稿）→ 采纳 | 中 |
| variant 格式闸 | VIDEO 变体：媒体需 ≥1 个视频文件（mp4/mov）；IMAGE_TEXT：≥1 图（现闸不变） | 低 |
| worker 发布分路 | contentArgs 按 variant.format：IMAGE_TEXT→`publish --images` / VIDEO→`publish-video --video` | 中 |
| 内容页入口 | 卡片加「会话创作」按钮（与「拉热点/阅读导入」并存） | 低 |

## 5. 明确不做（YAGNI / P2）

- 长文（GZH 官方 API 未接，会话出 GZH 稿也只能 FAILED，不出 GZH 稿）
- 技能流式 token 级展示（MVP 用 3s 轮询 pi session 尾部展示步骤进度；真流式留 P2）
- 技能市场/自定义技能（vendor 5 个定版；新增 = 加文件即可，接口不锁死）
- 视频上传体积/转码（P2）

## 6. 验收

1. 热点收藏一条 → 内容页「会话创作」→ 选「抖音视频脚本」→ 执行完成出稿卡
2. 采纳 → 视频 Variant 建好（format=VIDEO），传视频文件后格式校验通过
3. 批准发布 → worker 走 `publish-video --video`（日志可对）
4. 表单通道不受影响（图文快通道照旧）
5. `npm run check` 全绿
