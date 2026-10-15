// Easel 1:1 复刻的数据层：Easel ChatSession/ChatMessage → 我们 worker 端点的映射。
// Easel 原版数据走 OpenClaw 网关流式；这里同步等待 worker /session-chat（300s 上限）。
import { publishFetch } from "../publish-shared";

/** Easel 技能（worker /skills：SKILL.md frontmatter 解析；选择器只列首批工作流技能） */
export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  short: string;
  layer: string;
}

/** 出稿（agent 写盘的 drafts 产物契约） */
export interface SkillDraft {
  platform: string;
  title: string;
  body: string;
  tags: string[];
  format: "IMAGE_TEXT" | "VIDEO";
  mediaNote: string;
}

export interface DraftFile {
  skill: string;
  platforms: SkillDraft[];
  note: string;
  mtimeMs: number;
}

export interface EaselMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface EaselChatRecord {
  chatId: string;
  title: string;
  skill: string;
  mtimeMs: number;
  /** worker /session-chats：有 pi 会话/出稿/方案（meta 不算） */
  hasContent?: boolean;
}

// 客户端生成 chatId（与 worker CHAT_ID_RE 同口径：c + 12 hex）
export function newLocalChatId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "c" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const easelApi = {
  listChats(postId: string) {
    return publishFetch<{ ok: boolean; chats?: EaselChatRecord[] }>(
      "/api/publish/session/chats?postId=" + encodeURIComponent(postId),
    ).then((r) => (r.ok ? (r.data?.chats ?? []) : []));
  },
  createChat(postId: string, chatId: string, title: string) {
    return publishFetch<{ ok: boolean; chatId?: string }>("/api/publish/session/chats", {
      method: "POST",
      body: JSON.stringify({ postId, chatId, title }),
    });
  },
  renameChat(postId: string, chatId: string, title: string) {
    return publishFetch<{ ok: boolean }>("/api/publish/session/rename", {
      method: "POST",
      body: JSON.stringify({ postId, chatId, title }),
    });
  },
  deleteChat(postId: string, chatId: string) {
    return publishFetch<{ ok: boolean }>("/api/publish/session/chats", {
      method: "DELETE",
      body: JSON.stringify({ postId, chatId }),
    });
  },
  history(postId: string, chatId: string) {
    return publishFetch<{ ok: boolean; messages?: { role: "user" | "assistant"; content: string; ts: string }[] }>(
      `/api/publish/session/history?postId=${encodeURIComponent(postId)}&chatId=${encodeURIComponent(chatId)}`,
    );
  },
  send(postId: string, chatId: string, skill: string, message: string, signal?: AbortSignal, plan?: ContentPlan) {
    return publishFetch<{ ok: boolean; chatId?: string; reply?: string; platforms?: SkillDraft[]; note?: string }>(
      "/api/publish/session/chat",
      { method: "POST", body: JSON.stringify({ postId, chatId, skill, message, plan }), signal },
    );
  },
  /** 规划回合：agent 按源内容+用户要求出可执行方案（focus=固定模板→只出 1 个该方向方案） */
  plan(postId: string, chatId: string, message: string, signal?: AbortSignal, focus?: Pick<ContentPlan, "name" | "platform" | "format" | "skill"> & { mediaNote?: string }) {
    return publishFetch<{ ok: boolean; chatId?: string; reply?: string; plans?: ContentPlan[] }>(
      "/api/publish/session/plan",
      { method: "POST", body: JSON.stringify({ postId, chatId, message, ...(focus ? { focus } : {}) }), signal },
    );
  },
  /** 恢复该纪录最近一次规划的方案（刷新后方案卡还在） */
  plans(postId: string, chatId: string) {
    return publishFetch<{ ok: boolean; plans?: ContentPlan[] }>(
      `/api/publish/session/plans?postId=${encodeURIComponent(postId)}&chatId=${encodeURIComponent(chatId)}`,
    );
  },
  drafts(postId: string, chatId: string) {
    return publishFetch<{ ok: boolean; drafts?: DraftFile[] }>(
      `/api/publish/session/drafts?postId=${encodeURIComponent(postId)}&chatId=${encodeURIComponent(chatId)}`,
    );
  },
  skills() {
    return publishFetch<{ ok: boolean; skills?: SkillInfo[] }>("/api/publish/skills").then(
      (r) => (r.ok ? (r.data?.skills ?? []) : []),
    );
  },
};

/** 采纳出稿（走既有 variants 闸，409/422 口径同旧面板） */
export function adoptVariant(postId: string, d: SkillDraft): Promise<{ ok: boolean; status: number; error?: string; errors?: string[] }> {
  return publishFetch<{ error?: string; errors?: string[]; variant?: { id: string } }>("/api/publish/variants", {
    method: "POST",
    body: JSON.stringify({ postId, platform: d.platform, title: d.title, body: d.body, tags: d.tags, format: d.format }),
  }).then((r) => ({ ok: r.ok, status: r.status, error: r.error, errors: r.errors }));
}

/** 一键发布（2026-10-15 拍板：出稿/适配版直接发布，无采纳/批准环节）：upsert 适配版+APPROVED+建任务
 * 两种入口：draft（出稿内容）或 variantId（已有适配版原样发） */
export function publishNow(
  postId: string,
  payload: Pick<SkillDraft, "platform" | "title" | "body" | "tags" | "format"> | { variantId: string },
): Promise<{ ok: boolean; status: number; variantId?: string; platform?: string; jobId?: string; jobStatus?: string; error?: string; errors?: string[]; warnings?: string[] }> {
  const body = "variantId" in payload ? { postId, variantId: payload.variantId } : { postId, ...payload };
  return publishFetch<{ variantId?: string; platform?: string; jobId?: string; jobStatus?: string; warnings?: string[]; error?: string; errors?: string[] }>(
    "/api/publish/publish",
    { method: "POST", body: JSON.stringify(body) },
  ).then((r) => ({ ok: r.ok, status: r.status, variantId: r.data?.variantId, platform: r.data?.platform, jobId: r.data?.jobId, jobStatus: r.data?.jobStatus, error: r.error, errors: r.errors, warnings: r.data?.warnings }));
}

/**
 * SSE 流式 fetch（worker /session-plan//session-chat stream=true）：
 * onDelta=逐字回调（pi 过程 assistant 文本）；resolve=done 事件载荷；error 事件/网络异常=reject。
 * done 前 abort（点停止）=reject（调用方认 ctrl.signal.aborted 单独分支，口径同同步版）。
 */
export async function publishStreamFetch(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  onDelta: (text: string) => void,
): Promise<Record<string, unknown>> {
  let resp: Response;
  try {
    resp = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "网络异常";
    if (signal?.aborted) throw e; // abort 由调用方单独分支
    throw new Error(msg);
  }
  if (!resp.ok || !resp.body) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err && typeof err === "object" && ("error" in err ? err.error : "")) || `请求失败（${resp.status}）`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // keepalive ping
        if (!line.startsWith("data: ")) continue;
        let data: string;
        try {
          data = line.slice(6).trim();
        } catch {
          continue;
        }
        if (!data) continue;
        try {
          const obj = JSON.parse(data) as { kind?: string; text?: string; error?: string };
          if (obj.kind === "delta" && obj.text) onDelta(obj.text);
          if (obj.kind === "done") {
            reader.cancel().catch(() => undefined);
            return obj as Record<string, unknown>; // done 载荷=最终结果（ok/plans/platforms/reply/…）
          }
          if (obj.kind === "error") {
            reader.cancel().catch(() => undefined);
            throw new Error(String(obj.error ?? "执行失败"));
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue; // 半行 JSON（分片边界）——保留 buf 续解析；done/error 业务错误上抛
          throw e;
        }
      }
    }
  }
  throw new Error("流式连接已断开（worker 离线或超时）");
}

/** 内容方案（worker 规划回合产物：先定方案 → 确定后自动映射技能再生成） */
export interface ContentPlan {
  id: string;
  name: string;
  desc: string;
  platform: "XHS" | "DOUYIN" | "GZH";
  format: "IMAGE_TEXT" | "VIDEO";
  skill: string;
  mediaNote: string;
}

/** 3 个固定方案模板（拍板 Q1a：零成本直出；确定后自动映射技能，用户无感） */
export const PLAN_TEMPLATES: ContentPlan[] = [
  {
    id: "tpl-xhs-card",
    name: "小红书图文·知识卡组",
    desc: "3-6 张竖版卡片，把源内容做成小红书知识卡组",
    platform: "XHS",
    format: "IMAGE_TEXT",
    skill: "card-xiaohongshu",
    mediaNote: "P1 只出文案，卡片渲染记入媒体要求",
  },
  {
    id: "tpl-dy-video",
    name: "抖音视频·口播",
    desc: "60 秒口播脚本+标题+标签，竖版",
    platform: "DOUYIN",
    format: "VIDEO",
    skill: "skill-douyin-upload",
    mediaNote: "需 15-60s 竖版视频",
  },
  {
    id: "tpl-gzh-text",
    name: "公众号图文·长文",
    desc: "深度长文文案，多平台通用（GZH 仅预览）",
    platform: "GZH",
    format: "IMAGE_TEXT",
    skill: "copywriting",
    mediaNote: "需封面图 1 张",
  },
];
