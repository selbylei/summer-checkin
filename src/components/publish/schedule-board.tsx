"use client";

// 排期页任务列表（brief Step 4）：GET /jobs（含 variant 摘要）；改期/取消走 PATCH /jobs/:id；
// 存在 PENDING/RUNNING 时每 5s 轮询一次（全部终态停；卸载清理）。FAILED 且 lastError 含
// 「需人工验证码」→ 黄条提示（brief Step 4 文案；匹配词 = worker markFailed 落库的稳定串「需人工验证码」，
// lastError 里另拼的 stderr 摘要不定，旧词「短信验证码」断链）。未批准的 variant 任务置灰：排期只发已批准内容。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowClockwise, Timer, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PLATFORM_LABEL,
  JOB_TERMINAL,
  publishFetch,
  formatDateTime,
  toDatetimeLocalValue,
  type PublishJobDto,
} from "./publish-shared";
import { JobStatusBadge } from "./publish-status-badge";

// brief Step 4 逐字文案：抖音短信验证码风控墙
const SMS_WALL_HINT = "抖音风控墙，需人工：终端跑 douyin_publish.py 或等下次确认";

export function ScheduleBoard() {
  const [jobs, setJobs] = useState<PublishJobDto[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null); // 正在改期的 job.id
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [cancelTarget, setCancelTarget] = useState<PublishJobDto | null>(null);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await publishFetch<PublishJobDto[]>("/api/publish/jobs");
    if (!aliveRef.current) return;
    if (r.ok) {
      setJobs(r.data);
      setLoadError("");
    } else {
      setLoadError(r.error);
    }
  }, []);

  // 首次加载 + 卸载清理
  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  // 存在非终态任务时 5s 轮询（终态即停；卸载/状态变化时清理定时器）
  useEffect(() => {
    if (!jobs || !jobs.some((j) => !JOB_TERMINAL.includes(j.status))) return;
    timerRef.current = setTimeout(() => void load(), 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobs, load]);

  async function handleReschedule(job: PublishJobDto) {
    setBusy(true);
    try {
      const r = await publishFetch(`/api/publish/jobs/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ scheduledAt: new Date(rescheduleValue).toISOString() }),
      });
      if (!r.ok) {
        setRowErrors((prev) => ({ ...prev, [job.id]: r.error }));
        return;
      }
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      const r = await publishFetch(`/api/publish/jobs/${cancelTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ cancel: true }),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("任务已取消");
      setCancelTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const activeJobs = (jobs ?? []).filter((j) => !JOB_TERMINAL.includes(j.status)).length;

  if (loadError) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-red-400/25 bg-red-400/5 p-5">
        <p className="text-sm text-red-400">排期任务加载失败：{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>重试</Button>
      </div>
    );
  }

  if (jobs && jobs.length === 0) {
    return (
      <div className="flex min-h-60 flex-col items-center justify-center border border-dashed border-white/16 bg-black/10 px-5 text-center">
        <Timer className="size-7 text-primary" weight="duotone" />
        <h2 className="mt-3 text-sm font-medium text-foreground">还没有排期任务</h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          在适配页对已批准的适配版点「批准并发布」，任务会立刻进入发布队列。
        </p>
        <div className="mt-3">
          <Link href="/publish/variants" className="text-xs font-medium text-primary hover:underline">去适配页</Link>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="排期任务">
      <div className="mb-4 flex items-center justify-between border-b border-white/8 pb-3">
        <div>
          <h2 className="text-sm font-medium text-foreground/90">排期任务</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeJobs} 个进行中 · worker 每分钟扫描到期任务
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <ArrowClockwise className="size-3.5" weight="bold" />
          刷新
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {(jobs ?? []).map((job) => {
          // 未批准 = variant 仍 DRAFT；PUBLISHED=已批准放行（worker 发布成功后置 PUBLISHED），SUCCESS 行不得置灰
          const unapproved = job.variant.status === "DRAFT";
          const isSmsWall = job.status === "FAILED" && (job.lastError ?? "").includes("需人工验证码");
          const canReschedule = job.status === "PENDING";
          const canCancel = job.status === "PENDING" || job.status === "RUNNING";
          const isView = job.status === "SUCCESS" || job.status === "FAILED";
          return (
            <div
              key={job.id}
              className={`product-row flex flex-col gap-2.5 rounded-lg border p-4 backdrop-blur-xl ${
                unapproved
                  ? "border-white/6 bg-black/20 opacity-60 saturate-50"
                  : "border-white/9 bg-[var(--surface-panel-bg)]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-xs font-semibold text-foreground">{PLATFORM_LABEL[job.variant.platform]}</span>
                <JobStatusBadge status={job.status} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{job.variant.title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(job.scheduledAt)}</span>
              </div>

              {unapproved && (
                <p className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-muted-foreground">
                  未批准：排期只发已批准内容——到适配页批准后，worker 才会执行
                </p>
              )}

              {isSmsWall && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs leading-5 text-amber-300">
                  <Warning className="mt-0.5 size-3.5 shrink-0" weight="fill" />
                  {SMS_WALL_HINT}
                </p>
              )}

              {!isSmsWall && job.status === "FAILED" && job.lastError && (
                <p className="text-xs leading-5 text-red-400">失败原因：{job.lastError}</p>
              )}

              {rowErrors[job.id] && <p className="text-xs leading-5 text-red-400">{rowErrors[job.id]}</p>}

              {editing === job.id && canReschedule && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={rescheduleValue}
                    onChange={(e) => setRescheduleValue(e.target.value)}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-xs text-foreground outline-none focus-visible:border-ring dark:bg-input/30"
                    aria-label="新的发布时间"
                  />
                  <Button size="sm" onClick={() => void handleReschedule(job)} disabled={busy || !rescheduleValue}>
                    确认改期
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                </div>
              )}

              {(canReschedule || canCancel) && (
                <div className="flex items-center gap-2">
                  {canReschedule && (
                    editing === job.id ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(job.id);
                          setRescheduleValue(toDatetimeLocalValue(job.scheduledAt));
                        }}
                      >
                        改期
                      </Button>
                    )
                  )}
                  {canCancel && (
                    <Button variant="ghost" size="sm" onClick={() => setCancelTarget(job)}>
                      取消任务
                    </Button>
                  )}
                </div>
              )}

              {isView && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      window.location.href = `/publish/logs?jobId=${encodeURIComponent(job.id)}`;
                    }}
                  >
                    查看作品/日志
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="border border-white/12 bg-background/95 text-foreground backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>取消这个排期任务？</DialogTitle>
            <DialogDescription>
              「{cancelTarget?.variant.title}」（{cancelTarget ? PLATFORM_LABEL[cancelTarget.variant.platform] : ""}）取消后不再发布。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>再想想</Button>
            <Button variant="destructive" onClick={() => void handleCancel()} disabled={busy}>
              {busy ? "取消中..." : "确认取消"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
