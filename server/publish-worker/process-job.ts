// 发布主链路（Task 4）：批准闸门 → plan dry-run → publish/publish-video --exec（按 format 分路）→ VERIFY whoami
// 成功判据（Global Constraints）：publish 脚本退出 0 且 stdout 含读回对账 success 标记——
// 标记取自 Easel 脚本源：xhs「✅ 发布成功」、douyin「✅ 抖音发布成功（读回核验：…）」，公共子串「发布成功」
import type { JobStatus, LogStage, Platform } from "@prisma-generated/enums";
import { promises as fs } from "node:fs";
import { prisma } from "../db";
import { spawnEasel } from "./spawn";
import { LIMITS } from "../../src/lib/publish/format-check";
import { DOUYIN_PUBLISH_STATUS_FILE, douyinPublishStatusPath, readDouyinPublishStatus } from "./status";

/** Easel stdout 读回成功标记（xhs/douyin publish 成功路径公共子串；dry-run 输出只含「成功校验」不会误中） */
export const PUBLISH_SUCCESS_MARKER = "发布成功";

/** 平台 → Easel 脚本（GZH 无脚本：web_publisher 的 --platform choices 只有 kuaishou/weixin-channels/zhihu，没有公众号适配器） */
export function easelScriptFor(platform: Platform): string | null {
  if (platform === "XHS") return "xhs_publish.py";
  if (platform === "DOUYIN") return "douyin_publish.py";
  return null;
}

/** 视频扩展名（与 format-check VIDEO 形式校验口径一致） */
export const VIDEO_EXTS = ["mp4", "mov", "webm", "mkv"];

type VariantLike = { title: string; body: string; tags: string[]; format?: string };
type PostLike = { mediaPaths: string[] };

/**
 * Variant/Post → Easel 内容参数（按 format 分路；参数表核对自 xhs/douyin argparse）：
 * - IMAGE_TEXT（缺省）：publish --images 逗号分隔
 * - VIDEO：publish-video --video 单视频路径（取第一个视频扩展名媒体，回退第一个媒体）；不传 --images
 */
export function contentArgs(variant: VariantLike, post: PostLike): string[] {
  const args = ["--title", variant.title];
  if (variant.body) args.push("--content", variant.body);
  if (variant.format === "VIDEO") {
    const media = post.mediaPaths ?? [];
    const video =
      media.find((m) => VIDEO_EXTS.includes(m.split(".").pop()?.toLowerCase() ?? "")) ?? media[0];
    if (video) args.push("--video", video);
  } else if (post.mediaPaths?.length) {
    args.push("--images", post.mediaPaths.join(","));
  }
  if (variant.tags?.length) args.push("--tags", variant.tags.join(","));
  return args;
}

/** VIDEO 形式取视频媒体（contentArgs 口径一致），无可发媒体返回 null */
export function videoMedia(variant: VariantLike, post: PostLike): string | null {
  const media = post.mediaPaths ?? [];
  return media.find((m) => VIDEO_EXTS.includes(m.split(".").pop()?.toLowerCase() ?? "")) ?? media[0] ?? null;
}

/** 写 PublishLog；日志写库失败只告警、不阻断主链路（发布结果不因日志故障丢失） */
export async function writePublishLog(
  jobId: string,
  stage: LogStage,
  detail: string,
  screenshotPath?: string | null,
): Promise<void> {
  try {
    await prisma.publishLog.create({
      data: { jobId, stage, detail: detail.slice(0, 2000), screenshotPath: screenshotPath ?? null },
    });
  } catch (e) {
    console.warn("[publish-worker] PublishLog 写入失败（主链路继续）:", e instanceof Error ? e.message : e);
  }
}

export async function processJob(jobId: string): Promise<JobStatus> {
  const job = await prisma.publishJob.findUnique({
    where: { id: jobId },
    include: { variant: { include: { post: true } } },
  });
  if (!job) throw new Error(`job not found: ${jobId}`);
  // fire-and-forget（POST /publish 202 不 await）：链路意外异常落 lastError 转 FAILED，不 reject 到路由
  //（路由侧仅剩 console 兜底；此处 markFailed 自身失败才真正 reject）
  try {
    return await runJob(job.id, job.variant, job.variant.post);
  } catch (e) {
    return markFailed(jobId, `发布链路异常：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function runJob(
  jobId: string,
  variant: VariantLike & { id: string; status: string; platform: Platform },
  post: PostLike,
): Promise<JobStatus> {
  // ① 批准闸门：非 APPROVED 一律不 spawn（Global Constraints 硬闸门）
  if (variant.status !== "APPROVED") {
    return markFailed(jobId, `需批准：Variant 状态为 ${variant.status}（仅 APPROVED 可发布，批准后重发）`);
  }

  // ② GZH P1 未接入（P2 官方 API 未接入；web_publisher 无 gzh 适配器）：明确 FAILED，不静默、不 spawn
  const script = easelScriptFor(variant.platform);
  if (!script) {
    return markFailed(
      jobId,
      `${variant.platform} 平台 P1 未接入（P2 官方 API 未接入）：web_publisher 的 --platform 仅支持 kuaishou/weixin-channels/zhihu，无公众号(gzh)适配器`,
    );
  }

  // VIDEO 形式硬门：入库闸（format-check）已过，但批准后媒体可能被删——无媒体不 spawn，明确 FAILED
  if (variant.format === "VIDEO" && !videoMedia(variant, post)) {
    return markFailed(jobId, "视频形式无可发视频文件（Post 媒体为空或无视频扩展名），请补传视频后重发");
  }

  // IMAGE_TEXT 形式媒体闸（与 VIDEO 闸对称）：入库闸只管建 variant，但媒体可能建于闸前/批准后删光——
  // 发布时不满足平台媒体下限不 spawn 浏览器，明确 FAILED + 补救指引（不静默走到 Easel 脚本 exit 1）
  if (variant.format !== "VIDEO") {
    const mediaMin = LIMITS[variant.platform]?.mediaMin;
    const mediaCount = post.mediaPaths?.length ?? 0;
    if (mediaMin !== undefined && mediaCount < mediaMin) {
      return markFailed(
        jobId,
        `缺少媒体：${variant.platform} 图文发布需至少 ${mediaMin} 个媒体，当前 ${mediaCount}——请到 Post 素材区补传后重发（或改 VIDEO 形式传视频）`,
      );
    }
  }

  // I-1 并发双跑防护：PENDING→RUNNING CAS（updateMany 检 count）——被并发触发/排期轮次抢占（count=0）
  // 则不 spawn 第二跑，重读库返现态（job 行仍在；理论缺失才落 FAILED 兜底不外抛）
  const cas = await prisma.publishJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "RUNNING", lastError: null },
  });
  if (cas.count === 0) {
    const cur = await prisma.publishJob.findUnique({ where: { id: jobId } });
    console.warn(`[publish-worker] processJob(${jobId}) 已被并发抢占（CAS count=0，现态 ${cur?.status ?? "missing"}），不 spawn`);
    return cur?.status ?? "FAILED";
  }

  const content = contentArgs(variant, post);

  // plan dry-run：离线步骤预览；失败=参数/内容不过，不进入真发
  const plan = await spawnEasel([script, "plan", ...content]);
  if (plan.code !== 0) {
    return markFailed(jobId, `plan 失败（code=${plan.code}）：${tail(plan.stderr)}`);
  }

  // publish --exec：退出 0 且 stdout 含读回成功标记才算成功（未核实绝不标记成功）
  // I1 抖音短信墙：douyin publish 附加 --status-file（douyin add_common 专属参数，供短信墙轮询）；
  // xhs publish 无此参数（argparse 源），绝不传
  // 子命令按 format 分路：VIDEO → publish-video（xhs/douyin argparse 均含该子命令）；图文缺省 → publish
  const publishSubcmd = variant.format === "VIDEO" ? "publish-video" : "publish";
  const publishArgs = [script, publishSubcmd, "--exec", ...content];
  if (variant.platform === "DOUYIN") {
    publishArgs.push("--status-file", DOUYIN_PUBLISH_STATUS_FILE);
    // I1 残留小修：发布前清掉旧的 douyin-publish.json（上轮「短信验证」终态残留会被 isSmsWallStatus 误命中）；force=不存在不报错
    await fs.rm(douyinPublishStatusPath(), { force: true });
  }
  const pub = await spawnEasel(publishArgs);
  if (pub.code !== 0) {
    // I1：抖音短信墙 → 任务 FAILED、Log(stage=PUBLISH) 提示「需人工验证码」（不静默吞掉）
    if (variant.platform === "DOUYIN") {
      const st = await readDouyinPublishStatus();
      if (isSmsWallStatus(st)) {
        await writePublishLog(
          jobId,
          "PUBLISH",
          `发布触发抖音短信验证墙，需人工验证码：${String(st.message ?? "") || "等待验证码超时/未输入，请回填验证码后重发"}`,
        );
        return markFailed(jobId, `publish 失败（code=${pub.code}）：触发短信验证墙，需人工验证码（${tail(pub.stderr)}）`);
      }
    }
    return markFailed(jobId, `publish 失败（code=${pub.code}）：${tail(pub.stderr)}`);
  }
  if (!pub.stdout.includes(PUBLISH_SUCCESS_MARKER)) {
    return markFailed(jobId, `发布未核实：退出 0 但 stdout 无读回成功标记（不把未核实当成功）——${tail(pub.stdout)}`);
  }
  await writePublishLog(jobId, "PUBLISH", extractReadback(pub.stdout, variant.platform));

  // VERIFY：whoami 输出单行 JSON（登录态/昵称），存 log 供日志页时间线；
  // 核实步异常不推翻 PUBLISH 成功（成功判据=上一步的读回标记）
  let verifyDetail: string;
  try {
    const verify = await spawnEasel([script, "whoami"], { timeoutMs: 120_000 });
    verifyDetail = JSON.stringify(parseWhoami(verify.stdout));
  } catch (e) {
    verifyDetail = `VERIFY 执行异常：${e instanceof Error ? e.message : String(e)}`;
  }
  await writePublishLog(jobId, "VERIFY", verifyDetail);

  // M1 cancel 竞态防护：终态写 CAS——cancel 已抢先置 CANCELLED（count=0）则不覆盖、不推 Variant，返现态
  const termCas = await prisma.publishJob.updateMany({
    where: { id: jobId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "SUCCESS", lastError: null },
  });
  if (termCas.count === 0) {
    const cur = await prisma.publishJob.findUnique({ where: { id: jobId } });
    console.warn(`[publish-worker] processJob(${jobId}) SUCCESS 终态写被 cancel 抢占（现态 ${cur?.status ?? "missing"}），不覆盖`);
    return cur?.status ?? "CANCELLED";
  }
  await prisma.postVariant.update({ where: { id: variant.id }, data: { status: "PUBLISHED" } });
  return "SUCCESS";
}

/**
 * 抖音短信墙状态判定（读源 douyin_publish.py + login_state.py，不猜）：
 * - 等待窗口内 write_status(sf, "sms_required", …)（:520/:525/:560）；
 * - 墙超时退出前终态写 state="error" 且 message="发布短信验证超时未完成"（:561）——同样需人工回填验证码。
 * 其余 error（如「发布未确认」）不命中，保持「一般失败 0 log」。
 */
function isSmsWallStatus(st: Record<string, unknown>): boolean {
  if (st.state === "sms_required") return true;
  return st.state === "error" && String(st.message ?? "").includes("短信验证");
}

/** M1 cancel 竞态防护：终态写 CAS（仅 PENDING/RUNNING 可写 FAILED）——已被 cancel 置 CANCELLED（count=0）则不覆盖，记 warn 返现态 */
async function markFailed(jobId: string, reason: string): Promise<JobStatus> {
  const cas = await prisma.publishJob.updateMany({
    where: { id: jobId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "FAILED", lastError: reason.slice(0, 500) },
  });
  if (cas.count === 0) {
    const cur = await prisma.publishJob.findUnique({ where: { id: jobId } });
    console.warn(`[publish-worker] markFailed(${jobId}) FAILED 终态写被 cancel 抢占（现态 ${cur?.status ?? "missing"}），不覆盖`);
    return cur?.status ?? "CANCELLED";
  }
  return "FAILED";
}

/** 尾摘要：留最后 300 字符（脚本错误信息在尾部，头部多为进度噪音） */
function tail(s: string, n = 300): string {
  const t = (s ?? "").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

/** 从 publish stdout 提取读回证据（抖音：「读回核验：<作品id>」；小红书：成功跳转 URL）→ 存 Log detail */
function extractReadback(stdout: string, platform: Platform): string {
  const rb = stdout.match(/读回核验[:：]\s*([A-Za-z0-9_-]+)/);
  if (rb) return `✅ ${platform} 发布成功（读回核验：作品 ${rb[1]}）`;
  const url = stdout.match(/https?:\/\/\S+/);
  if (url) return `✅ ${platform} 发布成功（已跳转：${url[0].slice(0, 200)}）`;
  return `✅ ${platform} 发布成功（stdout 含成功标记，无作品 id/URL）`;
}

/** whoami 协议：stdout 末段一行 JSON（{loggedIn,name,avatar,error?}），取最后一个 JSON 行 */
function parseWhoami(stdout: string): Record<string, unknown> {
  const lines = (stdout ?? "").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      /* 非 JSON 行，继续找 */
    }
  }
  return { raw: (stdout ?? "").trim().slice(0, 500) };
}
