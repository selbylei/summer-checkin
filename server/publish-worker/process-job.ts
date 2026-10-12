// 发布主链路（Task 4）：批准闸门 → plan dry-run → publish --exec（读回成功标记）→ VERIFY whoami
// 成功判据（Global Constraints）：publish 脚本退出 0 且 stdout 含读回对账 success 标记——
// 标记取自 Easel 脚本源：xhs「✅ 发布成功」、douyin「✅ 抖音发布成功（读回核验：…）」，公共子串「发布成功」
import type { JobStatus, LogStage, Platform } from "@prisma-generated/enums";
import { prisma } from "../db";
import { spawnEasel } from "./spawn";

/** Easel stdout 读回成功标记（xhs/douyin publish 成功路径公共子串；dry-run 输出只含「成功校验」不会误中） */
export const PUBLISH_SUCCESS_MARKER = "发布成功";

/** 平台 → Easel 脚本（GZH 无脚本：web_publisher 的 --platform choices 只有 kuaishou/weixin-channels/zhihu，没有公众号适配器） */
export function easelScriptFor(platform: Platform): string | null {
  if (platform === "XHS") return "xhs_publish.py";
  if (platform === "DOUYIN") return "douyin_publish.py";
  return null;
}

type VariantLike = { title: string; body: string; tags: string[] };
type PostLike = { mediaPaths: string[] };

/** Variant/Post → Easel 内容参数（图文口径；参数表核对自 xhs/douyin argparse：--images 逗号分隔） */
export function contentArgs(variant: VariantLike, post: PostLike): string[] {
  const args = ["--title", variant.title];
  if (variant.body) args.push("--content", variant.body);
  if (post.mediaPaths?.length) args.push("--images", post.mediaPaths.join(","));
  if (variant.tags?.length) args.push("--tags", variant.tags.join(","));
  return args;
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
  const variant = job.variant;

  // ① 批准闸门：非 APPROVED 一律不 spawn（Global Constraints 硬闸门）
  if (variant.status !== "APPROVED") {
    await markFailed(jobId, `需批准：Variant 状态为 ${variant.status}（仅 APPROVED 可发布，批准后重发）`);
    return "FAILED";
  }

  // ② GZH P1 未接入（web_publisher 无 gzh 适配器）：明确 FAILED，不静默、不 spawn
  const script = easelScriptFor(variant.platform);
  if (!script) {
    await markFailed(
      jobId,
      `${variant.platform} 平台 P1 未接入：web_publisher 的 --platform 仅支持 kuaishou/weixin-channels/zhihu，无公众号(gzh)适配器`,
    );
    return "FAILED";
  }

  await prisma.publishJob.update({ where: { id: jobId }, data: { status: "RUNNING", lastError: null } });

  const content = contentArgs(variant, job.variant.post);

  // plan dry-run：离线步骤预览；失败=参数/内容不过，不进入真发
  const plan = await spawnEasel([script, "plan", ...content]);
  if (plan.code !== 0) {
    await markFailed(jobId, `plan 失败（code=${plan.code}）：${tail(plan.stderr)}`);
    return "FAILED";
  }

  // publish --exec：退出 0 且 stdout 含读回成功标记才算成功（未核实绝不标记成功）
  const pub = await spawnEasel([script, "publish", "--exec", ...content]);
  if (pub.code !== 0) {
    await markFailed(jobId, `publish 失败（code=${pub.code}）：${tail(pub.stderr)}`);
    return "FAILED";
  }
  if (!pub.stdout.includes(PUBLISH_SUCCESS_MARKER)) {
    await markFailed(jobId, `发布未核实：退出 0 但 stdout 无读回成功标记（不把未核实当成功）——${tail(pub.stdout)}`);
    return "FAILED";
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

  await prisma.publishJob.update({ where: { id: jobId }, data: { status: "SUCCESS", lastError: null } });
  await prisma.postVariant.update({ where: { id: variant.id }, data: { status: "PUBLISHED" } });
  return "SUCCESS";
}

function markFailed(jobId: string, reason: string) {
  return prisma.publishJob.update({
    where: { id: jobId },
    data: { status: "FAILED", lastError: reason.slice(0, 500) },
  });
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
