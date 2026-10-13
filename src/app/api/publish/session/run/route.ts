import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// POST /api/publish/session/run {postId, skill}：执行技能工作流（选技能=选工作流，Easel 对齐）。
// worker 内 spawn pi（--skill 原生发现 + read/write 工具面，agent 自读 SKILL.md/references/shared 照流程出稿）；同步等待（上限 ~300s）。
// 域隔离：Post 必须归属当前 user（404 口径同 posts/[id]）。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const skill = typeof body.skill === "string" ? body.skill : "";
  if (!postId || !skill) return NextResponse.json({ error: "postId/skill 必填" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/skill-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId, skill }),
    });
    const data = await resp.json().catch(() => ({}));
    // worker 业务码透传（400/502）；仅网络层失败才 502「worker 未启动」
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
