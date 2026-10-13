import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// GET /api/publish/docs：当前 user 的阅读（/docs 工作台）文档列表（导入候选，预览 60 字）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const docs = await prisma.document.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, updatedAt: true, content: true },
  });
  return NextResponse.json({
    docs: docs.map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updatedAt.toISOString(),
      preview: d.content.slice(0, 60).replace(/\s+/g, " "),
    })),
  });
}
