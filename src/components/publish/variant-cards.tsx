"use client";

// 适配页三卡片（brief Step 3）：按平台 XHS/DOUYIN/GZH；GZH 卡片整体置灰（按钮 disabled，非纯视觉），
// UI 不产生 GZH job（P2 官方 API）。格式校验=PATCH 当前草稿（422 红字逐条列出 errors，不落库）；
// 「批准并发布」=PATCH status=APPROVED + POST /jobs（立刻，scheduledAt=now）→ 轮询 GET /jobs（2.5s，
// 终态 SUCCESS/FAILED/CANCELLED 停止并 refresh 一次）。未批准不产生任务，排期只发已批准内容。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Play, Sparkle, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PlanCard, type PublishPlan } from "./plan-card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  PLATFORMS,
  PLATFORM_LABEL,
  JOB_STATUS_LABEL,
  JOB_TERMINAL,
  publishFetch,
  type JobStatus,
  type Platform,
  type PublishPostDto,
} from "./publish-shared";
import { JobStatusBadge, VariantStatusBadge } from "./publish-status-badge";

const GZH_HINT = "未接入（P2 官方 API）";

// 各平台字数口径（源自 Task 3 format-check，红字以 422 返回为准，这里只做前置提示）
const LIMIT_HINT: Record<Platform, string> = {
  XHS: "小红书：标题≤20 字、标签≤10 个、图片≤9 张",
  DOUYIN: "抖音：标题≤30 字、正文≤55 字、标签 3-5 个",
  GZH: "公众号：主标题≤64 字（P1 未接入发布）",
};

function parseTags(text: string): string[] {
  return text
    .split(/[,，、\s]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}

export function VariantCards({ posts }: { posts: PublishPostDto[] }) {
  if (posts.length === 0) return null;
  return (
    <div className="flex flex-col gap-8">
      {posts.map((post) => (
        <section key={post.id} aria-label={post.title}>
          <div className="mb-3 flex items-baseline gap-2 border-b border-white/8 pb-2">
            <h2 className="text-sm font-medium text-foreground/90">{post.title}</h2>
            <span className="text-xs text-muted-foreground">
              {post.mediaPaths.length} 个媒体 · {post.variants.length}/3 平台已适配
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {PLATFORMS.map((platform) => {
              const variant = post.variants.find((v) => v.platform === platform) ?? null;
              return <PlatformCard key={`${post.id}-${platform}`} post={post} platform={platform} variant={variant} />;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PlatformCard({
  post,
  platform,
  variant,
}: {
  post: PublishPostDto;
  platform: Platform;
  variant: NonNullable<PublishPostDto["variants"][number]> | null;
}) {
  const live = platform !== "GZH";
  return (
    <article
      aria-label={`${PLATFORM_LABEL[platform]} 适配卡片`}
      className={`flex flex-col gap-3 rounded-lg border p-4 backdrop-blur-xl ${
        live
          ? "border-white/9 bg-[var(--surface-panel-bg)]"
          : "border-white/6 bg-black/20 opacity-60 saturate-50" // GZH 整体置灰
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{PLATFORM_LABEL[platform]}</span>
        {variant ? <VariantStatusBadge status={variant.status} /> : <span className="text-[11px] text-muted-foreground">未适配</span>}
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">{LIMIT_HINT[platform]}</p>

      {!live ? (
        // GZH 卡片置灰：只留状态，发布类入口全部禁用（控制器裁决①：UI 不产生 GZH job）
        <div className="mt-auto flex flex-col gap-2 border-t border-white/8 pt-3">
          <Button disabled title={GZH_HINT}>批准并发布</Button>
          <p className="text-[11px] text-muted-foreground">{GZH_HINT}</p>
        </div>
      ) : variant ? (
        <VariantEditor key={variant.id} post={post} platform={platform} variant={variant} />
      ) : (
        <VariantCreateForm post={post} platform={platform} />
      )}
    </article>
  );
}

type CardJob = { status: JobStatus; lastError: string | null; scheduledAt: string };

// 已有 variant：编辑 title/body/tags/cover + 格式校验 + 批准并发布（轮询 GET /jobs）
function VariantEditor({
  post,
  platform,
  variant,
}: {
  post: PublishPostDto;
  platform: Platform;
  variant: NonNullable<PublishPostDto["variants"][number]>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(variant.title);
  const [body, setBody] = useState(variant.body);
  const [tagsText, setTagsText] = useState(variant.tags.join(", "));
  const [cover, setCover] = useState(variant.coverPath ?? "");
  const [checkErrors, setCheckErrors] = useState<string[]>([]);
  const [checkNote, setCheckNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [job, setJob] = useState<CardJob | null>(
    variant.job ? { status: variant.job.status, lastError: variant.job.lastError, scheduledAt: variant.job.scheduledAt } : null
  );
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [planNote, setPlanNote] = useState(""); // AI 方案正文骨架（采纳后不覆盖正文，仅作提示）

  async function handleAdoptPlan(plan: PublishPlan, pickedTitle: string) {
    if (busy) return;
    setBusy(true);
    setPlanNote("");
    const wasApproved = variant.status === "APPROVED";
    try {
      // 采纳 = 写入选中标题 + 方案标签；bodyOutline 只进提示条不动正文（人工拍板）
      setTitle(pickedTitle);
      setTagsText(plan.tags.join(", "));
      // 已批准变体改内容 = 回到 DRAFT 重新走批准闸（内容变了，原批准失效）；PATCH 路由 status 白名单含 DRAFT
      const r = await publishFetch<{ warnings?: string[] }>(`/api/publish/variants/${variant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: pickedTitle, tags: plan.tags, ...(wasApproved ? { status: "DRAFT" } : {}) }),
      });
      if (!r.ok) {
        setCheckErrors(r.errors);
        setCheckNote(r.errors.length === 0 ? r.error : "");
        toast.error(`方案未保存：${r.errors[0] ?? r.error}（改短标题/标签后重试）`);
        return;
      }
      // 媒体缺口不卡采纳（内容已存），提示补齐后再批准
      if (r.data?.warnings?.length) {
        toast.warning(`${r.data.warnings[0]}——方案已保存，批准/发布前请先补传媒体`);
      }
      setDirty(false);
      setPlanNote(plan.bodyOutline ? `AI 方案正文骨架（参考，未覆盖正文）：${plan.bodyOutline}` : "");
      toast.success(wasApproved ? "方案已采纳（内容变更→已回到未批准，需重新批准并发布）" : "方案已采纳（标题/标签），核对后「批准并发布」");
    } finally {
      setBusy(false);
    }
  }
  // 轮询卸载清理（防卸载后 setState / 定时器泄漏）
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function schedulePoll(variantId: string) {
    const tick = async () => {
      const r = await publishFetch<
        Array<{ variantId: string; status: JobStatus; lastError: string | null; scheduledAt: string }>
      >("/api/publish/jobs");
      if (!r.ok) {
        setPublishNote(`任务查询失败：${r.error}`);
        return;
      }
      const found = r.data!.find((j) => j.variantId === variantId);
      if (found) {
        setJob({ status: found.status, lastError: found.lastError, scheduledAt: found.scheduledAt });
        if (JOB_TERMINAL.includes(found.status)) {
          if (found.status === "SUCCESS") toast.success(`${PLATFORM_LABEL[platform]} 发布成功`);
          else if (found.status === "FAILED") toast.error(`${PLATFORM_LABEL[platform]} 发布失败`);
          setJob(null);
          router.refresh(); // 终态后同步一次服务端数据（variant/post 状态已被 worker 更新）
          return;
        }
      }
      pollRef.current = setTimeout(() => void tick(), 2500);
    };
    void tick();
  }

  async function handleCheck() {
    if (busy) return;
    setBusy(true);
    setCheckNote("");
    setCheckErrors([]);
    try {
      const r = await publishFetch(`/api/publish/variants/${variant.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          body,
          tags: parseTags(tagsText),
          coverPath: cover === "" ? null : cover,
        }),
      });
      if (!r.ok) {
        setCheckErrors(r.errors); // 422 红字逐条；400/404 等走 error 文案
        setCheckNote(r.errors.length === 0 ? r.error : "");
        return;
      }
      setDirty(false);
      setCheckNote("校验通过，已保存");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveAndPublish() {
    if (busy) return;
    setBusy(true);
    setPublishNote("");
    try {
      // 1) 批准闸门：PATCH status=APPROVED（排期器只发 APPROVED）
      const approved = await publishFetch(`/api/publish/variants/${variant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      if (!approved.ok) {
        // 422 红字逐条（与格式校验同一逐条渲染口径），非 422 走 error 单行
        setCheckErrors(approved.errors);
        setCheckNote(approved.errors.length === 0 ? approved.error : "");
        return;
      }
      // 2) 建排期任务（立刻执行）
      const jobResp = await publishFetch<{ id: string; status: JobStatus; scheduledAt: string; lastError: string | null }>(
        "/api/publish/jobs",
        {
          method: "POST",
          body: JSON.stringify({ variantId: variant.id, scheduledAt: new Date().toISOString() }),
        }
      );
      if (!jobResp.ok) {
        setPublishNote(jobResp.error); // 409 已有任务等文案直接透传
        return;
      }
      setJob({ status: "PENDING", lastError: null, scheduledAt: new Date().toISOString() });
      schedulePoll(variant.id);
    } finally {
      setBusy(false);
    }
  }

  const jobBlocked = job !== null && !JOB_TERMINAL.includes(job.status);
  const published = variant.status === "PUBLISHED";

  return (
    <div className="flex flex-col gap-2.5 border-t border-white/8 pt-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`variant-title-${variant.id}`} className="text-[11px] text-muted-foreground">标题（{platform === "XHS" ? "≤20 字" : "≤30 字"}）</Label>
        <Input id={`variant-title-${variant.id}`} value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); setCheckErrors([]); setCheckNote(""); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`variant-body-${variant.id}`} className="text-[11px] text-muted-foreground">正文{platform === "DOUYIN" ? "（≤55 字）" : ""}</Label>
        <Textarea id={`variant-body-${variant.id}`} rows={3} value={body} onChange={(e) => { setBody(e.target.value); setDirty(true); setCheckErrors([]); setCheckNote(""); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`variant-tags-${variant.id}`} className="text-[11px] text-muted-foreground">标签（逗号分隔{platform === "XHS" ? "，5-10 个" : "，3-5 个"}）</Label>
        <Input id={`variant-tags-${variant.id}`} value={tagsText} onChange={(e) => { setTagsText(e.target.value); setDirty(true); setCheckErrors([]); setCheckNote(""); }} placeholder="热点话题, 生活记录, …" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`variant-cover-${variant.id}`} className="text-[11px] text-muted-foreground">封面（从内容媒体中选，可选）</Label>
        <select
          id={`variant-cover-${variant.id}`}
          value={cover}
          onChange={(e) => { setCover(e.target.value); setDirty(true); setCheckErrors([]); setCheckNote(""); }}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        >
          <option value="">不指定封面</option>
          {post.mediaPaths.map((m) => (
            <option key={m} value={m}>{m.split("/").pop()}</option>
          ))}
        </select>
      </div>

      {checkErrors.length > 0 ? (
        <div className="flex flex-col gap-1" role="alert">
          {checkErrors.map((err) => (
            <p key={err} className="flex items-start gap-1.5 text-xs leading-5 text-red-400">
              <Warning className="mt-0.5 size-3.5 shrink-0" weight="fill" />{err}
            </p>
          ))}
        </div>
      ) : checkNote === "校验通过，已保存" ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle className="size-3.5" weight="fill" />校验通过，已保存
        </p>
      ) : (
        checkNote !== "" && (
          <p className="text-xs leading-5 text-red-400" role="alert">{checkNote}</p>
        )
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-white/8 pt-3">
        {variant.status !== "PUBLISHED" ? (
          <PlanCard
            variantId={variant.id}
            initialPlanJson={variant.plan}
            canAdopt={true}
            onAdopt={(plan, t) => void handleAdoptPlan(plan, t)}
            onChanged={() => router.refresh()}
          />
        ) : null}
        {planNote && (
          <p className="text-[11px] leading-5 text-primary/90" role="note">{planNote}</p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleCheck()} disabled={busy || published}>
            格式校验
          </Button>
          <Button
            size="sm"
            onClick={() => void handleApproveAndPublish()}
            disabled={busy || jobBlocked || published}
            title={!dirty ? undefined : "有未保存修改，请先「格式校验」保存再发布"}
          >
            <Play className="size-3.5" weight="fill" />
            批准并发布
          </Button>
        </div>
        {dirty && !jobBlocked && !published && (
          <p className="text-[11px] text-amber-400/90">有未保存修改：先「格式校验」保存，再「批准并发布」</p>
        )}
        {job && !JOB_TERMINAL.includes(job.status) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <JobStatusBadge status={job.status} />
            任务{JOB_STATUS_LABEL[job.status]}，worker 每分钟扫描一次
          </p>
        )}
        {publishNote && <p className="text-xs leading-5 text-red-400">{publishNote}</p>}
      </div>
    </div>
  );
}

// 无 variant：创建适配版（POST 422 同样红字逐条；409 已存在→刷新）
function VariantCreateForm({
  post,
  platform,
}: {
  post: PublishPostDto;
  platform: Platform;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [tagsText, setTagsText] = useState("");
  const [cover, setCover] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors([]);
    setNote("");
    const r = await publishFetch("/api/publish/variants", {
      method: "POST",
      body: JSON.stringify({
        postId: post.id,
        platform,
        title: title.trim(),
        body,
        tags: parseTags(tagsText),
        ...(cover ? { coverPath: cover } : {}),
      }),
    });
    if (!r.ok) {
      setErrors(r.errors);
      setNote(r.errors.length === 0 ? r.error : "");
      setBusy(false);
      return;
    }
    toast.success(`${PLATFORM_LABEL[platform]} 适配版已创建`);
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void handleCreate(e)} className="mt-auto flex flex-col gap-2.5 border-t border-white/8 pt-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" aria-label={`${PLATFORM_LABEL[platform]}标题`} />
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="正文" aria-label={`${PLATFORM_LABEL[platform]}正文`} />
      <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="标签（逗号分隔）" aria-label={`${PLATFORM_LABEL[platform]}标签`} />
      <select
        value={cover}
        onChange={(e) => setCover(e.target.value)}
        aria-label={`${PLATFORM_LABEL[platform]}封面`}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring dark:bg-input/30"
      >
        <option value="">封面：不指定</option>
        {post.mediaPaths.map((m) => (
          <option key={m} value={m}>{m.split("/").pop()}</option>
        ))}
      </select>
      {errors.length > 0 && (
        <div role="alert" className="flex flex-col gap-1">
          {errors.map((err) => (
            <p key={err} className="flex items-start gap-1.5 text-xs leading-5 text-red-400">
              <Warning className="mt-0.5 size-3.5 shrink-0" weight="fill" />{err}
            </p>
          ))}
        </div>
      )}
      {note !== "" && errors.length === 0 && <p className="text-xs text-red-400">{note}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          {busy ? "创建中..." : "创建并校验"}
        </Button>
        <span className="text-[11px] text-muted-foreground">排期只发已批准内容</span>
      </div>
    </form>
  );
}
