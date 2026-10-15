import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// POST /api/publish/session/chat {postId, skill, message, chatId?, plan?, stream?}：发布会话聊天（一帖多条聊天记录；chatId 空则 worker 新建）。
// stream=true → SSE 透传（delta=pi 过程文本增量 / done=最终结果），跟正常 AI 聊天一样逐字显示；不传=同步 JSON（旧口径保留）。
// worker 内 pi --continue 续跑同一会话（首回合=工作流 prompt）；草稿更新读 agent 写盘的 drafts 文件。同步等待（上限 ~300s）。
// 域隔离：Post 必须归属当前 user（404 口径同 session/run）。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const skill = typeof body.skill === "string" ? body.skill : "";
  const message = typeof body.message === "string" ? body.message : "";
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const plan =
    body.plan && typeof body.plan === "object"
      ? (body.plan as { id?: string; name?: string; desc?: string; platform?: string; format?: string; skill?: string; mediaNote?: string })
      : undefined;
  if (!postId || !skill) return NextResponse.json({ error: "postId/skill 必填" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/session-chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId, skill, message, chatId, plan, ...(body.stream ? { stream: true } : {}) }),
    });
    // 流式=原样透传 SSE（worker 的 content-type/text 直传，边收边推）；同步=JSON 口径
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
    // worker 业务码透传（400/502）；仅网络层失败才 502「worker 未启动」
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
