# 任务：发布会话页 1:1 复刻 Easel 聊天界面（2026-10-14 续）

用户拍板：「easel 的逻辑都搬过来」「最好做到 1:1 复刻出了界面」。
上一轮做的三栏自研 UI 废弃（publish-session-panel.tsx 删除），换成 Easel 同款：
- 布局：Easel app-layout（左 sidebar 264px + 主聊天区；出稿卡=内嵌对话流尾部的产物区，Easel card 样式）
- 左侧：Easel Sidebar 同款（logo 行+主题开关 / 「对话」区=聊天记录列表+新对话 / 会话项 hover 重命名+删除 / 状态脚）
- 聊天：Easel ChatPage 同款（空态 hero 问候+4 建议卡+composer-hero；对话态消息流+composer）
- composer：Easel 毛笔笔入口 BrushEntry（「看看能做什么」=技能面板，数据源=我们 /skills 5 项按 layer 分组 tabs）
- 气泡：Easel MessageBubble（typing/live-panel/复制；markdown 走现有 MarkdownRenderer + Easel 气泡 CSS）
- CSS：Easel index.css+theme.css 聊天相关块 → src/components/publish/easel/easel.css，选择器全挂 .easel-shell 前缀作用域
- 纪录标题=源内容标题（用户上轮要求）；改名=sidebar 重命名（worker meta.json）
- 数据面：worker 新增 POST /session-chats（建纪录）/ POST /session-rename / DELETE /session-chats；
  发消息=POST /session/chat（chatId+skill；该纪录首个技能=发送时所选，BrushEntry 选中=换工作流）；
  历史=GET /session-chat-history；出稿=GET /session-drafts?chatId（卡片渲染在消息流尾部+采纳）

## 里程碑
- [x] 读齐 Easel 组件/CSS 结构（ChatPage/Sidebar/BrushEntry/MessageBubble/icons/theme+index.css）
- [x] worker：create/rename/delete 端点 + API 代理
- [x] easel.css 作用域化
- [x] 组件：EaselSidebar / EaselChatPage / EaselBrush / EaselBubble / 主题开关（vendor 到 src/components/publish/easel/）
- [x] session 页换壳（删旧 panel）+ 图标资产 public/
- [x] npm run check + worker 重启 + 冒烟

## 坑
- Easel CSS 全局规则（html/body/*、:root 变量）必须全挂 .easel-shell，污染宿主=全 app 崩
- 主题默认 light（1:1），toggle 存 localStorage sc_easel_theme
- worker tsx 非 watch：改完 kill+重启 :3022
- react-markdown 渲染在 .message-bubble.assistant 内（Easel 用 marked+DOMPurify，我们不引新依赖，markdown CSS 已备）
