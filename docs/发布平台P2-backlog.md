# 发布平台 P2 backlog（终审分诊遗留 + 设计分期备忘）

> 来源：P1 全分支终审（c205dbde）+ 各任务 deferred minors，2026-10-13 记录。
> 分支：`selbylei/workbench`（HEAD e98b8e9，未合并，等用户拍板）；真实 E2E 待测试号+干净 IP。

## A. 终审分诊：带病可 merge / P2 项（11 条）
1. **② ATTRIBUTION 本机绝对路径**（`server/publish/easel/ATTRIBUTION.md:7`）：改 git 仓库出处（ZJU-REAL/Easel），一行文档
2. **③a format-check header 注释措辞矛盾**（`src/lib/publish/format-check.ts:5-6`）：「platform-traits 无数值上限」与自引「3-9 张竖版」矛盾；改一句「hard 上限以 platform-specs 为准」
3. **③b DOUYIN title=30 单点来源**：来自 skill-douyin-upload 脚本约定；Easel 调阈值会静默漂移 → P2 同步机制或发布前实时校验脚本源
4. **④M2 writePublishLog 吞错无测试**（process-job）：加 1 条 `log.create` reject 主链路仍 SUCCESS 用例
5. **④M3 GET /login 失败 statusFile 永不落盘**：spawn 失败路径补写 `{status:"error"}` 或文档化「永远 pending」行为
6. **④M4 POST /plan 502 回传全量 stdout**：截尾 300 字（同 lastError 口径）
7. **⑤a tick 返回计数名实不符**：processed=正常返回数（含闸门 FAILED），注释/log 措辞改「处理完成数」
8. **⑤b I1d 测试向真实 `data/publish/qrcode/` 写残留文件**：挪 tmpdir 或 mock fs.rm 目标路径
9. **⑥a media 文件名/同名覆盖/无体积上限**（media/route.ts）：P2 加白名单体积 + 唯一化命名
10. **⑥d posts PATCH status 自封 PUBLISHED/FAILED 入口**：API 收窄（status 只允许 DRAFT/READY 互改）或文档化
11. **⑦ UI 类**：a 轮询切 `/jobs/:id`（现全量 GET /jobs）；b 批准原子性提示文案；c「编辑中」metric 口径（FAILED 篇计入）；d 空 constraints 无法清空（upsert 传 `constraints:""` 或 null 语义）

## B. 终审注记（P2 观察项，不阻塞）
- 真实 E2E（§2 小红书 / §3 抖音）未执行——人工既定步骤，测试号就绪后按 `docs/发布平台E2E验收.md` 走；**截图不回 commit**（文档已引导粘贴进回执表，P2/验收 SOP 钉死不回仓）
- P1 plan 文本「3 enum」笔误（实交 5 enum）——历史工件，P2 文档清理时勘误
- PostVariant 冗余 `@@index([postId])`——随下次 schema 迁移删除

## E. 并发/状态机残余（与 I-1 同族，终审复审 P2 注记）
12. **cancel 反向窗口**：cancel 裸 update 可能覆盖刚写的终态（SUCCESS/FAILED 已有 RUNNING 前置 CAS，cancel 侧未对称）；修法：cancel 同样 updateMany CAS（where status in PENDING/RUNNING）
13. **worker 重启后 RUNNING 僵死 job 无回收**：启动时将 RUNNING 归置（→PENDING 重排或 FAILED「worker 重启中断」）
14. **scheduler inFlight 对永不 settle 的 tick 无超时复位**（DB 挂起病态）——记录观察项

## C. 设计分期备忘（非缺陷）
- GZH 公众号官方 API 发布器（P1 拍板收口 2 平台，GZH 变体可建可批、发布 FAILED「P2 官方 API 未接入」）
- 多租户：userId 域隔离 schema 已就位（Post/AccountProfile.userId + 路由 where 全带）；worker 排期器全量扫 PENDING + FK 未声明（db push 会移除手工 FK）→ P2 收敛
- 内嵌 pi 底座（设计稿 P2 b 方案）、PostMetric（P3）

## D. 终审 fix wave 已修（留档）
- I-1 并发双跑：PENDING→RUNNING CAS + scheduler in-flight 单飞 + POST /publish 非 PENDING 409（7d1113e）
- N-1 短信墙黄条文案断链：匹配词统一「需人工验证码」（7d1113e）
- M1 cancel 竞态：终态写 RUNNING 前置 CAS，不覆盖 CANCELLED（7d1113e；markFailed 放宽 PENDING 经控制流核实不开洞）
