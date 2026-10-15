import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET /api/publish/session/history?postId&chatId：读某条聊天记录的消息历史（worker 解析 pi 会话 .jsonl）。
// 域隔离：Post 必须归属当前 user（404 口径同 session/chat）。
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const postId = (req.nextUrl.searchParams.get("postId") ?? "").trim();
  const chatId = (req.nextUrl.searchParams.get("chatId") ?? "").trim();
  if (!postId || !chatId) return NextResponse.json({ error: "postId/chatId 必填" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(
      `${workerBase()}/session-chat-history?postId=${encodeURIComponent(postId)}&chatId=${encodeURIComponent(chatId)}`,
    );
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
