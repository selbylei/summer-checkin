"use client";

// 规划层（Easel「策划」对齐）：DRAFT 变体一键「生成方案」——worker spawn pi headless
// （--no-tools，Agnes 模型）出发布方案 JSON；「采纳」把方案写进 variant（走既有 PATCH，
// 格式闸不变），仍须人工批准后才发布（100% 人工确认红线不动）。
import { useState } from "react";
import { Sparkle, Check } from "@phosphor-icons/react";
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

export function PlanButton({
  variantId,
  platform,
  onAdopt,
}: {
  variantId: string;
  platform: Platform;
  onAdopt: (plan: PublishPlan, pickedTitle: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(0);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const r = await publishFetch<{ plan: PublishPlan }>("/api/publish/plan-ai", {
        method: "POST",
        body: JSON.stringify({ variantId }),
      });
      if (!r.ok) {
        setError(r.error || "方案生成失败");
        setPlan(null);
        return;
      }
      setPlan(r.data?.plan ?? null);
      setPicked(0);
      toast.success("方案已生成，选一个标题采纳");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="outline" size="sm" onClick={() => void generate()} disabled={busy}>
        <Sparkle className="h-3.5 w-3.5" weight="fill" />
        {busy ? "生成中（约 30-60 秒）…" : plan ? "重新生成方案" : "生成方案"}
      </Button>

      {error && <p className="mt-2 text-xs text-red-400" role="alert">{error}</p>}

      {plan && !error && (
        <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
          <p className="text-[11px] font-medium text-primary">AI 发布方案（采纳后仍需人工批准发布）</p>
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
              <p className="text-[11px] text-muted-foreground">标题候选（选一个采纳）</p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {plan.titles.map((t, i) => (
                  <li key={i}>
                    <button
                      onClick={() => setPicked(i)}
                      className={`w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                        picked === i
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-white/10 text-foreground/75 hover:bg-white/5"
                      }`}
                    >
                      {picked === i && <Check className="mr-1 inline size-3 text-primary" weight="fill" />}
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                const t = plan.titles[picked] ?? "";
                onAdopt(plan, t);
              }}
            >
              采纳方案
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPlan(null)}>
              放弃
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
