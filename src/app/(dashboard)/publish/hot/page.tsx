"use client";

// 热点页（Easel「发现」层对齐）：60s 热搜 API 经 /api/publish/hot 代理（5min 缓存）。
// 每条热点两个动作：
//   「收藏为内容」= from-hot 建 Post（fromHotlist=true，封面图下载存 media）
//   「直接发布」= 收藏 + 自动建对应平台 Variant（60s 平台→发布平台映射；
//     微博/知乎/头条 无 Easel 适配器 → 仅收藏）
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flame, ArrowUpRight, BookmarkSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { publishFetch } from "@/components/publish/publish-shared";

const TABS = [
  { key: "douyin", label: "抖音" },
  { key: "weibo", label: "微博" },
  { key: "rednote", label: "小红书" },
  { key: "zhihu", label: "知乎" },
  { key: "toutiao", label: "头条" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// 60s 平台 → 可发布平台映射（无映射 = 该平台 Easel 无发布适配器，只收藏）
const VARIANT_MAP: Partial<Record<TabKey, "XHS" | "DOUYIN" | "GZH">> = {
  douyin: "DOUYIN",
  rednote: "XHS",
};

interface HotItem {
  title: string;
  hot: number;
  url: string;
  cover: string | null;
  platform: string;
}

export default function PublishHotPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("douyin");
  const [items, setItems] = useState<HotItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(""); // 正在操作的 title（防连点）
  const seqRef = useRef(0); // 防竞态：切 tab 时旧响应不得覆盖

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError("");
    const r = await publishFetch<{ platform: string; items: HotItem[] }>(
      `/api/publish/hot?platform=${tab}`
    );
    if (seq !== seqRef.current) return;
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setItems(r.data?.items ?? []);
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(item: HotItem, direct: boolean) {
    setActing(item.title);
    try {
      const r = await publishFetch<{ post?: { id: string; title: string }; variantError?: { errors?: string[] }; error?: string }>(
        "/api/publish/posts/from-hot",
        {
          method: "POST",
          body: JSON.stringify({
            title: item.title,
            url: item.url,
            coverUrl: item.cover ?? "",
            autoVariant: direct ? VARIANT_MAP[tab] : undefined,
          }),
        }
      );
      if (!r.ok) {
        toast.error(r.error || "收藏失败");
        return;
      }
      const vErr = r.data?.variantError?.errors?.join("；");
      if (direct && vErr) {
        toast.warning(`已收藏，但 ${tab} 平台适配版未建：${vErr}（去适配页编辑）`);
      } else if (direct) {
        toast.success("已收藏并创建适配版，去适配页批准后发布");
      } else {
        toast.success("已收藏为内容");
      }
      router.refresh();
      void load();
    } finally {
      setActing("");
    }
  }

  const publishPlatform = VARIANT_MAP[tab];

  return (
    <div className="product-page product-page--redesigned">
      <header className="product-header">
        <div>
          <p className="product-eyebrow">Publish hot topics</p>
          <h1 className="product-title">热点</h1>
          <p className="product-subtitle">实时热搜（60s 聚合源，5 分钟缓存）——收藏为内容或直接进入发布流程。</p>
        </div>
        <Link href="/publish" className="inline-flex">
          <Button variant="secondary">
            回内容
            <ArrowUpRight className="h-4 w-4" weight="bold" />
          </Button>
        </Link>
      </header>

      <div className="mt-7 flex flex-wrap items-center gap-2" role="tablist" aria-label="热搜平台">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "border border-white/10 text-foreground/70 hover:bg-white/5"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {publishPlatform ? (
        <p className="mt-3 text-xs text-muted-foreground">
          本 tab 热点可「直接发布」到 {publishPlatform === "DOUYIN" ? "抖音" : "小红书"}（自动建适配版，仍需人工批准后才发）。
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {tab === "weibo" ? "微博" : tab === "zhihu" ? "知乎" : "头条"}暂无发布适配器——热点可收藏为内容，去适配页选平台发布。
        </p>
      )}

      <section className="mt-4 flex flex-col gap-3" aria-label="热点列表">
        {loading && <p className="px-1 py-8 text-center text-xs text-muted-foreground">加载热搜中…</p>}
        {error && (
          <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-6 text-center text-xs text-red-300">
            {error}
            <span className="ml-2 inline-block">
              <Button variant="outline" size="xs" onClick={() => void load()}>重试</Button>
            </span>
          </p>
        )}
        {!loading && !error && items?.length === 0 && (
          <p className="px-1 py-8 text-center text-xs text-muted-foreground">该平台暂无热点数据</p>
        )}
        {items?.map((item) => (
          <article key={`${item.platform}-${item.title}`} className="product-row flex items-center gap-4 rounded-lg border border-white/9 bg-[var(--surface-panel-bg)] p-4 backdrop-blur-xl">
            {item.cover ? (
              // eslint-disable-next-line @next/next/no-img-element -- 60s 上游图床跨域，非本站静态资源，img 直读
              <img
                src={item.cover}
                alt=""
                className="size-14 shrink-0 rounded-md border border-white/10 object-cover"
              />
            ) : (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/15">
                <Flame className="size-5 text-primary" weight="duotone" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground" title={item.title}>{item.title}</p>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                {item.hot > 0 && <span className="tabular-nums">热度 {item.hot.toLocaleString()}</span>}
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-primary/80 underline underline-offset-2 hover:text-primary">
                    原链接
                  </a>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={acting !== ""}
                onClick={() => void handleSave(item, false)}
              >
                <BookmarkSimple className="h-3.5 w-3.5" />
                收藏为内容
              </Button>
              {publishPlatform && (
                <Button
                  size="sm"
                  disabled={acting !== ""}
                  onClick={() => void handleSave(item, true)}
                >
                  直接发布
                </Button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
