import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// POST /api/publish/session/rename {postId, chatId, title}：改聊天记录名（sidebar 重命名）。
// 域隔离：Post 必须归属当前 user（404 口径同 session/chat）。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!postId || !chatId || !title) return NextResponse.json({ error: "postId/chatId/title 必填" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/session-rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId, chatId, title }),
    });
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
