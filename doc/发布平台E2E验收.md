# 发布平台 P1 E2E 验收清单

> 口径（用户拍板）：**P1 收口 2 平台——小红书 + 抖音各验一次**。
> GZH **不在 P1 验收内**（官方 API 属 P2）：GZH 变体可建、可批准，发布必然 FAILED（文案「P1 未接入（P2 官方 API 未接入）」）——**这是预期行为，非缺陷**。
> 真实 E2E 前置：用户测试号 + 干净 IP（家宽，非机房/代理出口）。本清单为可执行步骤，人工验收时按序执行并把结果填入文末回执表格。

## 0. 环境准备（一次性）

| 项 | 命令 / 说明 |
|---|---|
| 本机依赖 | `python3 -c "import playwright"`（Task 2 vendor 的 Easel 脚本跑在 python3 + playwright；Easel 已 vendor 至 `server/publish/easel/`） |
| `.env` | 根目录 `.env` 含数据库连接（worker 与 Next 都自载） |
| 登录态目录 | `~/.publish-profiles`（worker spawn 自动注入，勿手工建） |

## 1. 起进程（两个终端）

```bash
npm run dev            # Next dev（:3000，UI 与 API 代理）
npm run publish:dev    # 发布 worker（:3022，PUBLISH_WORKER_PORT 可覆盖；排期器每 60s 扫 due PENDING）
```

健康检查（worker 活着才继续，否则按「已知坑 ④」处置）：

```bash
curl -s localhost:3022/health
# 预期：{"ok":true,"platform":"publish-worker"}
```

## 2. 小红书验收（一次全链路）

### 2.1 扫码登录（账号页入口）

- UI：`/publish/accounts` → 小红书卡「扫码登录」；二维码由 `/api/publish/qrcode?platform=xhs` 渲染（仅 worker 报 `state=qr_ready` 才显示 img），登录态由 login-status **3s 轮询**至 success/error/expired。
- curl 等价：

```bash
curl -s 'localhost:3022/login?platform=xhs'
# 预期：{"ok":true,"qrPath":"data/publish/qrcode/xhs.png","statusFile":"data/publish/qrcode/xhs.json"}（后台启 chromium，不阻塞）
# 手机测试号打开小红书扫码（干净 IP）
curl -s 'localhost:3022/login-status?platform=xhs'
# 预期：读到 success（JSON 键名见「已知坑 ②」）
```

- 对账截图：`data/publish/qrcode/xhs.png`（二维码）+ `data/publish/qrcode/xhs.json`（登录态）。

### 2.2 建 Post + XHS Variant（真实标题/图）

UI 路径：`/publish`（内容页新建 + 媒体上传）→ `/publish/variants`（XHS 卡「创建并校验」）。curl 等价：

```bash
# ① 建 post（title/body 必填；先传媒体拿 path，mediaPaths 回填在 post 上）
curl -s -X POST localhost:3000/api/publish/posts -H 'Content-Type: application/json' \
  -d '{"title":"<真实标题>","body":"<真实正文>","mediaPaths":[]}'        # → 200 {…postId, userId}
curl -s -X POST localhost:3000/api/publish/media -F 'postId=<postId>' -F 'file=@./某图.png'    # → 200 {"path":"data/publish/media/<postId>/…"}（postId 取自 ① 建 Post 的响应；缺 → 400）
curl -s -X PATCH localhost:3000/api/publish/posts/<postId> -H 'Content-Type: application/json' \
  -d '{"mediaPaths":["data/publish/media/<postId>/….png"]}'

# ② 建 XHS variant（入库前跑格式校验，超长→422 {errors[]} 不落库；XHS 上限：标题 ≤20 字、标签 ≤10、图 ≤9 张）
curl -s -X POST localhost:3000/api/publish/variants -H 'Content-Type: application/json' \
  -d '{"postId":"<postId>","platform":"XHS","title":"<≤20字>","body":"…","tags":["…"]}'
# → 200 variant（含 id）；重复建同 (postId,platform) → 409（见「已知坑 ③」）
```

### 2.3 批准 + 立即发（三条 Log + Job=SUCCESS）

```bash
# ③ 批准闸门（排期只发 APPROVED；UI = XHS 卡「批准并发布」）
curl -s -X PATCH localhost:3000/api/publish/variants/<variantId> -H 'Content-Type: application/json' \
  -d '{"status":"APPROVED"}'                                            # → 200（再改 title/body 会重校验 422）

# ④ 建任务（scheduledAt=now；UI 同按钮里完成）
curl -s -X POST localhost:3000/api/publish/jobs -H 'Content-Type: application/json' \
  -d "{\"variantId\":\"<variantId>\",\"scheduledAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
# → 200 {job: PENDING}；重复建 → 409（见「已知坑 ③」）

# ⑤ plan dry-run 落 Log(PLAN)（worker 端；Job 已存在才写库——「Log(PLAN) 需 jobId（FK）」）
curl -s -X POST localhost:3022/plan -H 'Content-Type: application/json' -d '{"variantId":"<variantId>"}'
# → 200 {"ok":true,"stdout":"…"}（dry-run 只打印步骤不触网；失败→502）

# ⑥ 立即发（worker 端 fire-and-forget；不等 60s 排期 tick 则手动触发）
curl -s -X POST localhost:3022/publish -H 'Content-Type: application/json' -d '{"jobId":"<jobId>"}'
# → 202 {"ok":true,"jobId":"…"}（后台 processJob，最长 ~10min 不挂 HTTP；UI 侧排期页 5s / 适配页 2.5s 轮询）
```

### 2.4 结果确认

```bash
curl -s localhost:3000/api/publish/jobs/<jobId>
# 预期（API 代理层，含 variant；worker 端 GET /jobs/<jobId> 只回裸 job 行）：status = SUCCESS、lastError = null；variant.status = PUBLISHED
curl -s 'localhost:3000/api/publish/logs?jobId=<jobId>'
# 预期：3 条 Log 时间线——PLAN / PUBLISH / VERIFY（PUBLISH detail 含「✅ XHS 发布成功」读回证据，见「成功判据」）
```

- 测试号终验（人工）：打开手机小红书测试号，确认新作品出现在发布列表；截图粘贴到回执表。
- 登录态旁证：VERIFY Log detail 即 whoami JSON（`{loggedIn,name,avatar}`，未登录时含 `error` 字段）。

## 3. 抖音验收（同流程各一步）

与 §2 完全同构，替换：

- `platform=xhs` → `platform=douyin`（login / login-status / qrcode / 状态文件 `data/publish/qrcode/douyin.json`）；
- variant `platform:"DOUYIN"`（上限：标题 ≤30 字、**正文 ≤55 字**、标签 3-5 个——超限 422 逐条）；
- publish 步骤额外挂 `--status-file data/publish/qrcode/douyin-publish.json`（仅 DOUYIN，XHS 无此参数，worker 已钉死）。

**短信墙处置（Global Constraints）**：发布触发抖音风控短信验证 → Job=**FAILED**、PublishLog 恰 1 条 stage=PUBLISH detail「发布触发抖音短信验证墙，需人工验证码：…」、`lastError` 含「需人工验证码」；UI 排期页黄条「抖音风控墙，需人工：终端跑 douyin_publish.py 或等下次确认」。处置：人工回填验证码后重发，或将本次「弹墙 + FAILED + log 文案」如实记入回执表（不静默吞掉，也不静默改判成功）。

## 4. GZH 预期行为（一行，非验收项）

建 GZH variant（标题 ≤64 字）**可建可批**；发布 FAILED（`lastError`：「GZH 平台 P1 未接入（P2 官方 API 未接入）：…无公众号(gzh)适配器」）；`GET /api/publish/login?platform=gzh` → **501**「gzh P1 未接入（P2 官方 API 未接入，web_publisher 无 gzh 适配器）」；worker `POST /plan`（GZH variant）同样 501。——**预期行为，非缺陷**；真实发布属 P2 官方 API 范畴。

## 5. 脚本退出码 / 「发布成功」标记（成功判据）

worker spawn Easel 的判成功规则（`process-job.ts`，钉死不放宽）：

| 情形 | 退出码 | Job 结果 |
|---|---|---|
| `publish --exec` 退出 0 且 stdout 含公共子串 **「发布成功」**（xhs「✅ 发布成功」/ douyin「✅ 抖音发布成功（读回核验：…）」） | 0 | 记 PUBLISH Log（读回证据）→ VERIFY（whoami）→ **SUCCESS** |
| plan 或 publish 退出 ≠0 | ≠0 | **FAILED**（lastError=`plan/publish 失败（code=N）：stderr 尾 300 字`） |
| 退出 0 但 stdout 无「发布成功」标记 | 0 | **FAILED**（「发布未核实：退出 0 但 stdout 无读回成功标记——不把未核实当成功」） |
| python3 不存在 / spawn 错 | 127 | FAILED（stderr 附 spawn error） |
| 超时（默认 10min，`PUBLISH_WORKER_TIMEOUT_MS` 可覆盖；VERIFY 单独 120s） | 124 | FAILED（stderr 附 `[timeout …ms]`） |
| DOUYIN + 短信墙判定命中（见 §3） | ≠0 | FAILED + Log(stage=PUBLISH, detail「需人工验证码…」) |

注：VERIFY 步异常（whoami 失败/超时）**不推翻** PUBLISH 成功（成功判据 = 上一步读回标记），VERIFY Log 记异常文案。

## 6. 对账截图 / 关键文件路径（`data/publish/`，已 gitignore 不提交）

| 路径 | 内容 |
|---|---|
| `data/publish/qrcode/xhs.png` / `douyin.png` | 扫码二维码 PNG |
| `data/publish/qrcode/xhs.json` / `douyin.json` | 登录态 statusFile（Easel login_state 结构，键名 `state`） |
| `data/publish/qrcode/douyin-publish.json` | 抖音发布状态（每次发布前 worker 先 `fs.rm(force)` 清残留，见「已知坑 ②」） |
| `data/publish/media/<postId>/` | 上传媒体落盘 |
| PublishLog `screenshotPath` | P1 worker 从不写截图（列恒 null，日志页有值才展示）——**人工确认截图由验收者粘贴进回执表** |

## 7. 已知坑（8 任务留痕，验收时遇到别误判）

1. **plan 子命令没有 `--profile-base`**：xhs/douyin `plan` argparse 只挂内容参数（`xhs_publish.py:1038` / `douyin_publish.py:1474`），注入 `--profile-base` 直接 `argparse: error` exit 2。`spawn.ts` 只对 {login, login-qr, publish, publish-video, whoami} 注入且 rest 已带则不注（`tests/publish-worker-spawn.test.ts` 钉死）。若手工复现 `python3 server/publish/easel/xhs_publish.py plan --profile-base …` 报 exit 2 是**正常预期**（反证），worker 主链路已正确绕开。
2. **抖音 status file 键名是 `state` 不是 `status`**：`douyin-publish.json` / 登录 `douyin.json` 结构 = login_state `{state, message, qr, ts}`。短信墙判定 = `state==="sms_required"` 或（`state==="error"` 且 message 含「短信验证」；一般失败如「发布未确认」不命中、保持 0 log）。文件每次发布覆盖写，worker 发布前 `fs.rm(force)` 清残留防误判（Task 5 附带小修，I1d 用例钉死）。
3. **P2002 → 409**：variants 同 (postId,platform)、jobs 同 variantId 唯一约束；并发 create 撞约束由 P2002 catch 兜底返 409（文案指路「改期/取消走 PATCH」）。**FAILED 任务 UI 无法重建 job（1:1 约束，P1 限制）**——失败重发需在回执注明「需清理 job 行或后续版本开放重建」。
4. **worker 未起 → 502**：API 代理层（login / login-status / qrcode）对 ECONNREFUSED 统一返 **502 `{"error":"publish worker 未启动"}`**，UI 红条 + 「重新登录」重试。验收先做 §1 健康检查，502 即 worker 没起 / 端口错。
5. **GZH 501**：见 §4，两处 501（API login 透传 + worker /plan）文案含「P2 官方 API 未接入」，不要按参数错误（400）处置。
6. **短信墙处置**：见 §3——FAILED + 1 条 PUBLISH Log「需人工验证码」是设计内处置（Task 4 I1），既非流程 bug 也不允许静默成功；人工补验证码后重发再验收。

## 8. 回执（人工验收时填）

| 平台 | Post 标题 / variantId / jobId | Job 终态 | 脚本退出码/标记（对照 §5 语义表填） | Log PLAN/PUBLISH/VERIFY 各 1 条？ | 测试号确认作品（截图粘贴） | 弹短信墙？（Y/N，N=—） | 备注（踩坑/偏差） |
|---|---|---|---|---|---|---|---|
| 小红书 |  |  |  |  |  |  |  |
| 抖音 |  |  |  |  |  |  |  |
| GZH（预期行） |  | FAILED（预期，P2 官方 API 未接入） | —（501，未触脚本） | 501/无 PUBLISH Log（预期） | —（不发） | — |  |

验收完成标准：两行「小红书」「抖音」Job 终态 = SUCCESS、Log 三阶段齐全、测试号确认作品；GZH 行符合预期即通过。任一平台失败：把 lastError + Log detail 原文粘进备注列，不回改判 SUCCESS。
