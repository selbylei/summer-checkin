import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
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
  /** SKILL.md frontmatter description（截断 120 字） */
  description: string;
  /** 简短中文说明（description 首句，≤40 字）——左侧技能选择器用 */
  short: string;
  /** 技能层（Easel frontmatter layer：produce/publish 等） */
  layer: string;
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
      .map((d) => d.name); // 2026-10-15 拍板：毛筆入口列全部技能，不再限首批 5 个
  } catch {
    return out;
  }
  for (const slug of dirs) {
    try {
      const raw = fs.readFileSync(path.join(SKILLS_DIR, slug, "SKILL.md"), "utf8");
      const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? slug;
      const descRaw = raw.match(/^description:\s*(?:[>|]\s*)?\n?((?:\s+[^\n]+\n?)+)/m);
      const fullDesc = (descRaw ? descRaw[1].trim().split(/\s+/).join(" ") : "").replace(/^["'|\s]+|["']\s*$/g, "");
      const description = fullDesc.slice(0, 120);
      // 短说明：description 首句（按 。/； 截断），去掉「当用户说…时使用」类触发器尾巴，限 40 字
      const short = (fullDesc.split(/。|；/)[0] ?? fullDesc)
        .replace(/当用户说.*$/, "")
        .replace(/适用场景[:：].*$/, "")
        .replace(/^"|"$/g, "")
        .trim()
        .slice(0, 40);
      const layer = raw.match(/^layer:\s*(\S+)/m)?.[1] ?? "";
      out.push({ slug, name, description, short: short || description.slice(0, 40), layer });
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
  /** 已确认内容方案的 JSON（方案流：先定方案后生成） */
  planCtx?: string,
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
  if (planCtx) prompt.push(``, `## 已确认内容方案（按此方案的定位/平台/形式出稿）`, planCtx);
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

/** 内容方案（规划层产物：先定方案，方案自动映射技能再生成——Easel 策划层对齐） */
export interface ContentPlan {
  id: string;
  /** 方案名（≤12 字） */
  name: string;
  /** 一句话说明（平台+形式+角度，≤40 字） */
  desc: string;
  platform: "XHS" | "DOUYIN" | "GZH";
  format: "IMAGE_TEXT" | "VIDEO";
  /** 方案绑定的工作流技能 slug */
  skill: string;
  mediaNote: string;
}

/** 技能目录（规划 prompt 用：slug + 短说明） */
function planSkillCatalog(): string {
  return listSkills()
    .map((s) => `- ${s.slug}：${s.short || s.name}`)
    .join("\n");
}

/** 规范化方案列表（skill 白名单过滤、平台/形式归一；空则丢弃） */
function normalizePlans(obj: Record<string, unknown>): ContentPlan[] {
  const arr = Array.isArray(obj.plans) ? obj.plans : [];
  const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
  const validSkills = new Set(listSkills().map((s) => s.slug));
  const out: ContentPlan[] = [];
  arr.forEach((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const skill = String(o.skill ?? "").trim();
    if (!validSkills.has(skill)) return; // 方案必须落在真实存在的技能上（全量，不限首批）
    const platform = (["XHS", "DOUYIN", "GZH"] as const).includes(o.platform as "XHS") ? (o.platform as "XHS" | "DOUYIN" | "GZH") : "XHS";
    out.push({
      id: str(o.id, `p${i + 1}`),
      name: str(o.name, `方案${i + 1}`).slice(0, 16),
      desc: str(o.desc),
      platform,
      format: o.format === "VIDEO" ? "VIDEO" : "IMAGE_TEXT",
      skill,
      mediaNote: str(o.mediaNote),
    });
  });
  return out;
}

/**
 * 规划回合（先方案后技能）：pi 按源内容+用户要求出 3 个可执行方案 JSON（不生成内容）。
 * 方案写盘 chats/<chatId>/plans.json（刷新可恢复）；规划用独立 pi 会话目录（与生成会话互不污染）。
 */
export async function runPlanSession(
  postId: string,
  chatId: string,
  userAsk: string,
  focus?: { name: string; platform: string; format: string; skill: string; mediaNote?: string },
): Promise<{ plans: ContentPlan[]; reply: string }> {
  assertChatId(chatId);
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error("post not found");

  const chatDir = chatDirOf(postId, chatId);
  const planDir = path.join(chatDir, "plan-sessions");
  const plansFile = path.join(chatDir, "plans.json");
  fs.mkdirSync(planDir, { recursive: true });
  const hasSession = fs.readdirSync(planDir).some((f) => f.endsWith(".jsonl"));

  // focus=点了固定模板卡 → 只出 1 个该方向方案；否则默认 3 个不同方向
  const count = focus ? 1 : 3;
  const prompt = [
    focus
      ? `你是内容策划。用户已选定方案方向「${focus.name}」，细化出 1 个可执行的内容方案（只出方案，不生成正文）。`
      : `你是内容策划。基于下面的源内容与用户要求，设计 ${count} 个可执行的内容方案（只出方案，不生成正文）。`,
    ``,
    `## 源内容`,
    `标题：${post.title}`,
    `正文：${post.body}`,
    `媒体：${post.mediaPaths.length ? post.mediaPaths.join("、") : "无"}`,
    ``,
    `## 用户要求`,
    userAsk || (focus ? `按模板「${focus.name}」（${focus.platform}/${focus.format}，技能 ${focus.skill}${focus.mediaNote ? `，媒体要求：${focus.mediaNote}` : ""}）细化 1 个方案` : `推荐 ${count} 个不同方向/形式的方案`),
    ``,
    `## 可选工作流技能（方案的 skill 必须是其一）`,
    planSkillCatalog(),
    ``,
    `## 产物契约（在回复末尾原样输出 JSON，不要代码围栏）`,
    `{ "plans": [ { "id": "p1", "name": "方案名（≤12字）", "desc": "一句话：平台+形式+角度（≤40字）", "platform": "XHS|DOUYIN|GZH", "format": "IMAGE_TEXT|VIDEO", "skill": "技能slug", "mediaNote": "媒体要求" } × ${count} ] }`,
    focus ? `要求：只出 1 个方案，方向=模板定死的平台/形式/技能；desc 可更具体（角度/钩子/结构）。` : `要求：${count} 个方案方向/形式互不重复；只出技能适用的平台。`,
    `硬性：不要用任何工具写/建/改任何文件（包括记忆/日志/留痕类 .md），也不要输出「留痕」行；只把方案 JSON 输出在回复里。`,
  ].join("\n");

  const args = ["-p", prompt, "--no-mcp", "--model", resolveModel(), "--thinking", "off", "--session-dir", planDir];
  if (hasSession) args.push("--continue");
  const raw = await runPi(args);

  const obj = parseDraftObject(raw, plansFile);
  const plans = normalizePlans(obj);
  if (plans.length === 0) throw new Error("规划输出无可用方案");
  fs.writeFileSync(plansFile, JSON.stringify({ plans }, null, 2));
  const reply = stripTrailingPlanJson(raw) || `已出 ${plans.length} 个方案，选一个开始生成。`;
  return { plans, reply };
}

/** 列某纪录最近一次规划的方案（刷新恢复选择卡） */
export function listChatPlans(postId: string, chatId: string): ContentPlan[] {
  assertChatId(chatId);
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(chatDirOf(postId, chatId), "plans.json"), "utf8")) as { plans?: unknown };
    return normalizePlans(obj);
  } catch {
    return [];
  }
}

/** 去掉回复尾部的方案 JSON（与出稿 JSON 同一套尾剥离，认 plans 键） */
export function stripTrailingPlanJson(raw: string): string {
  const text = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  const end = text.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let jsonStart = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) {
        jsonStart = i;
        break;
      }
    }
  }
  if (jsonStart >= 0 && /\"plans\"/.test(text.slice(jsonStart, end))) {
    const before = text.slice(0, jsonStart).trim();
    return before;
  }
  return text.trim();
}

export interface SessionChatResult {
  /** agent 回复文本（可能含产物 JSON，UI 只展示文本） */
  reply: string;
  /** 本次会话所属的聊天记录 id（响应回传，UI 落回左栏） */
  chatId?: string;
  /** 本轮产物有更新时返回（agent 重写 drafts 文件后读回）；纯问答无更新则 undefined */
  platforms?: SkillDraft[];
  note?: string;
}



/* ── 聊天记录（Easel Sidebar 对齐：一帖多条纪录，左栏=聊天记录；每条纪录独立 pi 会话+独立出稿）──
 * 布局：data/publish/drafts/<postId>/chats/<chatId>/
 *   meta.json      纪录元信息（标题/技能/首条要求，建纪录时写）
 *   pi-sessions/   pi 会话文件（.jsonl，--continue 续跑）
 *   <skill>.json   该纪录的出稿（agent write 落盘）
 */
const CHAT_ID_RE = /^c[0-9a-f]{12}$/;

export function newChatId(): string {
  return "c" + randomBytes(6).toString("hex");
}

function assertChatId(chatId: string): void {
  if (!CHAT_ID_RE.test(chatId)) throw new Error(`chatId 非法：${chatId}`);
}

export const chatDirOf = (postId: string, chatId: string) => path.join(DRAFTS_DIR, postId, "chats", chatId);

export interface ChatMeta {
  chatId: string;
  skill: string;
  /** 纪录标题（首条要求截 24 字） */
  title: string;
  /** 首条用户要求原文（历史恢复时替代工作流 prompt 展示） */
  firstAsk: string;
  createdAtMs: number;
}

export interface ChatRecord {
  chatId: string;
  title: string;
  skill: string;
  mtimeMs: number;
  /** 有实际内容（pi 会话/出稿/方案）——一内容一会话合并时优先保留有内容的纪录 */
  hasContent: boolean;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

function writeChatMeta(postId: string, chatId: string, skillSlug: string, firstAsk: string, title?: string): void {
  const dir = chatDirOf(postId, chatId);
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    const meta: ChatMeta = {
      chatId,
      skill: skillSlug,
      // 纪录名=源内容标题（用户口径：左侧直接显示源标题）；无标题才回退首条要求
      title: title || (firstAsk || `会话·${skillSlug}`).replace(/\s+/g, " ").slice(0, 24),
      firstAsk,
      createdAtMs: Date.now(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return;
  }
  // 回填：自动建纪录时 firstAsk/skill 还是空，首轮 pi 跑时补上（历史展示首条 user=firstAsk）
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Partial<ChatMeta>;
    let changed = false;
    if (!meta.firstAsk && firstAsk) { meta.firstAsk = firstAsk; changed = true; }
    if (!meta.skill && skillSlug) { meta.skill = skillSlug; changed = true; }
    if (changed) fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    /* 坏 meta 不动 */
  }
}

/** 新建一条空聊天记录（sidebar「新对话」；先落 meta，首条消息才起 pi 会话） */
export function createChat(postId: string, chatId: string, title: string, skill = ""): void {
  assertChatId(chatId);
  writeChatMeta(postId, chatId, skill, "", title);
}

/** 改聊天记录名（sidebar 重命名） */
export function renameChat(postId: string, chatId: string, title: string): void {
  assertChatId(chatId);
  const metaFile = path.join(chatDirOf(postId, chatId), "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as Partial<ChatMeta>;
  meta.title = title.slice(0, 40);
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
}

/** 删聊天记录（含 pi 会话+出稿） */
export function deleteChat(postId: string, chatId: string): void {
  assertChatId(chatId);
  fs.rmSync(chatDirOf(postId, chatId), { recursive: true, force: true });
}

/** 列某 Post 的聊天记录（左栏纪录列表；按最后活跃倒序） */
export function listPostChats(postId: string): ChatRecord[] {
  const base = path.join(DRAFTS_DIR, postId, "chats");
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && CHAT_ID_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: ChatRecord[] = [];
  for (const chatId of dirs) {
    const dir = path.join(base, chatId);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    // 最后活跃=目录下最新文件（pi 会话 .jsonl / 出稿 / meta）
    let mtimeMs = 0;
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(dir, f));
        mtimeMs = Math.max(mtimeMs, st.mtimeMs);
      } catch {
        /* 文件被清理跳过 */
      }
    }
    let title = chatId;
    let skill = "";
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as Partial<ChatMeta>;
      title = meta.title || title;
      skill = meta.skill || "";
    } catch {
      /* 无 meta（旧数据）用 chatId 顶 */
    }
    // 有实际内容：pi 会话 .jsonl / 出稿 .json / 方案 plans.json（meta.json 不算）
    let hasContent = files.some((f) => f === "plans.json" || (f.endsWith(".json") && f !== "meta.json"));
    if (!hasContent) {
      try {
        hasContent = fs.readdirSync(path.join(dir, "pi-sessions"), { withFileTypes: true }).some((d) => d.name.endsWith(".jsonl"));
      } catch {
        /* 无会话目录=无内容 */
      }
    }
    out.push({ chatId, title, skill, mtimeMs, hasContent });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** 读聊天记录的消息历史（解析 pi 会话 .jsonl；首条 user=工作流 prompt，用 meta.firstAsk 替代展示） */
export function readChatHistory(postId: string, chatId: string): ChatHistoryMessage[] {
  assertChatId(chatId);
  const chatDir = chatDirOf(postId, chatId);
  const piDir = path.join(chatDir, "pi-sessions");
  const planDir = path.join(chatDir, "plan-sessions");
  // 两路会话（pi-sessions=生成回合 / plan-sessions=规划回合）合并，时间戳前缀字典序交错=真实聊天顺序
  //（刷新恢复后规划回合不丢，修「二次进入聊天内容不一致」）
  const named: Array<{ file: string; text: string; isPlan: boolean }> = [];
  for (const isPlan of [false, true]) {
    const dir = isPlan ? planDir : piDir;
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      let text = "";
      try {
        text = fs.readFileSync(path.join(dir, f), "utf8");
      } catch {
        continue;
      }
      named.push({ file: f, text, isPlan });
    }
  }
  if (named.length === 0) return [];
  named.sort((a, b) => (a.file < b.file ? -1 : 1));
  let firstAsk = "";
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(chatDir, "meta.json"), "utf8")) as Partial<ChatMeta>;
    firstAsk = meta.firstAsk ?? "";
  } catch {
    /* 无 meta 原样展示 */
  }
  const out: ChatHistoryMessage[] = [];
  let piUserSeen = false; // 生成回合的首条 user=工作流 prompt 口径
  for (const entry of named) {
    const lines = entry.text.split("\n").filter((l) => l.trim());
    let firstUserText = "";
    const events: Array<{ role: "user" | "assistant"; text: string; ts: string }> = [];
    for (const line of lines) {
      let obj: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type !== "message" || !obj.message) continue;
      const role = obj.message.role;
      const ts = obj.timestamp ?? "";
      if (role === "user") {
        const raw = contentText(obj.message.content);
        if (!firstUserText) firstUserText = raw;
      } else if (role === "assistant") {
        // 规划回合回复=剥离尾部方案 JSON（展示口径同 done 回执）
        const text = (entry.isPlan ? stripTrailingPlanJson(contentText(obj.message.content)) : contentText(obj.message.content)).trim();
        if (text) events.push({ role: "assistant", text, ts });
      }
    }
    if (entry.isPlan) {
      // 规划回合 user 展示：focus 模板「按「X」出方案」；自由文本=「用户要求」段原文
      const focusM = /按模板「([^」]+)」/.exec(firstUserText);
      let userText = focusM ? `按「${focusM[1]}」出方案` : "";
      if (!userText) {
        const askM = /## 用户要求\n([\s\S]*?)\n##/.exec(firstUserText);
        userText = (askM?.[1] ?? "").trim().replace(/推荐\s*\d+\s*个.*$/, "").trim();
      }
      if (userText) events.unshift({ role: "user", text: userText, ts: "" });
    } else {
      if (!piUserSeen) {
        piUserSeen = true;
        // 首条=工作流 prompt（agent 侧构造）：展示用户原始要求；firstAsk 空（自动建纪录遗留）不贴整段 prompt
        const text = firstAsk || "（首轮生成）";
        events.unshift({ role: "user", text, ts: "" });
      } else {
        const raw = firstUserText;
        let text: string;
        if (raw.includes("用户新要求：")) {
          const seg = raw.split("用户新要求：")[1] ?? "";
          text = seg.split(/\n\s*规则：/)[0].trim() || seg.trim();
        } else {
          text = raw;
        }
        if (text) events.unshift({ role: "user", text, ts: "" });
      }
    }
    for (const e of events) out.push({ role: e.role, content: e.text, ts: e.ts });
  }
  return out;
}

/** 消息 content（string 或 blocks 数组）取文本（只收 text 块；thinking/toolCall 不算回复） */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text?: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

/**
 * 流式过程显示：dir 下最新 pi 会话文件的 assistant 文本 + 工具调用（→ 动作行），逐字进聊天气泡。
 * pi 会话 jsonl 边跑边写；返 {file, text} 供 tick 识别文件切换（新文件=全新基线，不丢增量）。
 */
export function liveAssistantTexts(dir: string): { file: string; text: string } {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return { file: "", text: "" };
  }
  const newest = files[files.length - 1] ?? "";
  if (!newest) return { file: "", text: "" };
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(path.join(dir, newest), "utf8").split("\n");
  } catch {
    return { file: newest, text: "" };
  }
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "message" || obj.message?.role !== "assistant") continue;
    {
      const blocks = Array.isArray(obj.message.content)
        ? (obj.message.content as { type?: string; text?: string; name?: string; arguments?: unknown }[])
        : [];
      for (const b of blocks) {
        if (b.type === "text" && b.text) out.push(b.text);
        else if (b.type === "toolCall" && b.name) {
          // 工具调用=过程动作（「→ 写草稿 draft.json」），跟正常 AI 聊天显示过程的口径
          const args = (b.arguments ?? {}) as Record<string, unknown>;
          const target =
            typeof args.path === "string"
              ? args.path.split("/").slice(-2).join("/")
              : typeof args.command === "string"
                ? String(args.command).slice(0, 40)
                : "";
          out.push(`→ 执行 ${b.name}${target ? `：${target}` : ""}`);
        }
      }
    }
  }
  return { file: newest, text: out.join("\n") };
}

/** 某聊天记录自己的出稿（chats/<chatId>/*.json；meta.json 不算） */
export function listChatDrafts(postId: string, chatId: string): { skill: string; platforms: SkillDraft[]; note: string; mtimeMs: number }[] {
  assertChatId(chatId);
  const dir = chatDirOf(postId, chatId);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "meta.json");
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

/**
 * 发布会话聊天（Easel 对齐：一帖多条聊天记录，多条多轮对话迭代草稿）。
 * 首回合（该纪录无 pi 会话）= 全量工作流 prompt（可带用户附加要求）+ 写 meta；后续回合 --continue 续跑同会话。
 * 草稿更新以 agent 写盘的 chats/<chatId>/<skill>.json 为准（回复文本解析 JSON 失败时读盘）。
 */
export async function runSessionChat(
  postId: string,
  chatId: string,
  skillSlug: string,
  userAsk: string,
  /** 已确认内容方案（首回合注入 prompt；自动映射自方案→技能） */
  plan?: ContentPlan,
): Promise<SessionChatResult> {
  assertChatId(chatId);
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error("post not found");
  readSkill(skillSlug);

  const chatDir = chatDirOf(postId, chatId);
  const draftFile = path.join(chatDir, `${skillSlug}.json`);
  const sessionDir = path.join(chatDir, "pi-sessions");
  fs.mkdirSync(sessionDir, { recursive: true });
  const hasSession = fs.readdirSync(sessionDir).some((f) => f.endsWith(".jsonl"));
  if (!hasSession) writeChatMeta(postId, chatId, skillSlug, userAsk, post.title);

  const prompt = hasSession
    ? [
        `继续本发布会话（上下文已有技能 ${skillSlug}、源内容与当前草稿）。用户新要求：`,
        userAsk,
        ``,
        `规则：`,
        `- 需调整草稿时：按产物契约格式用 write 工具重写 ${draftFile}，并在回复末尾原样输出更新后的完整产物 JSON`,
        `- 纯问答/无需改稿时：简短回答即可，不要输出 JSON`,
        `- 除 ${draftFile} 外不写/建/改任何文件（包括记忆/日志/留痕类 .md），回复里也不要附「留痕」行`,
      ].join("\n")
    : buildWorkflowPrompt(
        post,
        skillSlug,
        draftFile,
        userAsk || undefined,
        plan ? JSON.stringify(plan, null, 2) : undefined,
      );

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
  // 展示层剥离：agent 回复可能以产物 JSON 收尾（回复=说明+JSON），UI 只留说明文本，出稿看右侧出稿卡
  const displayReply = stripTrailingDraftJson(raw);
  return { reply: displayReply, platforms, note, chatId };
}

/** 去掉回复尾部贴的产物草稿 JSON（agent 按产物契约在回复末尾原样输出 JSON；UI 不展示原始 JSON） */
function stripTrailingDraftJson(raw: string): string {
  const text = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  // 从末尾往前找最后一个平衡 JSON 对象（字符串内花括号不算）；找到且其后只有空白/围栏 → 截掉
  const end = text.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let jsonStart = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) {
        jsonStart = i;
        break;
      }
    }
    void ch;
  }
  // 只认「含 platforms 键」的草稿 JSON，避免误伤说明文本里的小对象
  if (jsonStart >= 0 && /\"platforms\"/.test(text.slice(jsonStart, end))) {
    const before = text.slice(0, jsonStart).trim();
    return before || "（已按你的要求更新出稿，见右侧出稿卡）";
  }
  return text.trim();
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
