"use client";

// 发布会话工作台（复用 /agent 页同款聊天形态：三栏网格 + MessageBubble + 底部输入条）。
// 左 = 技能选择（Easel 对齐：选技能=选工作流，layer 徽标 + 简短中文说明）；中 = 聊天对话（多轮迭代）；
// 右 = 出稿卡（多平台草稿 + 采纳）。会话后端走 worker /session-chat（pi 同会话续跑，草稿写盘可恢复）。
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Files,
  PaperPlaneTilt,
  Sparkle,
  Stop,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/ai/message-bubble";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";
import { PLATFORM_LABEL, publishFetch } from "./publish-shared";

interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  short: string;
  layer: string;
}
interface SkillDraft {
  platform: string;
  title: string;
  body: string;
  tags: string[];
  format: "IMAGE_TEXT" | "VIDEO";
  mediaNote: string;
}
interface DraftFile {
  skill: string;
  platforms: SkillDraft[];
  note: string;
  mtimeMs: number;
}

/** Easel 五层 → 中文徽标 */
const LAYER_LABEL: Record<string, string> = {
  produce: "制作",
  publish: "发布",
  strategy: "策划",
  discovery: "发现",
  attribution: "归因",
};

const QUICK_PROMPTS = [
  { label: "出小红书图文一条", prompt: "出小红书图文一条" },
  { label: "出抖音图文草稿", prompt: "出抖音图文草稿" },
  { label: "标题改活泼点", prompt: "把标题改活泼一点" },
];

export function PublishSessionPanel({ postId, postTitle }: { postId: string; postTitle: string }) {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [drafts, setDrafts] = useState<SkillDraft[] | null>(null);
  const [runNote, setRunNote] = useState("");
  const [adoptState, setAdoptState] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = publishFetch<{ skills: SkillInfo[] }>("/api/publish/skills");
    r.then((res) => {
      if (res.ok && res.data?.skills) setSkills(res.data.skills);
      else toast.error(res.error || "读取技能清单失败（worker 未起？）");
    });
    // 刷新页恢复出稿卡（agent 写盘的草稿文件；MVP 聊天记录不落 UI，只恢复稿件）
    publishFetch<{ ok: boolean; drafts: DraftFile[] }>(
      `/api/publish/session/drafts?postId=${encodeURIComponent(postId)}`,
    ).then((res) => {
      if (!res.ok || !res.data?.drafts?.length) return;
      const latest = [...res.data.drafts].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      if (latest.platforms.length > 0) {
        setDrafts(latest.platforms);
        setRunNote(latest.note);
        setSelected(latest.skill);
      }
    });
  }, [postId]);

  useEffect(() => {
    if (messages.length) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  }, []);

  const send = useCallback(
    async (rawText?: string) => {
      const content = (rawText ?? input).trim();
      if (!content || running) return;
      if (!selected) {
        toast.warning("先在左侧选一个技能（=选工作流）");
        return;
      }
      setInput("");
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content, createdAt: new Date() };
      const placeholderId = `a-${Date.now()}`;
      const placeholder: ChatMessage = { id: placeholderId, role: "assistant", content: "", createdAt: new Date() };
      setMessages((m) => [...m, userMsg, placeholder]);
      setRunning(true);
      try {
        const r = await publishFetch<{ reply?: string; platforms?: SkillDraft[]; note?: string }>(
          "/api/publish/session/chat",
          { method: "POST", body: JSON.stringify({ postId, skill: selected, message: content }) },
        );
        if (!r.ok) {
          setMessages((m) =>
            m.map((x) =>
              x.id === placeholderId
                ? { ...x, content: `执行失败：${r.error ?? "请确认 worker 已启动"}（可重试）` }
                : x,
            ),
          );
          return;
        }
        setMessages((m) =>
          m.map((x) => (x.id === placeholderId ? { ...x, content: r.data?.reply || "（无回复）" } : x)),
        );
        if (r.data?.platforms?.length) {
          setDrafts(r.data.platforms);
          setRunNote(r.data.note ?? "");
          setAdoptState({}); // 新稿重新核对
        }
      } finally {
        setRunning(false);
      }
    },
    [input, running, selected, postId],
  );

  async function adopt(d: SkillDraft) {
    const r = await publishFetch<{ error?: string; errors?: string[]; variant?: { id: string } }>(
      "/api/publish/variants",
      {
        method: "POST",
        body: JSON.stringify({
          postId,
          platform: d.platform,
          title: d.title,
          body: d.body,
          tags: d.tags,
          format: d.format,
        }),
      },
    );
    if (r.ok) {
      setAdoptState((s) => ({ ...s, [d.platform]: "ok" }));
      toast.success(`${PLATFORM_LABEL[d.platform as keyof typeof PLATFORM_LABEL] ?? d.platform} 适配版已建（去适配页核对/批准）`);
      router.refresh();
      return;
    }
    setAdoptState((s) => ({ ...s, [d.platform]: r.status === 409 ? "409" : "422" }));
    const msg = r.errors?.length ? r.errors.join("；") : r.error;
    toast.warning(msg ? `未建：${msg}` : "未建");
    if (r.status === 409) router.refresh();
  }

  const GZH_HINT = "GZH 未接入发布（P2 官方 API），采纳仅存草稿";

  return (
    <div className="grid h-[calc(100dvh-80px)] text-white lg:grid-cols-[240px_minmax(0,1fr)_340px]">
      {/* ── 左：技能选择（Easel 对齐：选技能=选工作流，layer 徽标+简短中文说明） ── */}
      <aside className={cn("rainforest-panel rainforest-panel--left", "lg:flex hidden")}>
        <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
          <Sparkle className="size-4 text-primary" weight="fill" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">技能（=工作流）</p>
            <p className="text-[10px] text-white/40">选一个开始会话</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar p-3">
          {skills.length === 0 && <p className="px-1 text-xs text-muted-foreground">技能清单加载中…</p>}
          <div className="flex flex-col gap-2">
            {skills.map((s) => (
              <button
                key={s.slug}
                onClick={() => setSelected(s.slug)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition",
                  selected === s.slug
                    ? "border-primary/50 bg-primary/10"
                    : "border-white/10 hover:bg-white/5",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-foreground/70">
                    {LAYER_LABEL[s.layer] ?? s.layer ?? "技能"}
                  </span>
                  <span className="text-xs font-medium text-foreground">{s.name}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-foreground/60">{s.short || s.description}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-white/10 p-3">
          <p className="text-[10px] font-medium text-white/38">源内容</p>
          <p className="mt-1 line-clamp-3 text-xs text-foreground/80">{postTitle}</p>
        </div>
      </aside>

      {/* ── 中：聊天对话（/agent 同款：气泡 + 底部输入条） ── */}
      <section className={cn("rainforest-panel rainforest-panel--center", "min-w-0")}>
        <header className="flex h-14 items-center justify-between border-b border-white/10 px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkle className="size-4" weight="fill" />
            </div>
            <div>
              <p className="text-sm font-semibold">发布会话</p>
              <p className="text-[11px] text-white/40">选技能 = 选工作流，对话迭代出稿</p>
            </div>
          </div>
          <span className="hidden truncate text-xs text-muted-foreground sm:block">源：{postTitle}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-4 py-5 sm:px-7">
          {messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
              <div className="relative flex size-14 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Sparkle className="size-6" weight="fill" />
              </div>
              <h2 className="mt-5 text-xl font-semibold">开始这场发布会话</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/48">
                在左侧选一个技能（=工作流），然后直接说想要什么——agent 按技能流程出稿，可继续对话迭代；出稿卡在右侧。
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-3">
                {QUICK_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setInput(item.prompt);
                      inputRef.current?.focus();
                    }}
                    className="rounded-md border border-white/10 bg-white/4 px-3 py-3 text-xs text-white/66 transition hover:border-primary/35 hover:bg-primary/7 hover:text-white"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-white/10 bg-black/10 p-3 sm:p-4">
          <div className="mx-auto max-w-3xl rounded-lg border border-white/12 bg-white/6 p-2 focus-within:border-primary/42">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={selected ? "说一句（如：出小红书一条、标题改活泼点），Enter 发送…" : "先在左侧选一个技能，再说要什么…"}
              className="min-h-14 max-h-40 resize-none overflow-y-auto border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              {running && (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
                  agent 按技能流程处理中（约 30-180 秒）…
                </span>
              )}
              <Button
                size="icon"
                onClick={() => void send()}
                disabled={running || !input.trim() || !selected}
                className="size-8 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {running ? <Stop className="size-4" weight="fill" /> : <PaperPlaneTilt className="size-4" weight="fill" />}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 右：出稿卡（agent 每轮改稿后自动更新；采纳走既有 variants 闸） ── */}
      <aside className={cn("rainforest-panel rainforest-panel--right", "lg:flex hidden")}>
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-2">
            <Files className="size-4 text-white/60" />
            <span className="text-xs font-semibold">出稿卡</span>
          </div>
          {drafts && <span className="text-[10px] text-white/30">{drafts.length}</span>}
        </div>
        <div className="rainforest-panel-content min-h-0 flex-1 overflow-y-auto thin-scrollbar">
          {runNote && <p className="mb-2 text-[11px] text-muted-foreground">备注：{runNote}</p>}
          {!drafts || drafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <p className="text-xs text-muted-foreground">还没有出稿</p>
              <p className="mt-1 max-w-[200px] text-[11px] leading-4 text-muted-foreground/70">
                在中间对话里说一句（如「出小红书一条」），agent 出稿后会显示在这里
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {drafts.map((d) => {
                const st = adoptState[d.platform];
                const isGzh = d.platform === "GZH";
                return (
                  <div key={`${d.platform}-${d.title.slice(0, 8)}`} className="glass-panel rounded-md border border-white/8 bg-black/10 p-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
                        {PLATFORM_LABEL[d.platform as keyof typeof PLATFORM_LABEL] ?? d.platform}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {d.format === "VIDEO" ? "视频" : "图文"}
                      </span>
                      {isGzh && <span className="text-[11px] text-amber-400/90">{GZH_HINT}</span>}
                    </div>
                    <p className="mt-2 text-xs font-medium text-foreground">{d.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/70">{d.body}</p>
                    {d.tags.length > 0 && (
                      <p className="mt-1 text-[11px] text-primary/80">{d.tags.map((t) => `#${t}`).join(" ")}</p>
                    )}
                    <p className="mt-1.5 text-[11px] text-muted-foreground">媒体要求：{d.mediaNote || "—"}</p>
                    <div className="mt-2.5 flex items-center gap-2">
                      {st === "ok" ? (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <Check className="size-3.5" weight="fill" />
                          已采纳（去适配页核对/批准）
                        </span>
                      ) : st === "409" ? (
                        <span className="text-xs text-amber-400/90">该平台已有适配版（未覆盖），去适配页处理</span>
                      ) : st === "422" ? (
                        <span className="text-xs text-red-400">格式不过关（见提示），改短后在适配页处理</span>
                      ) : (
                        <Button variant="outline" size="xs" onClick={() => void adopt(d)}>
                          采纳此稿
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
