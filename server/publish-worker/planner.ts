import { spawn } from "node:child_process";
import { prisma } from "../db";
import { LIMITS, type Platform } from "../../src/lib/publish/format-check";

// 规划层（Easel「策划」层对齐，P2 底座 pi 内嵌提前落地）：
// 读 Variant+Post+AccountProfile+平台字数约束，spawn `pi -p` 非交互（--no-tools），
// 让模型输出结构化发布方案 JSON。工具面 YAGNI：只给数据不给文件/发布工具。
// 模型走本机 pi 注册表（env PUBLISH_PLANNER_MODEL，默认 agnes；百炼 key 不用）。

export interface PublishPlan {
  angle: string; // 切入角度（一句话）
  format: string; // 建议形式（图文/视频/长文）
  titles: string[]; // 标题候选（已按平台字数约束截断）
  bodyOutline: string; // 正文骨架/要点
  tags: string[]; // 标签建议（≤平台上限）
  timeliness: string; // 时效提醒（如「热点 24h 内发布」）
}

const PI_TIMEOUT_MS = 180_000;

const PLATFORM_NAME: Record<Platform, string> = {
  GZH: "微信公众号",
  DOUYIN: "抖音",
  XHS: "小红书",
};

/** 组装给 pi 的规划 prompt（纯文本，无工具调用——-p --no-tools 单轮直出） */
export function buildPlanPrompt(input: {
  platform: Platform;
  title: string;
  body: string;
  tags: string[];
  mediaCount: number;
  profile: { handle: string; positioning: string; style: string; tone: string } | null;
}): string {
  const lim = LIMITS[input.platform];
  const profile = input.profile
    ? `账号画像（${input.profile.handle}）：定位=${input.profile.positioning}；风格=${input.profile.style}；语气=${input.profile.tone}`
    : "账号画像：未设置（按该平台的通用优质内容标准出方案）";
  const lines = [
    `你是社媒内容策划。为「${PLATFORM_NAME[input.platform]}」平台出一份可直接采纳的发布方案。`,
    ``,
    `素材（当前内容草稿）：`,
    `- 标题：${input.title}`,
    `- 正文：${input.body || "（空）"}`,
    `- 现有标签：${input.tags.length ? input.tags.join("、") : "无"}`,
    `- 媒体数量：${input.mediaCount}`,
    ``,
    profile,
    ``,
    `平台硬约束（方案必须满足，数值来自 Easel platform-specs，超限会被发布脚本拦截）：`,
  ];
  if (lim.titleLen) lines.push(`- 标题 ≤${lim.titleLen} 全角字`);
  if (lim.bodyLen) lines.push(`- 正文 ≤${lim.bodyLen} 字`);
  if (lim.tagCount) lines.push(`- 标签 ≤${lim.tagCount} 个`);
  if (lim.mediaCount) lines.push(`- 图片 ≤${lim.mediaCount} 张`);
  lines.push(
    ``,
    `只输出一个 JSON 对象（不要 markdown 代码块、不要解释），字段：`,
    `{ "angle": "切入角度一句话", "format": "建议形式(图文/短视频/长文)", "titles": ["候选1","候选2","候选3"], "bodyOutline": "正文骨架(150字内)", "tags": ["标签1","标签2"], "timeliness": "时效提醒" }`,
    lim.titleLen ? `titles 每条不超过 ${lim.titleLen} 个全角字符；` : "",
    lim.tagCount ? `tags 不超过 ${lim.tagCount} 个。` : ""
  );
  return lines.join("\n");
}

function runPi(prompt: string): Promise<string> {
  const piBin = process.env.PUBLISH_PI_BIN || "pi";
  const model = process.env.PUBLISH_PLANNER_MODEL || "agnes-plan/agnes-3.0-flash";
  return new Promise((resolve, reject) => {
    // stdin=ignore（关键：pi 检测 stdin 关闭才以非交互收尾，pipe 式 stdin 会永久挂起）
    const child = spawn(
      piBin,
      ["-p", prompt, "--no-tools", "--model", model, "--thinking", "off", "--session-dir", "data/publish/plans/pi-sessions"],
      { cwd: process.cwd(), env: { ...process.env, PUBLISH_PI_NONINTERACTIVE: "1" }, timeout: PI_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => reject(new Error(`pi spawn 失败：${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`pi 退出 ${code}：${(err || out).slice(-300)}`));
    });
  });
}

/** 从 pi stdout 提取 JSON（容忍代码围栏/前后杂音；取首个平衡 {} 对象，避开贪婪匹配吃到后续文本） */
export function parsePlan(raw: string): PublishPlan {
  const text = raw.replace(/```json|```/g, "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`规划输出无 JSON：${raw.slice(-200)}`);
  // 首个平衡对象：逐字符匹配花括号（字符串内的花括号不算）
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`规划 JSON 未闭合：${raw.slice(-200)}`);
  const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    angle: str(obj.angle),
    format: str(obj.format, "图文"),
    titles: arr(obj.titles),
    bodyOutline: str(obj.bodyOutline),
    tags: arr(obj.tags),
    timeliness: str(obj.timeliness, "无特殊时效"),
  };
}

export async function planVariant(variantId: string, opts?: { force?: boolean }): Promise<{ plan: PublishPlan; cached: boolean }> {
  const variant = await prisma.postVariant.findUnique({
    where: { id: variantId },
    include: { post: true },
  });
  if (!variant) throw new Error("variant not found");

  // 保留策略：方案生成一次后存 variant.plan，再次请求直接返缓存（不重跑模型）；
  // force=true 才重新生成并覆盖；置 null = 撤销（API DELETE）
  if (!opts?.force && variant.plan) {
    try {
      return { plan: JSON.parse(variant.plan) as PublishPlan, cached: true };
    } catch {
      // 存量脏 JSON：降级为重新生成
    }
  }

  // 画像：同平台同 user 的 AccountProfile（P1 只存不消费——规划层首次消费）
  const profile = await prisma.accountProfile.findFirst({
    where: { platform: variant.platform, userId: variant.post.userId },
  });
  const prompt = buildPlanPrompt({
    platform: variant.platform,
    title: variant.title,
    body: variant.body,
    tags: variant.tags,
    mediaCount: variant.post.mediaPaths.length,
    profile: profile
      ? { handle: profile.handle, positioning: profile.positioning, style: profile.style, tone: profile.tone }
      : null,
  });
  const raw = await runPi(prompt);
  const plan = parsePlan(raw);
  // 写回持久化（一次生成，后续不再跑模型）
  await prisma.postVariant.update({
    where: { id: variantId },
    data: { plan: JSON.stringify(plan) },
  });
  return { plan, cached: false };
}
