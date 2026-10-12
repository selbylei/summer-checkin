import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// POST /api/publish/media（multipart：postId + file）：媒体落 data/publish/media/<postId>/（Global
// Constraints 约定目录，worker spawn cwd=仓库根，--images 用仓库相对路径），返 {path} 供回填 Post.mediaPaths
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const postId = String(form.get("postId") ?? "");
  const file = form.get("file");
  if (!postId || !(file instanceof File)) {
    return NextResponse.json({ error: "postId 与 file（multipart 字段）必填" }, { status: 400 });
  }

  // 域隔离：只能给归属当前 user 的 post 传媒体（postId 是库内 cuid，先验归属再落盘）
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 文件名消毒：basename + 剥掉非常规字符（防路径穿越/非法字符进 FS）
  const safeName =
    path
      .basename(file.name || "")
      .replace(/[^\w.\-]/g, "_")
      .slice(-80) || `upload-${Date.now()}`;

  const dir = path.join(process.cwd(), "data", "publish", "media", postId);
  await fs.mkdir(dir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, safeName), buf);

  // 返回仓库相对 POSIX 路径（与 worker contentArgs 的 --images 口径一致）
  const relPath = path.posix.join("data", "publish", "media", postId, safeName);
  return NextResponse.json({ path: relPath });
}
