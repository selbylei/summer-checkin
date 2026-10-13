"use client";

// 日志页（brief Step 6）：jobId 选择器 + GET /logs?jobId= 时间线（stage 徽章 +
// detail 折叠 pre + 截图路径）。P1 screenshotPath 恒为 null（worker 未写截图），
// 有值时按本地路径展示（data/publish/... 无 web 静态路由，不造）。
import { useEffect, useRef, useState } from "react";
import { Archive } from "@phosphor-icons/react";
import {
  publishFetch,
  formatTime,
  type PublishLogDto,
} from "./publish-shared";
import { LogStageBadge } from "./publish-status-badge";

export interface PublishJobOption {
  id: string;
  label: string; // 服务端拼好的「平台 · 标题 · 计划时间 · 状态」
}

export function LogsPanel({ jobs, initialJobId = "" }: { jobs: PublishJobOption[]; initialJobId?: string }) {
  // 支持 ?jobId= 深链（排期页「查看作品」跳入；服务端 page 读 searchParams 传入，避免 useSearchParams 的 Suspense 约束）
  const [jobId, setJobId] = useState(initialJobId);
  const [logs, setLogs] = useState<PublishLogDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqSeqRef = useRef(0); // 防竞态：快速切换 job 时旧响应不得覆盖新响应

  useEffect(() => {
    if (!jobId) return; // 选择清空时不取数（渲染层用 jobId 门控，旧列表自然隐藏）
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setError("");
    void (async () => {
      const r = await publishFetch<PublishLogDto[]>(`/api/publish/logs?jobId=${encodeURIComponent(jobId)}`);
      if (seq !== reqSeqRef.current) return; // 已有更新的请求
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLogs(r.data);
    })();
  }, [jobId]);

  if (jobs.length === 0) {
    return (
      <div className="flex min-h-60 flex-col items-center justify-center border border-dashed border-white/16 bg-black/10 px-5 text-center">
        <Archive className="size-7 text-primary" weight="duotone" />
        <h2 className="mt-3 text-sm font-medium text-foreground">还没有发布日志</h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">发布任务执行后，规划/发布/验证各阶段的留痕会出现在这里。</p>
      </div>
    );
  }

  return (
    <section aria-label="发布日志">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <h2 className="text-sm font-medium text-foreground/90">发布日志</h2>
          <p className="mt-1 text-xs text-muted-foreground">按任务查看执行留痕，验证日志用于读回对账。</p>
        </div>
        <select
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          aria-label="选择发布任务"
          className="max-w-72 rounded-lg border border-input bg-transparent px-2.5 py-2 text-xs text-foreground outline-none focus-visible:border-ring dark:bg-input/30"
        >
          <option value="">选择发布任务…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.label}</option>
          ))}
        </select>
      </div>

      {!jobId && (
        <p className="rounded-lg border border-dashed border-white/12 bg-black/10 px-4 py-6 text-center text-xs text-muted-foreground">
          在右上角选择一个发布任务查看时间线
        </p>
      )}

      {jobId && loading && <p className="px-1 py-6 text-center text-xs text-muted-foreground">加载日志中…</p>}
      {error && <p className="px-1 py-6 text-center text-xs text-red-400">{error}</p>}

      {jobId && !loading && !error && logs !== null && (
        <ol className="flex flex-col gap-3">
          {logs.length === 0 && (
            <li className="rounded-lg border border-dashed border-white/12 bg-black/10 px-4 py-6 text-center text-xs text-muted-foreground">
              该任务暂无日志（worker 未执行或已清理）
            </li>
          )}
          {logs.map((log) => (
            <li key={log.id} className="product-row rounded-lg border border-white/9 bg-[var(--surface-panel-bg)] p-4 backdrop-blur-xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <LogStageBadge stage={log.stage} />
                <span className="text-xs tabular-nums text-muted-foreground">{formatTime(log.createdAt)}</span>
                {log.screenshotPath && (
                  <span className="ml-auto truncate text-[11px] tabular-nums text-muted-foreground/70" title={log.screenshotPath}>
                    截图：{log.screenshotPath}
                  </span>
                )}
              </div>
              <details className="mt-2.5">
                <summary className="cursor-pointer text-xs text-muted-foreground transition hover:text-foreground">
                  详情
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-white/8 bg-black/25 p-3 text-[11px] leading-5 text-foreground/85 whitespace-pre-wrap break-all">
                  {log.detail}
                </pre>
                {(() => {
                  // 产物可见：PUBLISH/VERIFY 的 detail 里读回 URL 变可点链接（直接开平台作品页）
                  const urls = (log.detail.match(/https?:\/\/[^\s）)\]，,;]+/g) ?? [])
                    .filter((u) => u.startsWith("http") && !u.endsWith("/") || true);
                  const links = [...new Set(urls)].slice(0, 4);
                  if (links.length === 0) return null;
                  return (
                    <p className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      查看作品：
                      {links.map((u) => (
                        <a
                          key={u}
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
                        >
                          {u.length > 48 ? `${u.slice(0, 48)}…` : u}
                        </a>
                      ))}
                    </p>
                  );
                })()}
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
