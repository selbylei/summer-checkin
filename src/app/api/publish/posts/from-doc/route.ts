import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// POST /api/publish/posts/from-doc：阅读（/docs 文档工作台）导入为发布内容。
// Easel 无此概念，属本项目扩展：Document → Post（标题/正文直接搬运，媒体不复制）。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  if (!documentId) return NextResponse.json({ error: "documentId 必填" }, { status: 400 });

  // 域隔离：只能导自己的文档（404 口径同 posts）
  const doc = await prisma.document.findFirst({
    where: { id: documentId, userId: user.id },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.title.trim() || !doc.content.trim()) {
    return NextResponse.json({ error: "该文档无标题或正文，不可导入" }, { status: 422 });
  }

  const post = await prisma.post.create({
    data: {
      title: doc.title.trim(),
      body: doc.content.trim(),
      mediaPaths: [],
      fromHotlist: false,
      userId: user.id,
    },
  });
  return NextResponse.json({ post, document: { id: doc.id, title: doc.title } });
}
