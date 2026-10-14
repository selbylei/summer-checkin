import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { checkVariant } from "@/lib/publish/format-check";

// PATCH /api/publish/variants/:id：改 title/body/tags/cover 后重新跑 checkVariant（不过→422 不落库）；
// {status:"APPROVED"} 即人工确认闸门（排期只发 APPROVED）。
// status 只允许 DRAFT/APPROVED——PUBLISHED 由 worker 发布成功后落（对账语义），API 侧不可自封。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  // 域隔离：variant 经 post.userId 归属当前 user（404 口径同 plans）
  const variant = await prisma.postVariant.findFirst({
    where: { id, post: { userId: user.id } },
    include: { post: { select: { mediaPaths: true } } },
  });
  if (!variant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const title = body.title !== undefined ? String(body.title).trim() : variant.title;
  const content = body.body !== undefined ? String(body.body) : variant.body;
  const tags =
    body.tags !== undefined
      ? (Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string") : undefined) ?? variant.tags
      : variant.tags;
  let coverPath: string | null | undefined; // undefined=不改，null=清空
  if (body.coverPath === null) coverPath = null;
  else if (typeof body.coverPath === "string") coverPath = body.coverPath;
  // 内容形式（技能工作流对齐）：PATCH 可改形式；缺省维持原值（收敛为字面量，checkVariant 口径）
  const format: "IMAGE_TEXT" | "VIDEO" =
    body.format === "VIDEO" ? "VIDEO" : body.format === "IMAGE_TEXT" ? "IMAGE_TEXT" : variant.format === "VIDEO" ? "VIDEO" : "IMAGE_TEXT";

  if (body.status !== undefined && !["DRAFT", "APPROVED"].includes(String(body.status))) {
    return NextResponse.json(
      { error: "status 仅 DRAFT/APPROVED（PUBLISHED 由 worker 发布对账后落库）" },
      { status: 400 }
    );
  }

  const mediaExts = variant.post.mediaPaths.map((p) => p.split(".").pop()?.toLowerCase() ?? "");
  // 媒体下限是「发布期」问题：批准（status→APPROVED）仍严口径阻断（缺媒体批不了）；
  // 纯内容编辑/采纳宽口径不卡保存——存量 0 媒体 variant 可继续改内容，批准前/发布闸（worker）兜底
  const approving = body.status === "APPROVED";
  const check = checkVariant(
    variant.platform,
    {
      title,
      body: content,
      tags,
      mediaCount: variant.post.mediaPaths.length,
      mediaExts,
      format,
    },
    { strictMediaMin: approving },
  );
  if (!check.ok) {
    return NextResponse.json({ errors: check.errors }, { status: 422 });
  }

  const data: Record<string, unknown> = {
    title,
    body: content,
    tags,
    formatCheck: JSON.stringify(check),
    format, // 内容形式（缺省维持原值，显式传入则覆盖）
  };
  if (coverPath !== undefined) data.coverPath = coverPath;
  if (body.status !== undefined) data.status = String(body.status);

  const updated = await prisma.postVariant.update({ where: { id }, data });
  // warnings（媒体缺口）随响应回传：内容已存，UI 提示「批准/发布前需补齐媒体」
  return NextResponse.json({ ...updated, warnings: check.warnings });
}
