"use client";

// 发布会话（Easel 对齐：每个发布一个会话，选题后选技能=选工作流）。
// 流程：选技能卡片 → 「开始工作流」（worker 内 pi 执行 SKILL.md，30-180s）
// → 出稿卡（多平台草稿 + 媒体要求）→ 「采纳」逐平台走既有 variants 闸（422/409 原样）
// → 之后走既有批准闸 + 排期发布。表单通道并存不受影响。
import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowClockwise, Check, Lightning, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PLATFORM_LABEL, publishFetch } from "./publish-shared";

interface SkillInfo {
  slug: string;
  name: string;
  description: string;
}
interface SkillDraft {
  platform: string;
  title: string;
  body: string;
  tags: string[];
  format: "IMAGE_TEXT" | "VIDEO";
  mediaNote: string;
}

export function PublishSessionPanel({ postId, postTitle }: { postId: string; postTitle: string }) {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [drafts, setDrafts] = useState<SkillDraft[] | null>(null);
  const [runNote, setRunNote] = useState("");
  const [adoptState, setAdoptState] = useState<Record<string, string>>({}); // platform → ok/409/422…

  const loadSkills = useCallback(async () => {
    const r = await publishFetch<{ skills: SkillInfo[] }>("/api/publish/skills");
    if (!r.ok) {
      toast.error(r.error || "读取技能清单失败（worker 未起？）");
      return;
    }
    setSkills(r.data?.skills ?? []);
  }, []);

  const run = useCallback(
    async (force: boolean) => {
      if (!selected) {
        toast.warning("先选一个技能（=选工作流）");
        return;
      }
      setRunning(true);
      setRunError("");
      setAdoptState({});
      try {
        const r = await publishFetch<{ platforms: SkillDraft[]; note: string }>(
          "/api/publish/session/run",
          { method: "POST", body: JSON.stringify({ postId, skill: selected }) }
        );
        if (!r.ok) {
          setRunError(r.error || "技能执行失败");
          return;
        }
        setDrafts(r.data?.platforms ?? []);
        setRunNote(r.data?.note ?? "");
        toast.success("工作流执行完成，逐平台核对后采纳");
      } finally {
        setRunning(false);
        void force;
      }
    },
    [postId, selected]
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
      }
    );
    if (r.ok) {
      setAdoptState((s) => ({ ...s, [d.platform]: "ok" }));
      toast.success(`${PLATFORM_LABEL[d.platform as keyof typeof PLATFORM_LABEL] ?? d.platform} 适配版已建（去适配页核对/批准）`);
      router.refresh();
      return;
    }
    // 409 已有该平台 variant / 422 格式不过：原样提示，用户去适配页处理
    setAdoptState((s) => ({ ...s, [d.platform]: r.status === 409 ? "409" : "422" }));
    const msg = r.errors?.length ? r.errors.join("；") : r.error;
    toast.warning(msg ? `未建：${msg}` : "未建");
    if (r.status === 409) router.refresh(); // 已有 variant，刷新看到入口
  }

  const GZH_HINT = "GZH 未接入发布（P2 官方 API），采纳仅存草稿";

  return (
    <section aria-label="发布会话（技能工作流）" className="rounded-lg border border-white/9 bg-[var(--surface-panel-bg)] p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <Sparkle className="size-4 text-primary" weight="fill" />
        <h2 className="text-sm font-medium text-foreground">会话创作（选技能 = 选工作流）</h2>
        <span className="text-[11px] text-muted-foreground">源：{postTitle}</span>
      </div>

      {/* 技能选择 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {skills.map((s) => (
          <button
            key={s.slug}
            onClick={() => setSelected(s.slug)}
            title={s.description}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              selected === s.slug
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-white/10 text-foreground/70 hover:bg-white/5"
            }`}
          >
            {s.name}
          </button>
        ))}
        {skills.length === 0 && <span className="text-xs text-muted-foreground">技能清单加载中…</span>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void run(false)}
          disabled={running || !selected}
        >
          <Lightning className="h-3.5 w-3.5" weight="fill" />
          {running ? "工作流执行中（约 30-180 秒）…" : "开始工作流"}
        </Button>
        {drafts && (
          <Button variant="outline" size="sm" onClick={() => void run(true)} disabled={running}>
            <ArrowClockwise className="h-3.5 w-3.5" />
            重跑
          </Button>
        )}
      </div>

      {runError && <p className="mt-2 text-xs text-red-400" role="alert">{runError}</p>}
      {runNote && <p className="mt-2 text-xs text-muted-foreground">备注：{runNote}</p>}

      {/* 出稿卡 */}
      {drafts && drafts.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {drafts.map((d) => {
            const st = adoptState[d.platform];
            const isGzh = d.platform === "GZH";
            return (
              <div key={`${d.platform}-${d.title.slice(0, 8)}`} className="rounded-md border border-white/8 bg-black/10 p-3">
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
                      <Check className="size-3.5" weight="fill" />已采纳（去适配页核对/批准）
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
    </section>
  );
}
