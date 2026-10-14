import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { LIMITS, type Platform } from "../../src/lib/publish/format-check";

// 技能工作流执行（Easel 对齐：选技能=选工作流；完整树 vendor，agent 自读 SKILL.md 照流程执行）。
// 执行面：pi headless + 工具面 read,write 最小化（references/兄弟技能/shared 共享层按需读；P1 不出图不真发）。
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
// 辅助共享层 server/publish/shared/（Easel workspace/shared 同构：skills/<slug>/ 内 `../../shared/...` 相对引用可解）
/** 产物目录：data/publish/drafts/<postId>/<skill>.json（.gitignore 已覆盖 data/publish/） */
const DRAFTS_DIR = path.join(process.cwd(), "data", "publish", "drafts");

/** 选技能=选工作流：全量库（114 技能）已 vendor，agent 执行中按需自读；选择器只列首批 5 个工作流技能，
 * 避免 114 个卡片刷屏（新增可选技能 = 往这里加一行） */
export const WORKFLOW_SKILLS = [
  "xhs-note-creator",
  "card-xiaohongshu",
  "skill-douyin-upload",
  "copywriting",
  "post-formatter",
] as const;

/** 读 vendor 的工作流技能清单（SKILL.md frontmatter name/description） */
export function listSkills(): SkillInfo[] {
  const out: SkillInfo[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => (WORKFLOW_SKILLS as readonly string[]).includes(n));
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

/** 读某技能 SKILL.md 全文（调试/校验用；执行走 pi --skill 原生发现） */
export function readSkill(slug: string): string {
  const p = path.join(SKILLS_DIR, slug, "SKILL.md");
  if (!fs.existsSync(p)) throw new Error(`技能不存在：${slug}`);
  return fs.readFileSync(p, "utf8");
}

/**
 * pi 执行参数（Easel 对齐：--skill 原生技能发现，agent 自读 SKILL.md 照流程执行；
 * 工具面 read,write 最小化——references/兄弟技能/shared 共享层按需 read；write 仅写 drafts 产物；
 * 无 bash/edit → P1 不出图不真发，脚本步骤由 agent 按 references 口径自核替代）。
 * sessionDir：发布会话 per-post（data/publish/drafts/<postId>/pi-sessions），默认全局 plans 目录（ai-plan 旧口径）。
 */
export function buildPiArgs(prompt: string, skillSlug: string, model: string, sessionDir?: string): string[] {
  return [
    "-p",
    prompt,
    "--skill",
    path.join(SKILLS_DIR, skillSlug),
    "--tools",
    "read,write",
    "--no-mcp",
    "--model",
    model,
    "--thinking",
    "off",
    "--session-dir",
    sessionDir ?? path.join(DRAFTS_DIR, "pi-sessions"),
  ];
}

function resolveModel(): string {
  return process.env.PUBLISH_PLANNER_MODEL || "agnes-plan/agnes-3.0-flash";
}

function runPi(args: string[]): Promise<string> {
  const piBin = process.env.PUBLISH_PI_BIN || "pi";
  const sessionDirIdx = args.indexOf("--session-dir");
  // 会话/产物目录就位（write 工具写 drafts/<postId>/ 前需父目录；pi --session-dir 同理）
  const sd = sessionDirIdx >= 0 ? args[sessionDirIdx + 1] : path.join(DRAFTS_DIR, "pi-sessions");
  fs.mkdirSync(sd, { recursive: true });
  return new Promise((resolve, reject) => {
    // stdin=ignore（pi 检测 stdin 关闭才以非交互收尾，pipe 式 stdin 会永久挂起）
    const child = spawn(
      piBin,
      args,
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

/** 平台硬约束文本（喂 prompt） */
function limitsBlock(): string {
  return (Object.keys(LIMITS) as Platform[])
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
}

/** 首回合全量 prompt（技能工作流 + 源内容 + 硬约束 + 产物契约）；userAsk 非空时追加用户要求 */
export function buildWorkflowPrompt(
  post: { title: string; body: string; mediaPaths: string[] },
  skillSlug: string,
  draftFile: string,
  userAsk?: string,
): string {
  const prompt = [
    `你是社媒内容工作流执行器。按技能 ${skillSlug}（已通过 --skill 加载；其 SKILL.md 及其引用的辅助文件均在技能目录内，先用 read 工具读完 SKILL.md 再按步骤执行）处理下面的源内容。`,
    ``,
    `## 源内容（Post）`,
    `标题：${post.title}`,
    `正文：${post.body}`,
    `媒体：${post.mediaPaths.length ? post.mediaPaths.join("、") : "无"}`,
    ``,
    `## 目标平台硬约束（超限会被发布脚本拦截，方案必须满足）`,
    limitsBlock(),
    ``,
    `## P1 执行边界`,
    `- 只出文案草稿：技能里需要跑 Python 脚本的步骤（渲染卡片/跑审计/真发布）不执行，按 references 的口径自查替代，mediaNote 写清媒体要求`,
    `- 不要写除产物 JSON 以外的任何文件`,
    ``,
    `## 产物契约`,
    `- 用 write 工具把产物 JSON 写到：${draftFile}`,
    `- 最后再在回复中原样输出同一个 JSON 对象（不要 markdown 代码块/解释）`,
    `{ "platforms": [ { "platform": "XHS"|"DOUYIN"|"GZH", "title": "...", "body": "...", "tags": ["..."], "format": "IMAGE_TEXT"|"VIDEO", "mediaNote": "需要什么样的媒体（如：需要 1 张封面图 / 需要 15 秒内竖版视频 / 无媒体要求）" } ], "note": "整体备注/风险提示（可空）" }`,
    ``,
    `要求：`,
    `- 只出技能适用的平台（该技能是小红书的就只出 XHS；通用技能按源内容相关性出 1-3 个平台）`,
    `- GZH 暂不接入发布（P2），若技能含 GZH 稿可出但 mediaNote 注明「GZH 未接入，仅预览」`,
    `- 每条 title/body 必须满足上面对应平台的硬约束（先数好再写）`,
    `- 按技能步骤把源内容改写成该平台风格，不要照抄源内容`,
  ];
  if (userAsk) prompt.push(``, `## 用户附加要求（随本次请求）`, userAsk);
  return prompt.join("\n");
}

/** 产物 JSON → 规范化草稿列表（平台白名单/形式归一/缺省值） */
export function normalizePlatforms(obj: Record<string, unknown>): SkillDraft[] {
  const arr = Array.isArray(obj.platforms) ? obj.platforms : [];
  const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
  return arr
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
        format: format as "IMAGE_TEXT" | "VIDEO",
        mediaNote: str(o.mediaNote, format === "VIDEO" ? "需要视频文件" : "需要至少 1 张图片"),
      };
    })
    .filter((x): x is SkillDraft => x !== null);
}

/** 执行技能工作流（首回合）：读 Post 源内容 → pi（--skill 原生发现 + read/write 工具面）按技能流程出多平台草稿 JSON */
export async function runSkillWorkflow(postId: string, skillSlug: string): Promise<SkillRunResult> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error("post not found");
  readSkill(skillSlug); // 存在性闸：技能缺失直接抛（不进 pi）

  const draftFile = path.join(DRAFTS_DIR, postId, `${skillSlug}.json`);
  // 会话 per-post（与 runSessionChat 同目录，首回合建会话，聊天续跑）
  const sessionDir = path.join(DRAFTS_DIR, postId, "pi-sessions");
  const prompt = buildWorkflowPrompt(post, skillSlug, draftFile);
  const raw = await runPi(buildPiArgs(prompt, skillSlug, resolveModel(), sessionDir));
  const obj = parseDraftObject(raw, draftFile);
  const platforms = normalizePlatforms(obj);
  if (platforms.length === 0) throw new Error("技能输出缺少可用的平台草稿");
  const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
  return { platforms, note: str(obj.note) };
}

/** stdout 优先解析，失败回退读盘上产物（agent 可能只写盘没在回复里复述 JSON） */
function parseDraftObject(raw: string, draftFile: string): Record<string, unknown> {
  try {
    return extractJsonObject(raw);
  } catch {
    const disk = fs.readFileSync(draftFile, "utf8");
    return extractJsonObject(disk);
  }
}

export interface SessionChatResult {
  /** agent 回复文本（可能含产物 JSON，UI 只展示文本） */
  reply: string;
  /** 本轮产物有更新时返回（agent 重写 drafts 文件后读回）；纯问答无更新则 undefined */
  platforms?: SkillDraft[];
  note?: string;
}

/**
 * 发布会话聊天（Easel 对齐：每个发布一个聊天会话，多轮对话迭代草稿）。
 * 首回合（该 post 无 pi 会话）= 全量工作流 prompt（可带用户附加要求）；后续回合 --continue 续跑同会话。
 * 草稿更新以 agent 写盘的 drafts/<postId>/<skill>.json 为准（回复文本解析 JSON 失败时读盘）。
 */
export async function runSessionChat(
  postId: string,
  skillSlug: string,
  userAsk: string,
): Promise<SessionChatResult> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error("post not found");
  readSkill(skillSlug);

  const draftFile = path.join(DRAFTS_DIR, postId, `${skillSlug}.json`);
  const sessionDir = path.join(DRAFTS_DIR, postId, "pi-sessions");
  fs.mkdirSync(path.join(DRAFTS_DIR, postId), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const hasSession = fs.readdirSync(sessionDir).some((f) => f.endsWith(".jsonl"));

  const prompt = hasSession
    ? [
        `继续本发布会话（上下文已有技能 ${skillSlug}、源内容与当前草稿）。用户新要求：`,
        userAsk,
        ``,
        `规则：`,
        `- 需调整草稿时：按产物契约格式用 write 工具重写 ${draftFile}，并在回复末尾原样输出更新后的完整产物 JSON`,
        `- 纯问答/无需改稿时：简短回答即可，不要输出 JSON`,
      ].join("\n")
    : buildWorkflowPrompt(post, skillSlug, draftFile, userAsk || undefined);

  const args = buildPiArgs(prompt, skillSlug, resolveModel(), sessionDir);
  if (hasSession) args.push("--continue");
  const raw = await runPi(args);

  // 产物更新：以盘上 drafts 文件为准（agent 每轮改稿后写盘）；无 JSON 不报错（纯问答）
  let platforms: SkillDraft[] | undefined;
  let note: string | undefined;
  try {
    const obj = parseDraftObject(raw, draftFile);
    if (obj && obj.platforms) {
      platforms = normalizePlatforms(obj);
      note = typeof obj.note === "string" ? obj.note : undefined;
    }
  } catch {
    // 本轮无产物 JSON（纯问答）——草稿保持旧版，UI 不动
  }
  return { reply: raw.trim(), platforms, note };
}

/** 列某 Post 的草稿文件（面板刷新页时重渲染出稿卡；MVP 聊天记录只在 pi 会话文件，不落 UI） */
export function listPostDrafts(postId: string): { skill: string; platforms: SkillDraft[]; note: string; mtimeMs: number }[] {
  const dir = path.join(DRAFTS_DIR, postId);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>;
        const st = fs.statSync(path.join(dir, f));
        return {
          skill: f.replace(/\.json$/, ""),
          platforms: normalizePlatforms(obj),
          note: typeof obj.note === "string" ? obj.note : "",
          mtimeMs: st.mtimeMs,
        };
      } catch {
        return null; // 坏文件跳过
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
