import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// GET/PATCH /api/publish/posts/:id（照 plans/[id] 路由模式：401 未鉴权 / 404 非本 user 域）
// 域隔离用 findFirst({where:{id,userId}}) 复合条件（Prisma findUnique 不接受非唯一组合字段，
// 语义与「where 加 userId」等价）

async function findOwnedPost(id: string, userId: string) {
  return prisma.post.findFirst({ where: { id, userId } });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const post = await findOwnedPost(id, user.id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(post);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const post = await findOwnedPost(id, user.id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (typeof body.body === "string") data.body = body.body;
  if (Array.isArray(body.mediaPaths)) {
    data.mediaPaths = body.mediaPaths.filter((p: unknown) => typeof p === "string");
  }
  if (body.status !== undefined && ["DRAFT", "READY", "PUBLISHED", "FAILED"].includes(body.status)) {
    data.status = body.status;
  }

  const updated = await prisma.post.update({ where: { id }, data });
  return NextResponse.json(updated);
}
