import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { checkVariant } from "@/lib/publish/format-check";

// POST /api/publish/publish：一键发布（2026-10-15 拍板：右栏直接「发布」，无采纳/批准环节）
// 两种入口：{postId, variantId}（已有适配版直接发）或 {postId, platform, title, body, tags, format}（出稿内容 upsert 后发）
// = upsert 适配版（严口径 checkVariant：不过 422 不落库）→ APPROVED → 建/复用/重触发 job（worker 每分钟扫 PENDING 真发平台）。
// GZH 前端不发（P2 官方 API）；SUCCESS job 不重发（1:1 口径同 /jobs）。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 内容：{variantId}=已有适配版原样发；否则出稿内容 upsert（新建/覆盖）
  let variant: NonNullable<Awaited<ReturnType<typeof prisma.postVariant.findFirst>>> | null = null;
  let platform = "";
  let title = "";
  let content = "";
  let tags: string[] = [];
  let format: "IMAGE_TEXT" | "VIDEO" = "IMAGE_TEXT";
  if (typeof body.variantId === "string") {
    const found = await prisma.postVariant.findFirst({ where: { id: body.variantId, postId: post.id } });
    if (!found) return NextResponse.json({ error: "variantId 不属于该内容" }, { status: 404 });
    variant = found;
    platform = found.platform;
    title = found.title;
    content = found.body;
    tags = found.tags;
    format = found.format === "VIDEO" ? "VIDEO" : "IMAGE_TEXT";
  } else {
    platform = typeof body.platform === "string" ? body.platform : "";
    title = typeof body.title === "string" ? body.title.trim() : "";
    content = typeof body.body === "string" ? body.body : "";
    tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string") : [];
    format = body.format === "VIDEO" ? "VIDEO" : "IMAGE_TEXT";
    if (!platform || !title) {
      return NextResponse.json({ error: "platform/title 必填（或传 variantId）" }, { status: 400 });
    }
  }

  // 严口径（发布=批准+建任务）：格式/媒体缺口不过→422 不落库
  const mediaExts = post.mediaPaths.map((p) => p.split(".").pop()?.toLowerCase() ?? "");
  const platformEnum = platform as "XHS" | "DOUYIN" | "GZH";
  const check = checkVariant(platformEnum, { title, body: content, tags, mediaCount: post.mediaPaths.length, mediaExts, format }, { strictMediaMin: true });
  if (!check.ok) return NextResponse.json({ errors: check.errors }, { status: 422 });

  if (variant === null) {
    // 出稿内容 upsert 适配版（已有=内容变更直接覆盖；PUBLISHED 回 DRAFT 允许重发）
    const existing = await prisma.postVariant.findFirst({ where: { postId: post.id, platform: platformEnum } });
    variant = existing
      ? await prisma.postVariant.update({
          where: { id: existing.id },
          data: { title, body: content, tags, format, formatCheck: JSON.stringify(check), status: existing.status === "PUBLISHED" ? "DRAFT" : "APPROVED" },
        })
      : await prisma.postVariant.create({
          data: { postId: post.id, platform: platformEnum, title, body: content, tags, format, coverPath: null, formatCheck: JSON.stringify(check), status: "APPROVED" },
        });
  } else {
    // 已有适配版：改口=重发（PUBLISHED 回 DRAFT 允许重发；格式已验过，只更新口径）
    variant = await prisma.postVariant.update({
      where: { id: variant.id },
      data: { status: variant.status === "PUBLISHED" ? "DRAFT" : "APPROVED", formatCheck: JSON.stringify(check) },
    });
  }

  // job：PENDING/RUNNING 复用；FAILED/CANCELLED 重置重触发；SUCCESS 不重发（409）；无=新建
  const now = new Date();
  let job = await prisma.publishJob.findFirst({ where: { variantId: variant.id } });
  if (job?.status === "SUCCESS") {
    return NextResponse.json({ error: "该平台已发布成功，重发请先在排期页取消旧任务" }, { status: 409 });
  }
  if (job && (job.status === "FAILED" || job.status === "CANCELLED")) {
    job = await prisma.publishJob.update({ where: { id: job.id }, data: { status: "PENDING", scheduledAt: now, lastError: null } });
  } else if (!job) {
    job = await prisma.publishJob.create({ data: { variantId: variant.id, scheduledAt: now } });
  }
  // PENDING/RUNNING：复用现有 job（worker 会扫到）

  return NextResponse.json({ variantId: variant.id, platform, jobId: job.id, jobStatus: job.status, warnings: check.warnings });
}
