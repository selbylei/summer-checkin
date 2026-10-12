import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { checkVariant, type Platform } from "@/lib/publish/format-check";

const PLATFORMS: Platform[] = ["GZH", "DOUYIN", "XHS"];

// POST /api/publish/variants：每 post 每 platform 至多 1 个（@@unique）；入库前跑 Task 3
// checkVariant，errors 非空→422 直接透传 {errors}（不落库）；GZH 可建可审批，发布时 worker 明确 FAILED
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const postId = typeof body.postId === "string" ? body.postId : "";
  const platform = String(body.platform ?? "").toUpperCase() as Platform;
  if (!postId || !(PLATFORMS as string[]).includes(platform)) {
    return NextResponse.json(
      { error: "postId/platform 必填，platform 仅 GZH/DOUYIN/XHS" },
      { status: 400 }
    );
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.body === "string" ? body.body : "";
  const tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string") : [];
  if (!title) return NextResponse.json({ error: "title 必填" }, { status: 400 });

  // 域隔离：post 必须归属当前 user（404 口径同 plans）
  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    select: { id: true, mediaPaths: true },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const dup = await prisma.postVariant.findFirst({ where: { postId, platform } });
  if (dup) {
    return NextResponse.json({ error: `该 post 的 ${platform} 适配版已存在` }, { status: 409 });
  }

  // 图片数上限按 post 媒体总数校验（variant 无独立媒体列表，media 路由回填到 Post.mediaPaths）
  const check = checkVariant(platform, {
    title,
    body: content,
    tags,
    mediaCount: post.mediaPaths.length,
  });
  if (!check.ok) {
    return NextResponse.json({ errors: check.errors }, { status: 422 });
  }

    const variant = await prisma.postVariant.create({
    data: {
      postId,
      platform,
      title,
      body: content,
      tags,
      // formatCheck 列存校验结果 JSON（Task 1 schema 注释：校验不过→422 不落库，这里只存通过结果）
      formatCheck: JSON.stringify(check),
      ...(typeof body.coverPath === "string" && body.coverPath ? { coverPath: body.coverPath } : {}),
    },
  });
  return NextResponse.json(variant);
}
