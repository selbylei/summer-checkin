import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// POST /api/publish/jobs：建排期任务（Variant 1:1 Job，variantId @unique）。
// 同 variant 已有 PENDING→409；已有终态/运行态 job 同样 409（1:1 约束下不允许重建，
// 改期走 PATCH /jobs/:id，裁决①：终态/运行态改期→409）。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  if (!variantId) return NextResponse.json({ error: "variantId 必填" }, { status: 400 });
  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "scheduledAt 必填（ISO 时间）" }, { status: 400 });
  }

  // 域隔离：variant 经 post.userId 归属当前 user
  const variant = await prisma.postVariant.findFirst({
    where: { id: variantId, post: { userId: user.id } },
  });
  if (!variant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.publishJob.findFirst({ where: { variantId } });
  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.status === "PENDING"
            ? "该 variant 已有待发布任务（PENDING）"
            : `该 variant 已有任务（${existing.status}），不可重建——改期/取消走 PATCH /api/publish/jobs/${existing.id}`,
      },
      { status: 409 }
    );
  }

  const job = await prisma.publishJob.create({ data: { variantId, scheduledAt } });
  return NextResponse.json(job);
}

// GET /api/publish/jobs：当前 user 的排期任务列表（排期页；含 variant 摘要供显示平台/状态）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await prisma.publishJob.findMany({
    where: { variant: { post: { userId: user.id } } },
    include: { variant: { select: { id: true, platform: true, status: true, title: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  return NextResponse.json(jobs);
}
