import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { LIMITS, type Platform } from "../../src/lib/publish/format-check";

// 技能工作流执行（Easel 对齐：选技能=选工作流）。
// 简化同 planner：SKILL.md 全文进 prompt，pi --no-tools 单轮直出 JSON（零工具面，无写盘越权风险）。
// 产物契约：{platforms:[{platform,title,body,tags,format,mediaNote}]}，采纳由 API 侧逐平台走既有 variants 闸。

export interface SkillDraft {
  platform: Platform;
  title: string;
  body: string;
  tags: string[];
  /** IMAGE_TEXT | VIDEO：形式跟着技能走 */
  format: "IMAGE_TEXT" | "VIDEO";
  /** 媒体要求说明（如「需要 1 张封面」「需要 15s 内竖版视频」） */
  mediaNote: string;
}

export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
}

const PI_TIMEOUT_MS = 300_000;
const SKILLS_DIR = path.join(process.cwd(), "server", "publish", "skills");

/** 读 vendor 的 5 技能清单（SKILL.md frontmatter name/description） */
export function listSkills(): SkillInfo[] {
  const out: SkillInfo[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const slug of dirs) {
    try {
      const raw = fs.readFileSync(path.join(SKILLS_DIR, slug, "SKILL.md"), "utf8");
      const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? slug;
      const descRaw = raw.match(/^description:\s*(?:>?\s*)?\n?((?:\s+[^\n]+\n?)+)/m);
      const description = descRaw ? descRaw[1].trim().split(/\s+/).join(" ").slice(0, 120) : "";
      out.push({ slug, name, description });
    } catch {
      // 缺 SKILL.md 的目录跳过
    }
  }
  return out;
}

/** 读某技能 SKILL.md 全文（进 prompt；文件缺失直接抛） */
export function readSkill(slug: string): string {
  const p = path.join(SKILLS_DIR, slug, "SKILL.md");
  if (!fs.existsSync(p)) throw new Error(`技能不存在：${slug}`);
  return fs.readFileSync(p, "utf8");
}

function runPi(prompt: string): Promise<string> {
  const piBin = process.env.PUBLISH_PI_BIN || "pi";
  const model = process.env.PUBLISH_PLANNER_MODEL || "agnes-plan/agnes-3.0-flash";
  return new Promise((resolve, reject) => {
    // stdin=ignore（pi 检测 stdin 关闭才以非交互收尾，pipe 式 stdin 会永久挂起）
    const child = spawn(
      piBin,
      ["-p", prompt, "--no-tools", "--model", model, "--thinking", "off", "--session-dir", "data/publish/plans/pi-sessions"],
      {
        cwd: process.cwd(),
        env: { ...process.env, PUBLISH_PI_NONINTERACTIVE: "1" },
        timeout: PI_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      }
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

/** 首个平衡 JSON 对象提取（字符串内花括号不算；容忍代码围栏/前后杂音） */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const text = raw.replace(/```json|```/g, "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`技能输出无 JSON：${raw.slice(-200)}`);
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
  if (end < 0) throw new Error(`技能 JSON 未闭合：${raw.slice(-200)}`);
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

export interface SkillRunResult {
  platforms: SkillDraft[];
  /** agent 对整稿的备注/风险提示 */
  note: string;
}

/** 执行技能工作流：读 Post 源内容 + SKILL.md 全文 → pi 出多平台草稿 JSON */
export async function runSkillWorkflow(postId: string, skillSlug: string): Promise<SkillRunResult> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error("post not found");
  const skillMd = readSkill(skillSlug);

  const limitsBlock = (Object.keys(LIMITS) as Platform[])
    .map((p) => {
      const l = LIMITS[p];
      const lines: string[] = [];
      if (l.titleLen) lines.push(`标题≤${l.titleLen}字`);
      if (l.bodyLen) lines.push(`正文≤${l.bodyLen}字`);
      if (l.tagCount) lines.push(`标签≤${l.tagCount}个`);
      if (l.mediaCount) lines.push(`图片≤${l.mediaCount}张`);
      if (l.mediaMin) lines.push(`图片至少${l.mediaMin}张（图文形式时）`);
      return `${p}：${lines.join("，") || "无硬上限"}`;
    })
    .join("；");

  const prompt = [
    `你是社媒内容工作流执行器。下面是选中的技能（SKILL.md 全文），按它的步骤与产出规范执行。`,
    ``,
    `## 技能：${skillSlug}`,
    skillMd,
    ``,
    `## 源内容（Post）`,
    `标题：${post.title}`,
    `正文：${post.body}`,
    `媒体：${post.mediaPaths.length ? post.mediaPaths.join("、") : "无"}`,
    ``,
    `## 目标平台硬约束（超限会被发布脚本拦截，方案必须满足）`,
    limitsBlock,
    ``,
    `## 产物契约（只输出一个 JSON 对象，不要 markdown 代码块/解释）`,
    `{ "platforms": [ { "platform": "XHS"|"DOUYIN"|"GZH", "title": "...", "body": "...", "tags": ["..."], "format": "IMAGE_TEXT"|"VIDEO", "mediaNote": "需要什么样的媒体（如：需要 1 张封面图 / 需要 15 秒内竖版视频 / 无媒体要求）" } ], "note": "整体备注/风险提示（可空）" }`,
    ``,
    `要求：`,
    `- 只出技能适用的平台（该技能是小红书的就只出 XHS；通用技能按源内容相关性出 1-3 个平台）`,
    `- GZH 暂不接入发布（P2），若技能含 GZH 稿可出但 mediaNote 注明「GZH 未接入，仅预览」`,
    `- 每条 title/body 必须满足上面对应平台的硬约束（先数好再写）`,
    `- 按技能步骤把源内容改写成该平台风格，不要照抄源内容`,
  ].join("\n");

  const raw = await runPi(prompt);
  const obj = extractJsonObject(raw);
  const arr = Array.isArray(obj.platforms) ? obj.platforms : [];
  const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
  const platforms: SkillDraft[] = arr
    .map((x) => {
      const o = x as Record<string, unknown>;
      const platform = (["XHS", "DOUYIN", "GZH"] as const).includes(o.platform as Platform)
        ? (o.platform as Platform)
        : null;
      if (!platform) return null;
      const format = o.format === "VIDEO" ? "VIDEO" : "IMAGE_TEXT";
      return {
        platform,
        title: str(o.title),
        body: str(o.body),
        tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [],
        format,
        mediaNote: str(o.mediaNote, format === "VIDEO" ? "需要视频文件" : "需要至少 1 张图片"),
      };
    })
    .filter((x): x is SkillDraft => x !== null);
  if (platforms.length === 0) throw new Error("技能输出缺少可用的平台草稿");
  return { platforms, note: str(obj.note) };
}
