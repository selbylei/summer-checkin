import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET /api/publish/session/drafts?postId=：列该 Post 的会话草稿（agent 写盘的 drafts/<postId>/*.json）。
// 面板刷新页时重渲染出稿卡（MVP 聊天记录只在 pi 会话文件，草稿文件可恢复）。
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const postId = (req.nextUrl.searchParams.get("postId") ?? "").trim();
  if (!postId) return NextResponse.json({ error: "postId 必填" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/session-drafts?postId=${encodeURIComponent(postId)}`);
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
