import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// POST /api/publish/session/plan {postId, chatId, message?, focus?}：规划回合（先出可执行方案，
// 用户确定方案后自动映射工作流技能再生成；Easel 策划层对齐）。focus=点了固定模板卡→只出 1 个该方向方案。
// 同步等待（上限 ~300s）。
// GET  /api/publish/session/plans?postId&chatId：读该纪录最近一次规划（刷新恢复方案选择卡）。
// 域隔离：Post 必须归属当前 user（404 口径同 session/chat）。

async function ownedPost(postId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { prisma } = await import("@/lib/prisma");
  return (await prisma.post.findFirst({ where: { id: postId, userId: user.id } })) ?? null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const message = typeof body.message === "string" ? body.message : "";
  const focus =
    body.focus && typeof body.focus.name === "string" && typeof body.focus.platform === "string"
      ? body.focus
      : undefined;
  if (!postId || !chatId) return NextResponse.json({ error: "postId/chatId 必填" }, { status: 400 });
  if (!(await ownedPost(postId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/session-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId, chatId, message, ...(focus ? { focus } : {}), ...(body.stream ? { stream: true } : {}) }),
    });
    // 流式=原样透传 SSE；同步=JSON 口径
    if (body.stream) {
      return new Response(resp.body, {
        status: resp.status,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    }
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const postId = (req.nextUrl.searchParams.get("postId") ?? "").trim();
  const chatId = (req.nextUrl.searchParams.get("chatId") ?? "").trim();
  if (!postId || !chatId) return NextResponse.json({ error: "postId/chatId 必填" }, { status: 400 });
  if (!(await ownedPost(postId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(
      `${workerBase()}/session-plans?postId=${encodeURIComponent(postId)}&chatId=${encodeURIComponent(chatId)}`,
    );
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
