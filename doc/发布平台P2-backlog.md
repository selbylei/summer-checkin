# 发布平台 P2 backlog（终审遗留项清单）

> 来源：发布平台 P1 全分支终审（c205dbde）+ 各任务 deferred minors。P1 分支 `selbylei/workbench`（HEAD 7d1113e）过闸时以下为「带病可 merge / P2」定级。P2 开工前先读本文档。日期戳：2026-10-13（系统时钟）。

## 并发/状态机（与 I-1 同族残余）
1. **cancel 反向窗口**：cancel 裸 update 可能覆盖刚写的终态（SUCCESS/FAILED 已有 RUNNING 前置 CAS，cancel 侧未对称）。修法：cancel 同样 updateMany CAS（where status in PENDING/RUNNING）。
2. **worker 重启后 RUNNING 僵死 job 无回收**：启动时将 RUNNING 归置（→PENDING 重排或 FAILED「worker 重启中断」）。P2 加。
3. scheduler inFlight 标志对「永不 settle 的 tick」（DB 挂起病态）无超时复位——记录观察项。

## schema/文档勘误
4. plan 文本「3 enum」笔误勘误（实交 5 enum，含 PostStatus）；PostVariant 冗余 `@@index([postId])`（联合唯一左前缀已覆盖）随下次 schema 迁移删除。
5. `server/publish/easel/ATTRIBUTION.md:7` 本机绝对路径改 git 仓库出处。

## 行为加固
6. `writePublishLog` 吞错补单测；`POST /plan` 502 全量 stdout 截断（同 lastError 300 字口径）；`GET /login` 失败时补写 `{status:"error"}` statusFile（或文档化永不落盘行为）；测试 I1d 假 status file 挪 tmpdir。
7. media 路由：体积上限 + 类型白名单 + 唯一命名（防同名覆盖）；`posts/[id]` PATCH status 入口收窄（UI 已不提供，API-only 面 P2 决定保留/收窄）。
8. 账号画像：空 constraints 无法清空已存值（upsert 省略字段不更新），P2 补 null 语义或显式 `constraints:""` 清空约定。

## UI/性能
9. 适配页轮询切 `GET /jobs/:id`（全量列表→单查，端点已存在）；「批准并发布」原子性提示文案；排期页「进行中」metric 口径（PENDING+RUNNING 标签精度）。

## 验收 SOP（钉死前门）
10. E2E 回执表若回贴截图：**截图不回 commit 进仓库**（`data/publish/` 已 gitignore；文档「粘贴进回执表」引导有敏感物入库前门，验收 SOP 需明确只贴文件路径/说明）。
11. **真实 E2E 未执行**：§2 小红书 / §3 抖音各一次（前置：测试号 + 干净 IP；GZH 预期 FAILED 非缺陷）。P1 验收闭环由人工完成，本清单第 10 项是它的配套。

## P2 范围备忘（非缺陷，属设计分期）
- 公众号官方 API 发布器（P1 明确未接，GZH 变体可建可批、发布 FAILED「P2 官方 API 未接入」）
- 多租户：userId 域隔离 schema 已就位（Post/AccountProfile.userId）；worker 排期器全量扫 PENDING、FK relation 未声明（db push 会移除手工 FK）——P2 收敛
- pi 内嵌底座（设计稿 P2 b 方案）
