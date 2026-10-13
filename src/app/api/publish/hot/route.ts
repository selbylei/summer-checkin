import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";

// GET /api/publish/hot?platform=：60s 热搜 API 服务端代理（Easel ln-apis.md 同款源，
// 免费无 key，禁止直抓平台官网）。5min 模块级缓存防打爆上游；白名单平台，防参数注入。
const HOT_BASE = "https://60s.viki.moe/v2";
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

  // 上游 8s 超时 + 失败不缓存（下次请求重试）；60s 偶发 500 属正常（其上游反爬抖动）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${HOT_BASE}/${platform}`, { signal: ctrl.signal });
    if (!res.ok) {
      return NextResponse.json(
        { error: `60s API 上游 ${res.status}（常见 500=上游抖动，稍后重试）` },
        { status: 502 }
      );
    }
    const data = await res.json();
    const raw: unknown = Array.isArray(data?.data) ? data.data : [data?.data].filter(Boolean);
    const items: HotItem[] = (raw as Array<Record<string, unknown>>)
      .map((d) => ({
        title: String(d.title ?? "").trim(),
        hot: Number(d.hot_value ?? d.hot ?? 0),
        url: String(d.url ?? "").trim(),
        cover: typeof d.cover === "string" && d.cover ? d.cover : null,
        platform: platform as HotPlatform,
      }))
      .filter((d) => d.title);
    cache.set(platform, { at: Date.now(), items });
    return NextResponse.json({ platform, items, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: `60s API 请求失败：${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
