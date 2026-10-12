import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// GET /api/publish/jobs/:id：Task 7 轮询出口。API 层 DB join 补 include variant（裁决②，
// 排期页要显示平台/状态；不动 worker，worker 的 GET /jobs/:id 保持裸 job 行）。
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const job = await prisma.publishJob.findFirst({
    where: { id, variant: { post: { userId: user.id } } },
    include: { variant: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}

// PATCH /api/publish/jobs/:id：改期（scheduledAt）或取消（cancel:true）。
// 前置拦截（照 plans 模式在 API 层 DB 操作，不调 worker）：
// 改期仅 PENDING（终态/运行态→409，裁决①）；取消对齐 worker 语义——终态→409，PENDING/RUNNING 可取消。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const job = await prisma.publishJob.findFirst({
    where: { id, variant: { post: { userId: user.id } } },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  if (body.cancel === true) {
    if (job.status !== "PENDING" && job.status !== "RUNNING") {
      return NextResponse.json(
        { error: "已结束的任务不可取消", status: job.status },
        { status: 409 }
      );
    }
    const updated = await prisma.publishJob.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json(updated);
  }

  if (job.status !== "PENDING") {
    return NextResponse.json(
      { error: "运行中/已结束的任务不可改期（仅 PENDING 可改期）", status: job.status },
      { status: 409 }
    );
  }
  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { error: "scheduledAt 必填（ISO 时间）或传 cancel:true" },
      { status: 400 }
    );
  }
  const updated = await prisma.publishJob.update({ where: { id }, data: { scheduledAt } });
  return NextResponse.json(updated);
}
