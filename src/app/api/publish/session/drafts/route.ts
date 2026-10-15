import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET /api/publish/session/drafts?postId&chatId?：列该 Post 的会话草稿（带 chatId = 该条聊天记录自己的出稿；
// 不带 = 旧口径 post 根级，兼容冒烟遗留数据）。面板刷新/切换纪录时重渲染出稿卡。
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const postId = (req.nextUrl.searchParams.get("postId") ?? "").trim();
  const chatId = (req.nextUrl.searchParams.get("chatId") ?? "").trim();
  if (!postId) return NextResponse.json({ error: "postId 必填" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const qs = chatId ? `?postId=${encodeURIComponent(postId)}&chatId=${encodeURIComponent(chatId)}` : `?postId=${encodeURIComponent(postId)}`;
    const resp = await fetch(`${workerBase()}/session-drafts${qs}`);
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
