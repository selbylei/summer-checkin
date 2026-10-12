import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// POST /api/publish/posts：建内容中枢 Post（P1；mediaPaths 由 media 路由上传回填）
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.body === "string" ? body.body.trim() : "";
  const mediaPaths = Array.isArray(body.mediaPaths)
    ? body.mediaPaths.filter((p: unknown) => typeof p === "string")
    : [];
  if (!title || !content) {
    return NextResponse.json({ error: "title/body 必填" }, { status: 400 });
  }

  // user 域隔离：Post 挂 userId（Task 1 表无该列，Task 6 缺口裁决① 补列）
  const post = await prisma.post.create({
    data: { title, body: content, mediaPaths, userId: user.id },
  });
  return NextResponse.json(post);
}
