// 发布 worker 入口（Task 4）：node:http :3022（PUBLISH_WORKER_PORT 可覆盖）
// 路由（Task 6 API 层 fetch 这些端点）：
//   GET  /health                → {ok:true, platform:"publish-worker"}
//   GET  /login?platform=xhs    → 后台启 Easel login（--qr-out/--status-file 约定路径），返 {qrPath,statusFile}
//   GET  /login-status?platform → 读 statusFile JSON 透传（不存在→{status:"pending"}）
//   POST /plan  {variantId}     → plan 子命令 dry-run，回 {ok,stdout}；有 Job 则写 Log(PLAN)
//   POST /publish {jobId}       → 202 fire-and-forget：校验 Job 存在且 status=PENDING 后后台 processJob（裁决②，不等待完成；异常自行落 lastError）；非 PENDING → 409
//   GET  /jobs/:id             → 读 DB 返 job（Task 7 轮询出状态；不存在→404）
//   POST /jobs/:id/cancel      → Job=CANCELLED（仅 PENDING/RUNNING 可取消）
import "../env"; // 独立进程自载 .env（dotenv；与 ws sidecar 同惯例，必须最先 import）
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db";
import { contentArgs, easelScriptFor, processJob, writePublishLog } from "./process-job";
import { startScheduler } from "./scheduler";
import { spawnEasel } from "./spawn";
import { LOGIN_SCRIPTS, QRCODE_DIR, loginPaths, readLoginStatus, type LoginPlatform } from "./status";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = parseInt(process.env.PUBLISH_WORKER_PORT ?? "3022", 10);

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c.toString();
      if (data.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function platformFrom(url: URL): string {
  return (url.searchParams.get("platform") ?? "").trim().toLowerCase();
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const p = url.pathname;
  const method = req.method ?? "GET";

  // ---- GET 路由 ----
  if (method === "GET" && p === "/health") {
    json(res, 200, { ok: true, platform: "publish-worker" });
    return;
  }
  if (method === "GET" && p === "/login") {
    const platform = platformFrom(url);
    if (!(platform in LOGIN_SCRIPTS)) {
      // 缺参 400；gzh 已知未接入给 501（明确「暂不支持」而非参数错）
      json(res, platform === "gzh" ? 501 : 400, {
        ok: false,
        error:
          platform === "gzh"
            ? "gzh P1 未接入（P2 官方 API 未接入，web_publisher 无 gzh 适配器）"
            : "platform 参数缺失或不支持（P1 仅 xhs/douyin）",
      });
      return;
    }
    const { script, subcmd } = LOGIN_SCRIPTS[platform as LoginPlatform];
    const { qrPath, statusFile } = loginPaths(platform as LoginPlatform);
    await fs.mkdir(path.join(REPO_ROOT, QRCODE_DIR), { recursive: true });
    // 登录是长流程（扫码），后台跑不阻塞响应；失败只打日志（前端经 /login-status 看到 error）
    void spawnEasel([script, subcmd, "--qr-out", qrPath, "--status-file", statusFile, "--timeout", "300"], {
      timeoutMs: 330_000,
    }).then((r) => {
      if (r.code !== 0) console.warn(`[publish-worker] login(${platform}) 退出 code=${r.code}: ${r.stderr.slice(-300)}`);
    });
    json(res, 200, { ok: true, qrPath, statusFile });
    return;
  }
  if (method === "GET" && p === "/login-status") {
    const platform = platformFrom(url);
    if (!(platform in LOGIN_SCRIPTS)) {
      json(res, 400, { ok: false, error: "platform 参数缺失或不支持（P1 仅 xhs/douyin）" });
      return;
    }
    json(res, 200, await readLoginStatus(platform as LoginPlatform));
    return;
  }

  // ---- POST 路由 ----
  if (method === "POST" && p === "/plan") {
    let variantId: string;
    try {
      variantId = (JSON.parse((await readBody(req)) || "{}") as { variantId?: string }).variantId ?? "";
    } catch {
      json(res, 400, { ok: false, error: "JSON 解析失败" });
      return;
    }
    if (!variantId) {
      json(res, 400, { ok: false, error: "variantId 参数缺失" });
      return;
    }
    const variant = await prisma.postVariant.findUnique({
      where: { id: variantId },
      include: { post: true, job: true },
    });
    if (!variant) {
      json(res, 404, { ok: false, error: `variant not found: ${variantId}` });
      return;
    }
    const script = easelScriptFor(variant.platform);
    if (!script) {
      json(res, 501, { ok: false, error: `${variant.platform} P1 未接入（P2 官方 API 未接入，web_publisher 无 gzh 适配器）` });
      return;
    }
    const result = await spawnEasel([script, "plan", ...contentArgs(variant, variant.post)]);
    // Log(PLAN) 需 jobId（FK）：无 Job 的 variant（尚未排期）不落 log，仅回 dry-run 结果
    if (variant.job) {
      await writePublishLog(
        variant.job.id,
        "PLAN",
        result.code === 0 ? result.stdout.trim() || "plan dry-run 通过" : `plan 失败（code=${result.code}）：${result.stderr.trim().slice(-300)}`,
      );
    }
    json(res, result.code === 0 ? 200 : 502, {
      ok: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    return;
  }
  if (method === "POST" && p === "/publish") {
    let jobId: string;
    try {
      jobId = (JSON.parse((await readBody(req)) || "{}") as { jobId?: string }).jobId ?? "";
    } catch {
      json(res, 400, { ok: false, error: "JSON 解析失败" });
      return;
    }
    if (!jobId) {
      json(res, 400, { ok: false, error: "jobId 参数缺失" });
      return;
    }
    // 裁决②：fire-and-forget——校验 Job 存在即返 202，后台跑 processJob（最长 ~10min 不挂 HTTP）；
    // 状态由 Task 7 轮询 GET /jobs/:id；processJob 内部异常已自行落 lastError，此处 .catch 仅兜底（如 markFailed 自身失败）
    const job = await prisma.publishJob.findUnique({ where: { id: jobId } });
    if (!job) {
      json(res, 404, { ok: false, error: `job not found: ${jobId}` });
      return;
    }
    // I-1 并发双跑防护：仅 PENDING 可触发——RUNNING/终态/CANCELLED 一律 409（勿重试；排期 tick 与 worker 内 CAS 双保险）
    if (job.status !== "PENDING") {
      json(res, 409, {
        ok: false,
        status: job.status,
        error: `任务已被触发/进行中（现态 ${job.status}，仅 PENDING 可触发），勿重试`,
      });
      return;
    }
    void processJob(jobId).catch((e) => {
      console.error(`[publish-worker] processJob(${jobId}) 后台执行异常:`, e);
    });
    json(res, 202, { ok: true, jobId });
    return;
  }
  const jobGetMatch = p.match(/^\/jobs\/([^/]+)$/);
  if (method === "GET" && jobGetMatch) {
    const jobId = decodeURIComponent(jobGetMatch[1]);
    const job = await prisma.publishJob.findUnique({ where: { id: jobId } });
    if (!job) {
      json(res, 404, { ok: false, error: `job not found: ${jobId}` });
      return;
    }
    json(res, 200, { ok: true, job });
    return;
  }
  const cancelMatch = p.match(/^\/jobs\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    const jobId = decodeURIComponent(cancelMatch[1]);
    const job = await prisma.publishJob.findUnique({ where: { id: jobId } });
    if (!job) {
      json(res, 404, { ok: false, error: `job not found: ${jobId}` });
      return;
    }
    if (job.status !== "PENDING" && job.status !== "RUNNING") {
      json(res, 409, { ok: false, status: job.status, error: "已结束的任务不可取消" });
      return;
    }
    await prisma.publishJob.update({ where: { id: jobId }, data: { status: "CANCELLED" } });
    json(res, 200, { ok: true, status: "CANCELLED" });
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error("[publish-worker] 路由异常:", e);
    json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  });
});

// 仅作为主进程启动时监听（import 本模块做路由单测不产生 listen 副作用）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 排期器：60s 扫 due PENDING，只自动发 APPROVED；timer.unref() 不阻止进程退出（worker kill 干净）
  startScheduler(prisma);
  server.listen(PORT, () => {
    console.log(`[publish-worker] 发布 worker 已启动 :${PORT}（排期器每 60s 扫描，仅自动发 APPROVED）`);
  });
}
