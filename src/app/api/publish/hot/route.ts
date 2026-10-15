import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";

// GET /api/publish/hot?platform=：热搜 API 服务端代理。
// 双源降级：主=60s.viki.moe（免费无 key），被 Cloudflare 限流（429/1027）或超时 → 自动切
// uapis.cn hotboard（已探活全平台可用，含封面）；两源都败才 502。
// 5min 模块级缓存（成功源结果；失败不缓存，下次重试）；白名单平台，防参数注入。
const VIKI_BASE = "https://60s.viki.moe/v2";
const UAPIS_BASE = "https://uapis.cn/api/v1/misc/hotboard";
const PLATFORMS = ["weibo", "douyin", "zhihu", "toutiao", "rednote"] as const;
type HotPlatform = (typeof PLATFORMS)[number];

const cache = new Map<string, { at: number; items: HotItem[] }>();
const CACHE_MS = 5 * 60 * 1000;

export interface HotItem {
  title: string;
  hot: number;
  url: string;
  cover: string | null;
  platform: HotPlatform;
}

async function fetchFromViki(platform: string): Promise<HotItem[]> {
  // 上游 8s 超时；429/5xx 抛错走 fallback
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${VIKI_BASE}/${platform}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`viki ${res.status}`);
    const data = await res.json();
    const raw: unknown = Array.isArray(data?.data) ? data.data : [data?.data].filter(Boolean);
    return (raw as Array<Record<string, unknown>>)
      .map((d) => ({
        title: String(d.title ?? "").trim(),
        hot: Number(d.hot_value ?? d.hot ?? 0),
        url: String(d.url ?? "").trim(),
        cover: typeof d.cover === "string" && d.cover ? d.cover : null,
        platform: platform as HotPlatform,
      }))
      .filter((d) => d.title);
  } finally {
    clearTimeout(timer);
  }
}

/** uapis 兜底源：字段映射 list[].{title,url,hot_value,extra.cover} */
async function fetchFromUapis(platform: string): Promise<HotItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${UAPIS_BASE}?type=${platform}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`uapis ${res.status}`);
    const data = (await res.json()) as { list?: Array<Record<string, unknown>> };
    return (data.list ?? [])
      .map((d) => ({
        title: String(d.title ?? "").trim(),
        hot: Number(d.hot_value ?? 0),
        url: String(d.url ?? "").trim(),
        cover:
          typeof (d.extra as { cover?: unknown } | undefined)?.cover === "string"
            ? ((d.extra as { cover?: string }).cover ?? null)
            : null,
        platform: platform as HotPlatform,
      }))
      .filter((d) => d.title);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const platform = new URL(req.url).searchParams.get("platform") ?? "douyin";
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json(
      { error: `platform 仅支持 ${PLATFORMS.join("/")}` },
      { status: 400 }
    );
  }

  const hit = cache.get(platform);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json({ platform, items: hit.items, cached: true });
  }

  // 双源降级：60s 被限流很常见（Cloudflare 429/1027），失败立即切 uapis
  let items: HotItem[] = [];
  let source = "viki";
  try {
    items = await fetchFromViki(platform);
  } catch {
    try {
      items = await fetchFromUapis(platform);
      source = "uapis";
    } catch (e) {
      return NextResponse.json(
        { error: `热搜源均不可用（60s/uapis）：${e instanceof Error ? e.message : String(e)}，稍后重试` },
        { status: 502 }
      );
    }
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "热搜源暂无数据（上游空列表），稍后重试" }, { status: 502 });
  }
  cache.set(platform, { at: Date.now(), items });
  return NextResponse.json({ platform, items, cached: false, source });
}
