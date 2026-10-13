import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// POST /api/publish/posts/from-hot：热点收藏为内容（Easel「发现」层对齐）。
// {title, url, coverUrl?, autoVariant?: "XHS"|"DOUYIN"|"GZH"}
// → 建 Post（fromHotlist=true，body=来源链接，封面下载落 data/publish/media/<postId>/）
// → autoVariant 时同平台建 Variant（走 checkVariant 格式闸，422 时 post 保留、variantError 透传）
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const coverUrl = typeof body.coverUrl === "string" && body.coverUrl ? body.coverUrl : null;
  const autoVariant = (["XHS", "DOUYIN", "GZH"] as string[]).includes(String(body.autoVariant))
    ? (body.autoVariant as "XHS" | "DOUYIN" | "GZH")
    : null;
  if (!title) return NextResponse.json({ error: "title 必填" }, { status: 400 });

  const post = await prisma.post.create({
    data: {
      title,
      body: url ? `来源：${url}` : "",
      mediaPaths: [],
      fromHotlist: true,
      userId: user.id,
    },
  });

  // 封面下载（8s 超时；失败不阻断——热点内容主体仍成立，仅无图）
  let mediaPaths: string[] = [];
  if (coverUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(coverUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const dir = path.join(process.cwd(), "data", "publish", "media", post.id);
        await fs.mkdir(dir, { recursive: true });
        const name = "hot-cover.jpg";
        await fs.writeFile(path.join(dir, name), buf);
        mediaPaths = [path.posix.join("data", "publish", "media", post.id, name)];
      }
    } catch {
      // 封面下载失败静默（上游图床跨域/超时常见），保留无图内容
    }
  }
  if (mediaPaths.length) {
    await prisma.post.update({ where: { id: post.id }, data: { mediaPaths } });
    post.mediaPaths = mediaPaths;
  }

  let variant: unknown = null;
  let variantError: unknown = null;
  if (autoVariant) {
    const { checkVariant } = await import("@/lib/publish/format-check");
    const check = checkVariant(autoVariant, {
      title,
      body: url ? `来源：${url}` : "",
      tags: [],
      mediaCount: mediaPaths.length,
    });
    if (!check.ok) {
      variantError = { errors: check.errors, hint: "热点标题/正文超该平台上限，可先收藏后在适配页编辑" };
    } else {
      variant = await prisma.postVariant.create({
        data: {
          postId: post.id,
          platform: autoVariant,
          title,
          body: url ? `来源：${url}` : "",
          tags: [],
        },
      });
    }
  }

  return NextResponse.json({ post, variant, variantError }, { status: 200 });
}
