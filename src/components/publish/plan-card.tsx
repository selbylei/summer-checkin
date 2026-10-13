"use client";

// 规划层（Easel「策划」对齐）：worker spawn pi headless（--no-tools，Agnes）出发布方案 JSON。
// 持久化语义（2026-10-13 拍板）：
//   · 方案生成一次后存 variant.plan，再次打开**直接显示，不重新生成**（下次不用再生成）
//   · 「重新生成」= force 重跑模型并覆盖
//   · 「撤销方案」= DELETE 置 null，可重新生成/重选；已批准（APPROVED/PUBLISHED）的 variant 也显示方案，
//     可撤销重选（撤销只清方案缓存，不影响已批准/已发布状态与排期）
import { useState } from "react";
import { Sparkle, Check, ArrowClockwise, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { publishFetch, type Platform } from "./publish-shared";

export interface PublishPlan {
  angle: string;
  format: string;
  titles: string[];
  bodyOutline: string;
  tags: string[];
  timeliness: string;
}

function parsePlanJson(raw: string | null | undefined): PublishPlan | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublishPlan;
  } catch {
    return null;
  }
}

export function PlanCard({
  variantId,
  initialPlanJson,
  canAdopt,
  onAdopt,
  onChanged,
}: {
  variantId: string;
  /** variant.plan 原始 JSON（服务端序列化传入）；非空 = 已有方案，直接展示不重新生成 */
  initialPlanJson?: string | null;
  /** DRAFT 才允许「采纳」（写标题/标签走 422 格式闸）；已批准/已发布只读展示 + 可撤销重选 */
  canAdopt: boolean;
  onAdopt: (plan: PublishPlan, pickedTitle: string) => void;
  /** 方案被撤销/重新生成后通知父组件（router.refresh 同步服务端数据） */
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [plan, setPlan] = useState<PublishPlan | null>(() => parsePlanJson(initialPlanJson));
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(0);

  async function generate(force: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await publishFetch<{ plan: PublishPlan; cached?: boolean }>("/api/publish/plan-ai", {
        method: "POST",
        body: JSON.stringify({ variantId, force }),
      });
      if (!r.ok) {
        setError(r.error || "方案生成失败");
        return;
      }
      const p = r.data?.plan ?? null;
      setPlan(p);
      setPicked(0);
      toast.success(force ? "方案已重新生成" : "方案已生成");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function clearPlan() {
    setClearing(true);
    try {
      // POST 撤销（DELETE 请求走 better-auth 中间件会 307 到 /login，拿不到 JSON）
      const r = await publishFetch<{ cleared?: boolean; error?: string }>("/api/publish/plan-ai/clear", {
        method: "POST",
        body: JSON.stringify({ variantId }),
      });
      if (!r.ok) {
        toast.error(r.error || "撤销失败");
        return;
      }
      setPlan(null);
      toast.success("方案已撤销，可重新生成");
      onChanged?.();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void generate(plan !== null)} disabled={busy || clearing}>
          <Sparkle className="h-3.5 w-3.5" weight="fill" />
          {busy ? "生成中（约 30-60 秒）…" : plan ? "重新生成" : "生成方案"}
        </Button>
        {plan && (
          <Button variant="ghost" size="sm" onClick={() => void clearPlan()} disabled={busy || clearing} title="撤销当前方案（不影响已批准/发布状态），可重新生成">
            <X className="h-3.5 w-3.5" />
            {clearing ? "撤销中…" : "撤销方案"}
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400" role="alert">
          {error}
          <Button variant="outline" size="xs" onClick={() => void generate(true)}>
            <ArrowClockwise className="h-3 w-3" />
            重试
          </Button>
        </p>
      )}

      {plan && !error && (
        <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
          <p className="text-[11px] font-medium text-primary">
            AI 发布方案{!canAdopt ? "（已批准/已发布，只读展示；可撤销后重新选择）" : "（采纳后仍需人工批准发布）"}
          </p>
          <dl className="mt-2 grid gap-1.5 text-xs text-foreground/85">
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-muted-foreground">切入</dt>
              <dd>{plan.angle}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-muted-foreground">形式</dt>
              <dd>{plan.format}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-muted-foreground">正文骨架</dt>
              <dd className="leading-5">{plan.bodyOutline}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-muted-foreground">标签</dt>
              <dd>{plan.tags.join("、") || "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-muted-foreground">时效</dt>
              <dd>{plan.timeliness}</dd>
            </div>
          </dl>

          {plan.titles.length > 0 && (
            <div className="mt-2.5">
              <p className="text-[11px] text-muted-foreground">
                标题候选{canAdopt ? "（选一个采纳）" : ""}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {plan.titles.map((t, i) => (
                  <li key={i}>
                    <button
                      onClick={() => canAdopt && setPicked(i)}
                      className={`w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                        picked === i && canAdopt
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-white/10 text-foreground/75 hover:bg-white/5"
                      } ${canAdopt ? "" : "cursor-default opacity-70"}`}
                    >
                      {picked === i && canAdopt && <Check className="mr-1 inline size-3 text-primary" weight="fill" />}
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canAdopt && (
            <div className="mt-2.5">
              <Button
                size="sm"
                onClick={() => {
                  const t = plan.titles[picked] ?? "";
                  if (!t) {
                    toast.warning("先选一个标题候选再采纳");
                    return;
                  }
                  onAdopt(plan, t);
                }}
              >
                采纳方案
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
