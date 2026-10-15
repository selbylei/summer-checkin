// Easel 1:1 复刻 + 方案流（2026-10-15 拍板版）：
// ①固定方案卡=对话流内（点卡=出 1 个该平台方案，focus 透传 worker）；②方案卡内按钮「生成此方案/调整要求」，
// 点了生成才出稿；③右栏产物=出稿+平台适配版管理（吸收适配页：媒体补齐/封面/批准/发布，:3022 轮询 job）。
// 布局 .app-layout（sidebar 264 | 聊天 flex | 产物栏 340）；同步等待 worker（300s 上限）、「停止」=abort。
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EaselSidebar } from "./easel-sidebar";
import { EaselBrush } from "./easel-brush";
import { EaselBubble } from "./easel-bubble";
import { easelApi, newLocalChatId, PLAN_TEMPLATES, publishStreamFetch, publishNow } from "./easel-data";
import type { EaselMsg, EaselChatRecord, SkillInfo, SkillDraft, DraftFile, ContentPlan } from "./easel-data";
import {
  publishFetch,
  PLATFORM_LABEL,
  JOB_TERMINAL,
  type PublishPostDto,
  type PublishJobDto,
} from "../publish-shared";
import { ConfirmDialog } from "../confirm-dialog";
import type { ConfirmState } from "../confirm-dialog";
import "./easel.css";

const THEME_KEY = "sc_easel_theme";

// 模块级：同 postId 的 ensureChat in-flight 去重（StrictMode 双挂载/双页签并发建纪录竞态）
const ensuringByPost = new Map<string, Promise<unknown>>();

function greeting(): string {
  const h = new Date().getHours();
  const g = h < 6 ? "夜深了" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  return `${g}，想创作点什么？`;
}

/** 方案卡（Easel card 语言：badge+标题+说明；主按钮=点击动作，次按钮=可选） */
function PlanCard({
  plan,
  ctaText,
  onPrimary,
  secondaryText,
  onSecondary,
  confirmed,
}: {
  plan: ContentPlan;
  ctaText: string;
  onPrimary: () => void;
  secondaryText?: string;
  onSecondary?: () => void;
  confirmed?: boolean;
}) {
  return (
    <div className={`card card-hover plan-card${confirmed ? " plan-card-on" : ""}`}>
      <div className="plan-head">
        <span className="badge badge-accent">{PLATFORM_LABEL[plan.platform as keyof typeof PLATFORM_LABEL] ?? plan.platform}</span>
        <span className="badge">{plan.format === "VIDEO" ? "视频" : "图文"}</span>
        <span className="plan-skill">{plan.name}</span>
      </div>
      <div className="plan-desc">{plan.desc}</div>
      {plan.mediaNote ? <div className="plan-media">媒体：{plan.mediaNote}</div> : null}
      <div className="plan-cta">
        <button type="button" className="btn btn-primary btn-sm" onClick={onPrimary} disabled={confirmed}>
          {confirmed ? "✓ 已选此方案" : ctaText}
        </button>
        {secondaryText && onSecondary ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSecondary} disabled={confirmed}>
            {secondaryText}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EaselShell({
  postId,
  postTitle,
  post,
}: {
  postId: string;
  postTitle: string;
  post: PublishPostDto;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [workerOnline, setWorkerOnline] = useState(true);
  const [sessions, setSessions] = useState<EaselChatRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Record<string, EaselMsg[]>>({});
  const [drafts, setDrafts] = useState<Record<string, SkillDraft[] | null>>({});
  const [runNote, setRunNote] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  /** 每条纪录当前工作流技能（方案确定=自动映射；笔入口=高级覆盖） */
  const [skillByChat, setSkillByChat] = useState<Record<string, string>>({});
  /** 已确认方案（确定后生成按方案定位出稿） */
  const [planByChat, setPlanByChat] = useState<Record<string, ContentPlan | null>>({});
  /** 规划回合产出的待确认方案（对话内方案卡） */
  const [pendingPlansByChat, setPendingPlansByChat] = useState<Record<string, ContentPlan[]>>({});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  // 右栏产物（拍板：直接发布的内容预览，按标题/正文/标签/封面分区；去备注/平台适配版区）
  const [mediaPaths, setMediaPaths] = useState<string[]>(post.mediaPaths);
  const [mediaBusy, setMediaBusy] = useState(false);
  // 发布状态（出稿卡按 chat:platform：publishing/ok/failed）
  const [pubState, setPubState] = useState<Record<string, { st: string; err?: string }>>({});
  // 自定义删除/重置确认弹框（拍板不用系统 window.confirm）
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const askConfirm = (title: string, body: string, confirmLabel: string, onConfirm: () => void, danger = true) =>
    setConfirm({ title, body, confirmLabel, onConfirm, danger });
  const jobPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setMediaPaths(post.mediaPaths);
  }, [post]);
  useEffect(
    () => () => {
      if (jobPollRef.current) clearTimeout(jobPollRef.current);
    },
    [],
  );
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const activeMsgs = activeId ? (messages[activeId] ?? []) : [];
  const activeSkill = activeId ? (skillByChat[activeId] ?? "") : "";
  const activeSkillInfo = skills.find((s) => s.slug === activeSkill);
  const activePlan = activeId ? (planByChat[activeId] ?? null) : null;
  const activePendingPlans = activeId ? (pendingPlansByChat[activeId] ?? []) : [];

  // ---- 主题（作用域在 .easel-shell，不影响宿主 app）----
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* 默认 dark */ }
  }, []);
  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });

  const openChat = useCallback(
    (chatId: string, skill = "") => {
      setActiveId(chatId);
      setInput("");
      if (skill) setSkillByChat((m) => ({ ...m, [chatId]: skill }));
      if (!messages[chatId]?.length) {
        easelApi.history(postId, chatId).then((r) => {
          const msgs = r.data?.messages;
          if (r.ok && msgs?.length) {
            setMessages((m) => ({
              ...m,
              [chatId]: msgs.map((x, i) => ({
                id: `h-${i}`,
                role: x.role,
                content: x.content,
                createdAt: x.ts ? new Date(x.ts) : new Date(),
              })),
            }));
          }
        });
      }
      setDrafts((m) => (m[chatId] ? m : m));
      setRunNote((m) => (m[chatId] ? m : m));
      // 刷新恢复：最近一次规划回合的方案（未确认则重新出方案卡）
      easelApi.plans(postId, chatId).then((r) => {
        if (r.ok && r.data?.plans?.length) {
          setPendingPlansByChat((m) => ({ ...m, [chatId]: r.data!.plans! }));
        }
      });
      easelApi.drafts(postId, chatId).then((r) => {
        if (r.ok && r.data?.drafts?.length) {
          const latest = [...r.data.drafts].sort((a, b) => b.mtimeMs - a.mtimeMs)[0] as DraftFile;
          if (latest.platforms.length) {
            setDrafts((m) => ({ ...m, [chatId]: latest.platforms }));
            setRunNote((m) => ({ ...m, [chatId]: latest.note }));
          }
        }
      });
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [postId, messages],
  );

  // 建/复用一条会话：本地生成 chatId，先落 meta（标题=内容名）再进空白页（worker 端幂等）。
  // 模块级 in-flight 去重：dev StrictMode 双挂载/双页签并发「列表空→各建一条」竞态，
  // 第二者等第一个建完再走复用分支（不重复建）。
  const ensureChat = useCallback(async (list?: EaselChatRecord[]) => {
    const inFlight = ensuringByPost.get(postId);
    if (inFlight) {
      await inFlight;
      const after = await easelApi.listChats(postId);
      if (after.length) {
        setSessions(after);
        openChat(after[0].chatId, after[0].skill ?? "");
      }
      return;
    }
    const task = (async () => {
      let existing = list?.find((c) => c.title === postTitle);
      if (!existing) {
        // 建前再取一次最新列表（双页签场景：同名纪录已存在则复用）；同内容多条=优先有内容的最新条
        const fresh = await easelApi.listChats(postId);
        if (fresh.length) {
          const keep = [...fresh].sort(
            (a, b) => (Number(b.hasContent ?? false) - Number(a.hasContent ?? false)) || b.mtimeMs - a.mtimeMs,
          )[0];
          existing = keep;
        }
      }
      if (existing) {
        openChat(existing.chatId, existing.skill ?? "");
        return;
      }
      const chatId = newLocalChatId();
      setSessions((s) => [{ chatId, title: postTitle, skill: "", mtimeMs: Date.now(), hasContent: false }, ...s]);
      setMessages((m) => ({ ...m, [chatId]: [] }));
      openChat(chatId);
      await easelApi.createChat(postId, chatId, postTitle);
    })();
    ensuringByPost.set(postId, task);
    try {
      await task;
    } finally {
      ensuringByPost.delete(postId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, postTitle]);

  const refreshSessions = useCallback(() => {
    easelApi.listChats(postId).then(setSessions);
  }, [postId]);

  // 重置会话（grill 拍板）：清空 pi 上下文与出稿=删纪录+同名重建，开空白页
  const resetChat = useCallback(async (chatId: string) => {
    await easelApi.deleteChat(postId, chatId);
    setMessages((m) => ({ ...m, [chatId]: [] }));
    setDrafts((m) => ({ ...m, [chatId]: null }));
    setRunNote((m) => ({ ...m, [chatId]: "" }));
    setSkillByChat((m) => ({ ...m, [chatId]: "" }));
    setPlanByChat((m) => ({ ...m, [chatId]: null }));
    setPendingPlansByChat((m) => ({ ...m, [chatId]: [] }));
    await easelApi.createChat(postId, chatId, postTitle);
    refreshSessions();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [postId, postTitle, refreshSessions]);

  // ---- 启动：技能清单 + 纪录列表 + 打开目标纪录（同一内容一条会话：有纪录开最新，没有才自动建）----
  useEffect(() => {
    easelApi.skills().then(setSkills);
    easelApi.listChats(postId).then(async (list) => {
      setSessions(list);
      // 一内容=一会话：历史多条（并发建纪录遗留）保留一条——**优先有内容的**（含 pi 会话/出稿/方案），否则最新活跃；其余清理（幂等）。
      // 修「第二次进入聊天不一致」：旧规则按 mtime 保留，会把竞态建出的空纪录留下、有对话的纪录删掉
      const keep = [...list].sort(
        (a, b) => Number(b.hasContent ?? false) - Number(a.hasContent ?? false) || b.mtimeMs - a.mtimeMs,
      )[0];
      const rest = list.filter((c) => c.chatId !== keep.chatId);
      for (const c of rest) await easelApi.deleteChat(postId, c.chatId);
      if (rest.length) setSessions([keep]);
      if (list.length) {
        openChat(keep.chatId, keep.skill ?? "");
      } else {
        void ensureChat(list);
      }
    });
    const r = fetch("/api/publish/health").then((x) => x.ok).catch(() => false);
    r.then((ok) => setWorkerOnline(!!ok));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  // ---- 发送：①已定方案/已选技能=生成（带方案上下文）②都没有=规划回合（focus=固定模板→ 1 方案，否则 3 方案）----
  // ovr：卡片点击直传（focus/plan/skill 绕开 state 异步）
  const send = useCallback(
    async (rawText?: string, ovr?: { plan?: ContentPlan | null; skill?: string; focus?: ContentPlan }) => {
      const text = (rawText ?? input).trim();
      if (!text || pending || !activeId) return;
      const chatId = activeId;
      const plan = ovr?.plan !== undefined ? ovr.plan : planByChat[chatId] ?? null;
      const skill = ovr?.skill ?? plan?.skill ?? (skillByChat[chatId] ?? "");
      const isPlanTurn = !skill; // 无技能=还没定方案 → 走规划回合

      setInput("");
      const userMsg: EaselMsg = { id: `u-${Date.now()}`, role: "user", content: text, createdAt: new Date() };
      const phId = `a-${Date.now()}`;
      const ph: EaselMsg = { id: phId, role: "assistant", content: "", createdAt: new Date() };
      setMessages((m) => ({ ...m, [chatId]: [...(m[chatId] ?? []), userMsg, ph] }));
      setPending(true);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // 流式过程：pi assistant 文本增量逐字进气泡（跟正常 AI 聊一样）；显示只保留尾部 1200 字
      let live = "";
      const setLive = (delta: string) => {
        live += delta;
        const tail = live.length > 1200 ? live.slice(-1200) : live;
        setMessages((m) => ({ ...m, [chatId]: (m[chatId] ?? []).map((x) => (x.id === phId ? { ...x, content: tail } : x)) }));
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
      };
      const setPh = (content: string) => {
        setMessages((m) => ({ ...m, [chatId]: (m[chatId] ?? []).map((x) => (x.id === phId ? { ...x, content } : x)) }));
      };
      try {
        // 两路都是 SSE 流式：done 载荷=worker 结果（plan→plans / chat→platforms+reply）
        const resp: Record<string, unknown> = isPlanTurn
          ? await publishStreamFetch(
              "/api/publish/session/plan",
              { postId, chatId, message: text, stream: true, ...(ovr?.focus ? { focus: ovr.focus } : {}) },
              ctrl.signal,
              setLive,
            )
          : await publishStreamFetch(
              "/api/publish/session/chat",
              { postId, chatId, skill, message: text, plan: plan ?? undefined, stream: true },
              ctrl.signal,
              setLive,
            );
        if (isPlanTurn) {
          const plans = resp.plans as ContentPlan[] | undefined;
          if (plans?.length) {
            // A 修复：新方案到达=旧确认作废（否则新方案卡被 activePlan 挡住，要等后续聊天才显示）；方案卡实时回执
            setPlanByChat((m) => ({ ...m, [chatId]: null }));
            setPendingPlansByChat((m) => ({ ...m, [chatId]: plans }));
          }
          setPh(String(resp.reply ?? "") || `（方案已出 ${plans?.length ?? 0} 个，下方选一个）`);
        } else {
          const platforms = resp.platforms as SkillDraft[] | undefined;
          setPh(String(resp.reply ?? "") || "（无回复）");
          if (platforms?.length) {
            setDrafts((m) => ({ ...m, [chatId]: platforms }));
            setRunNote((m) => ({ ...m, [chatId]: String(resp.note ?? "") }));
          }
        }
        refreshSessions();
      } catch (e) {
        // 用户点「停止」→ abort：fetch 抛 AbortError，识别 aborted 单独分支
        if (ctrl.signal.aborted) {
          setPh("（已停止等待；worker 完成后结果会自动出现，稍后刷新可见）");
          return;
        }
        setPh(`执行失败：${e instanceof Error ? e.message : "未知错误"}（可重试）`);
        return;
      } finally {
        setPending(false);
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    },
    [input, activeId, pending, planByChat, skillByChat, postId, refreshSessions],
  );

  // 确定方案（点方案卡内「生成此方案」按钮）= 指令：立即按该方案生成出稿（绕开 state 异步直传 plan/skill）
  const genPlan = useCallback(
    (plan: ContentPlan) => {
      if (!activeId || pending) return;
      const chatId = activeId;
      setPlanByChat((m) => ({ ...m, [chatId]: plan }));
      setSkillByChat((m) => ({ ...m, [chatId]: plan.skill }));
      setPendingPlansByChat((m) => ({ ...m, [chatId]: [] }));
      void send(`按方案「${plan.name}」生成`, { plan, skill: plan.skill });
    },
    [activeId, pending, send],
  );
  // 「调整要求」：清待确认方案，回输入框说要求（agent 会重新出方案）
  const adjustPlan = useCallback(() => {
    if (!activeId || pending) return;
    setPendingPlansByChat((m) => ({ ...m, [activeId]: [] }));
    setPlanByChat((m) => ({ ...m, [activeId]: null }));
    setInput("调整要求：");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [activeId, pending]);
  // 点固定模板卡：出 1 个该平台方案（focus 透传 worker，规划回合只回 1 方案）
  const planForTemplate = useCallback(
    (tpl: ContentPlan) => {
      void send(`按「${tpl.name}」出方案`, { focus: tpl });
    },
    [send],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ---- 删除/重置（sidebar；破坏性操作用自定义弹框确认，拍板不用系统框）----
  const del = useCallback(
    (chatId: string) => {
      askConfirm(
        "删除这条记录？",
        "会话上下文与出稿会一起删除，不可恢复。",
        "删除",
        async () => {
          await easelApi.deleteChat(postId, chatId);
          if (chatId === activeId) setActiveId("");
          refreshSessions();
        },
      );
    },
    [postId, activeId, refreshSessions],
  );
  const confirmReset = useCallback(
    (chatId: string) => {
      askConfirm(
        "重置会话？",
        "清空 pi 上下文与出稿，开空白页（纪录保留）。",
        "重置",
        () => {
          void resetChat(chatId);
        },
      );
    },
    [resetChat],
  );

  // ---- 一键发布（拍板：出稿直接发布，无采纳/批准环节；upsert 适配版+建任务；状态按 chat:platform 跟踪）----
  async function publishDraft(d: SkillDraft) {
    if (mediaPaths.length === 0 || !activeId) return; // UI 已禁用，双保险
    const key = `${activeId}:${d.platform}`;
    setPubState((m) => ({ ...m, [key]: { st: "publishing" } }));
    const r = await publishNow(postId, d);
    if (!r.ok) {
      setPubState((m) => ({ ...m, [key]: { st: "failed", err: (r.errors?.length ? r.errors.join("；") : r.error) ?? "发布失败" } }));
      return;
    }
    if (r.warnings?.length) toast.warning(r.warnings[0]);
    if (r.variantId) {
      pollJobs(r.variantId, key);
    }
    router.refresh(); // 媒体/内容同步刷新
  }

  // ---- 媒体补齐（POST /media 落盘 + PATCH Post.mediaPaths 追加；右栏封面/图预览随 mediaPaths 出）----
  async function uploadMedia(files: FileList | null) {
    if (!files?.length || mediaBusy) return;
    setMediaBusy(true);
    try {
      const added: string[] = [];
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("postId", postId);
        fd.append("file", f);
        const r = await publishFetch<{ path: string }>("/api/publish/media", { method: "POST", body: fd });
        if (!r.ok || !r.data?.path) {
          toast.error(`上传失败：${r.error ?? "未知错误"}`);
          return;
        }
        added.push(r.data.path);
      }
      const pr = await publishFetch<{ mediaPaths: string[] }>(`/api/publish/posts/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ mediaPaths: [...mediaPaths, ...added] }),
      });
      if (!pr.ok) {
        toast.error(`媒体已上传但保存失败：${pr.error ?? "未知"}`);
        return;
      }
      setMediaPaths([...mediaPaths, ...added]);
      toast.success(`已补齐 ${added.length} 个媒体（共 ${mediaPaths.length + added.length} 个）`);
    } finally {
      setMediaBusy(false);
    }
  }

  // 发布任务轮询（2.5s；终态→更新出稿卡发布状态）
  function pollJobs(targetVariantId: string, pubKey: string) {
    const tick = async () => {
      const r = await publishFetch<PublishJobDto[]>("/api/publish/jobs");
      if (r.ok) {
        const j = (r.data ?? []).find((x) => x.variantId === targetVariantId);
        if (j && JOB_TERMINAL.includes(j.status)) {
          if (j.status === "SUCCESS") {
            setPubState((m) => ({ ...m, [pubKey]: { st: "ok" } }));
            toast.success(`${PLATFORM_LABEL[j.variant.platform]} 发布成功`);
          } else if (j.status === "FAILED") {
            setPubState((m) => ({ ...m, [pubKey]: { st: "failed", err: j.lastError ?? "未知原因" } }));
            toast.error(`${PLATFORM_LABEL[j.variant.platform]} 发布失败：${j.lastError ?? "未知原因"}`);
          } else {
            setPubState((m) => ({ ...m, [pubKey]: { st: "" } }));
          }
          return;
        }
      }
      jobPollRef.current = setTimeout(() => void tick(), 2500);
    };
    jobPollRef.current = setTimeout(() => void tick(), 2500);
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // ---- composer（Easel 1:1：毛笔笔入口=高级项换工作流 + 自适应 textarea + 底栏）----
  const composer = (
    <div className="composer">
      <div className="composer-top">
        <EaselBrush
          skills={skills}
          onPick={(s, text) => {
            setSkillByChat((m) => ({ ...m, [activeId]: s.slug }));
            setInput(text);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="说点什么：定方案 / 提要求 / 迭代稿件…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          style={{ height: "auto", maxHeight: 180 }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
          }}
        />
      </div>
      <div className="composer-bar">
        <button type="button" className="composer-skill-chip" title="当前方案/工作流（点毛笔按钮可换工作流）">
          {activePlan
            ? `方案：${activePlan.name}`
            : activeSkillInfo
              ? `工作流：${activeSkillInfo.name}`
              : "未定方案（上方方案卡选一个，或直接说要求）"}
        </button>
        <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
        {pending ? (
          <button type="button" className="send-btn" onClick={stop} title="停止等待">
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="send-btn"
            onClick={() => void send()}
            disabled={!input.trim()}
            title="发送"
          >
            <ArrowUpIcon />
          </button>
        )}
      </div>
    </div>
  );

  const activeDrafts = activeId ? (drafts[activeId] ?? null) : null;
  const GZH_HINT = "GZH 未接入发布（P2 官方 API），仅预览";
  // 媒体预览：图片出缩略图（/api/publish/media 域隔离），视频/其他出文件名
  const IMG_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  const mediaThumbs = mediaPaths
    .filter((p) => IMG_EXT.includes(`.${p.split(".").pop()?.toLowerCase() ?? ""}`))
    .slice(0, 4);
  const mediaCount = mediaPaths.length;

  /** 右栏产物（拍板：直接发布的内容预览——标题/正文/标签/封面分区；无备注、无平台适配版区） */
  const artifactsPanel = (
    <aside className="artifacts-panel">
      <div className="artifacts-head">产物</div>
      {!activeDrafts || activeDrafts.length === 0 ? (
        <p className="artifacts-empty">还没有出稿。定方案后点「生成此方案」即可，出稿在这里预览并发布。</p>
      ) : (
        activeDrafts.map((d) => {
          const pub = activeId ? pubState[`${activeId}:${d.platform}`] : undefined;
          const canPub = d.platform !== "GZH" && mediaCount > 0 && pub?.st !== "publishing" && pub?.st !== "ok";
          return (
            <div key={`${d.platform}-${d.title.slice(0, 8)}`} className="card artifact-item draft-preview">
              <div className="artifact-head">
                <span className="badge badge-accent">
                  {PLATFORM_LABEL[d.platform as keyof typeof PLATFORM_LABEL] ?? d.platform}
                </span>
                <span className="badge">{d.format === "VIDEO" ? "视频" : "图文"}</span>
              </div>
              {/* 分区预览：标题 / 正文 / 标签 / 封面（媒体） */}
              <div className="pv-sec">
                <div className="pv-label">标题</div>
                <div className="pv-title">{d.title}</div>
              </div>
              <div className="pv-sec">
                <div className="pv-label">正文</div>
                <div className="pv-body">{d.body}</div>
              </div>
              {d.tags.length > 0 && (
                <div className="pv-sec">
                  <div className="pv-label">标签</div>
                  <div className="pv-tags">{d.tags.map((t) => `#${t}`).join("  ")}</div>
                </div>
              )}
              <div className="pv-sec">
                <div className="pv-label">封面 / 媒体{d.format === "VIDEO" && d.mediaNote ? `（${d.mediaNote}）` : ""}</div>
                <div className="pv-media">
                  {mediaThumbs.length > 0 ? (
                    mediaThumbs.map((p) => (
                      <img key={p} className="pv-thumb" src={`/api/publish/media?path=${encodeURIComponent(p)}`} alt="" />
                    ))
                  ) : (
                    <span className="pv-media-empty">{mediaCount > 0 ? `${mediaCount} 个媒体（非图预览）` : "暂无媒体"}</span>
                  )}
                  {mediaCount > mediaThumbs.length && <span className="pv-more">+{mediaCount - mediaThumbs.length}</span>}
                  <label className="pv-upload">
                    {mediaBusy ? "上传中…" : "＋ 补传"}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      disabled={mediaBusy}
                      onChange={(e) => {
                        void uploadMedia(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
              {d.platform === "GZH" && <p className="pv-hint">{GZH_HINT}</p>}
              {mediaCount === 0 && d.platform !== "GZH" && (
                <p className="vm-err">缺媒体：先「补传」再发布（图文至少 1 张图 / 视频 1 段）</p>
              )}
              <div className="artifact-actions">
                {pub?.st === "ok" ? (
                  <span className="artifact-state ok">✓ 已发布</span>
                ) : pub?.st === "publishing" ? (
                  <span className="artifact-state warn">发布中…（worker 每分钟扫一次）</span>
                ) : pub?.st === "failed" ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void publishDraft(d)} title={pub.err}>
                    发布失败：{pub.err ? pub.err.slice(0, 24) : "未知"}（点击重试）
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" disabled={!canPub} onClick={() => void publishDraft(d)}>
                    发布
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </aside>
  );

  return (
    <div className="easel-shell" data-theme={theme} style={{ height: "calc(100dvh - 80px)" }}>
      <div className="app-layout" style={{ height: "100%" }}>
        <EaselSidebar
          theme={theme}
          onThemeToggle={toggleTheme}
          workerOnline={workerOnline}
          postTitle={postTitle}
          sessions={sessions}
          activeSessionId={activeId || null}
          onSessionSelect={(id) => openChat(id, sessions.find((c) => c.chatId === id)?.skill ?? "")}
          onSessionReset={(id) => confirmReset(id)}
          onSessionDelete={(id) => del(id)}
        />
        <div className="main-content">
          <div className="chat-page">
            {activeMsgs.length === 0 && !pending ? (
              <div className="chat-hero">
                <div className="chat-hero-brand">
                  <img src="/static/easel-icon-transparent.png" alt="" />
                  <span>Summer</span>
                </div>
                <h1 className="chat-hero-title">{greeting()}</h1>
                <p className="chat-hero-sub">源内容：{postTitle}。</p>
                {/* 3 个固定方案卡（拍板：挪进对话流内=助手引导气泡；点卡=出 1 个该平台方案） */}
                <div className="hero-plan-bubble">
                  <p className="hero-plan-bubble-text">先定个方向——点卡片，我马上出这个方向的方案：</p>
                  <div className="plan-grid">
                    {PLAN_TEMPLATES.map((tpl) => (
                      <PlanCard
                        key={tpl.id}
                        plan={tpl}
                        ctaText="出这个方案"
                        onPrimary={() => planForTemplate(tpl)}
                        confirmed={activePlan?.id === tpl.id}
                      />
                    ))}
                  </div>
                </div>
                {composer}
              </div>
            ) : (
              <>
                <div className="chat-messages">
                  <div className="chat-thread">
                    {activeMsgs.map((msg, i) => (
                      <EaselBubble
                        key={msg.id}
                        role={msg.role}
                        content={msg.content}
                        pending={pending && i === activeMsgs.length - 1 && msg.role === "assistant"}
                      />
                    ))}
                    {/* 规划回合：待确认方案卡（A 修复：新方案实时回执，不再被旧 activePlan 挡住） */}
                    {activePendingPlans.length > 0 && (
                      <div className="plan-grid plan-grid-thread">
                        <div className="plan-grid-label">agent 出了 {activePendingPlans.length} 个方案，点「生成此方案」直接出稿：</div>
                        {activePendingPlans.map((plan) => (
                          <PlanCard
                            key={plan.id}
                            plan={plan}
                            ctaText="生成此方案"
                            onPrimary={() => genPlan(plan)}
                            secondaryText="调整要求"
                            onSecondary={adjustPlan}
                          />
                        ))}
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                </div>
                <div className="chat-input-area">
                  <div className="chat-input-inner">{composer}</div>
                </div>
              </>
            )}
          </div>
        </div>
        {artifactsPanel}
      </div>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}
