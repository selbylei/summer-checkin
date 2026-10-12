import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// GET /api/publish/logs?jobId=：日志页时间线（PLAN/PUBLISH/VERIFY/COLLECT，按创建序）
// 域隔离：job 经 variant.post.userId 归属当前 user，他人 job→404（口径同 plans）
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId") ?? "";
  if (!jobId) return NextResponse.json({ error: "jobId 参数必填" }, { status: 400 });

  const job = await prisma.publishJob.findFirst({
    where: { id: jobId, variant: { post: { userId: user.id } } },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const logs = await prisma.publishLog.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(logs);
}
