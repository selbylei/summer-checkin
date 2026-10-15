import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET  /api/publish/session/chats?postId=：列该 Post 的聊天记录（sidebar 纪录列表，按最后活跃倒序）。
// POST /api/publish/session/chats {postId, chatId, title}：新建一条空纪录（sidebar「新对话」）。
// DELETE /api/publish/session/chats {postId, chatId}：删一条纪录（含 pi 会话+出稿）。
// 域隔离：Post 必须归属当前 user（404 口径同 session/chat）。

async function ownedPost(postId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { prisma } = await import("@/lib/prisma");
  return (await prisma.post.findFirst({ where: { id: postId, userId: user.id } })) ?? null;
}

export async function GET(req: NextRequest) {
  const postId = (req.nextUrl.searchParams.get("postId") ?? "").trim();
  if (!postId) return NextResponse.json({ error: "postId 必填" }, { status: 400 });
  const post = await ownedPost(postId);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/session-chats?postId=${encodeURIComponent(postId)}`);
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const title = typeof body.title === "string" ? body.title : "";
  if (!postId || !chatId) return NextResponse.json({ error: "postId/chatId 必填" }, { status: 400 });
  const post = await ownedPost(postId);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/session-chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId, chatId, title: title || post.title }),
    });
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!postId || !chatId) return NextResponse.json({ error: "postId/chatId 必填" }, { status: 400 });
  const post = await ownedPost(postId);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/session-chats`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId, chatId }),
    });
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
