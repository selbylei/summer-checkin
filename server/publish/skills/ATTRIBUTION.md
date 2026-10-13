# 技能源 ATTRIBUTION

- 来源：ZJU-REAL/Easel（skills/openclaw/ 全库 + skills/shared/ 共享层，Apache-2.0，LICENSE 原文见同目录）
- vendor 日期：2026-10-14（首批 5 技能 → 当夜全量 114 技能 + shared 层，对齐 Easel openclaw/sync.sh 的「全量同步」形态）
- 用途：发布会话「选技能=选工作流」：pi --skill 原生发现 + read/write 工具面，agent 自读 SKILL.md 照流程出稿；references/兄弟技能/shared 共享层按需 read
- 布局对齐 Easel workspace 扁平化：`skills/<slug>/` 兄弟引用（`../text-polisher/…`）与共享层引用（`../../shared/…` → server/publish/shared/）在 vendor 后可解
- 选择器首批 5 工作流技能：xhs-note-creator / skill-douyin-upload / card-xiaohongshu / copywriting / post-formatter（其余 109 个为全量库，agent 执行中自读，不进选择器）
