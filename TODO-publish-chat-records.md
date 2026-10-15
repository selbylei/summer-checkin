# 任务：发布会话面板改版（技能挪进 composer + 左栏=聊天记录 + 内容页「聊天发布」新增纪录）

开工 2026-10-14 20:58（接 01a13687 会话，用户原话：「技能怎么放置参考 easel 不要放左边；左边放聊天记录；内容点个聊天发布，新增一个聊天记录」）

## 方案（Easel 对齐）

- 布局：左=聊天记录列表（每帖多条，可「新纪录」）、中=对话、右=出稿卡
- 技能选择：从左栏挪到 composer 输入条上方（Easel BrushEntry 同款：按钮弹出技能面板，选中=定该纪录的工作流）
- 数据面（worker）：
  - 聊天记录=磁盘目录 `data/publish/drafts/<postId>/chats/<chatId>/`：`pi-sessions/`（pi 会话）+ `<skill>.json`（出稿）
  - `runSessionChat` 加 chatId（空则 worker 生成）；消息历史从 pi .jsonl 解析（user 文本 + assistant 文本块，跳 thinking/toolCall）
  - 新端点：GET /session-chats（列纪录：首条 user 消息截 24 字为标题）、GET /session-chat-history、/session-drafts 改 chatId 口径
- API 代理：session/chat 透传 chatId；新增 session/chats、session/history；drafts 加 chatId
- 前端：PublishSessionPanel 左栏改纪录列表（点纪录恢复消息+出稿卡，切纪录不丢在跑状态：per-chatId 消息 map）；composer 加技能面板按钮 + 选中 chip
- 内容列表：「会话创作」→「聊天发布」，href 加 `?new=1`（进页开新纪录）；session 页读 searchParams

## 里程碑

- [x] 摸清现状（panel / worker / api / Easel BrushEntry+Sidebar 参照）
- [x] worker：skill-run.ts 加 chat 目录布局 + listPostChats + readChatHistory + listChatDrafts；index.ts 端点
- [x] api 代理：chat/chats/history/drafts
- [x] 面板：左栏纪录列表 + composer 技能面板
- [x] 内容列表「聊天发布」+ session 页 ?new=1
- [x] `npm run check` 全绿 + 冒烟（worker 重启，:3022）

## 坑提醒

- worker 是 tsx 非 watch：改完 kill+重启 :3022，sleep 3 再 curl
- pg 容器 postgresServer 若停了先 `docker start postgresServer`
- 旧纪录数据在 `drafts/<postId>/pi-sessions`（post 根级）不在 chats/ 下，属冒烟遗留，不迁
