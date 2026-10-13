import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// POST /api/publish/jobs：建排期任务（Variant 1:1 Job，variantId @unique）。
// 同 variant 已有 PENDING/RUNNING→409；已有**终态**（FAILED/CANCELLED）job = 复用重触发：
// 重置为 PENDING + 新 scheduledAt + 清 lastError（1:1 不变量不变，解决「改方案后重发被 409 卡死」）；
// SUCCESS job 仍 409（已发布成功的内容重发需明确重新排期，走 PATCH 改期路径另议）。
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
    if (existing.status === "FAILED" || existing.status === "CANCELLED") {
      // 终态 job 复用重触发（方案变更/修复后重新排期）：重置 PENDING，保留 job 行（1:1 不变）
      const reused = await prisma.publishJob.update({
        where: { id: existing.id },
        data: { status: "PENDING", scheduledAt, lastError: null },
      });
      return NextResponse.json({ ...reused, reused: true });
    }
    return NextResponse.json(
      {
        error:
          existing.status === "PENDING"
            ? "该 variant 已有待发布任务（PENDING）"
            : `该 variant 已有任务（${existing.status}），不可重建——改期走 PATCH /api/publish/jobs/${existing.id}`,
      },
      { status: 409 }
    );
  }

  try {
    const job = await prisma.publishJob.create({ data: { variantId, scheduledAt } });
    return NextResponse.json(job);
  } catch (e) {
    // 并发兜底：同 variantId 两个 create 都过 pre-check 时，后者撞唯一约束
    // publishjob_variantId_key（P2002）→ 409；其他异常 rethrow
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "该 variant 已有任务，不可重建——改期/取消走 PATCH /api/publish/jobs/:id" },
        { status: 409 }
      );
    }
    throw e;
  }
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
