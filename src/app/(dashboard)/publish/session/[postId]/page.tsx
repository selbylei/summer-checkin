import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { EaselShell } from "@/components/publish/easel/easel-shell";
import { type PublishPostDto } from "@/components/publish/publish-shared";

// 发布会话工作台 = Easel 聊天界面 1:1 复刻（侧栏=该内容的会话纪录、毛笔笔入口=技能、对话+出稿卡内嵌对话流）。
// 2026-10-15 拍板：右栏产物区吸收适配页（媒体补齐/封面/批准/发布）；适配页已删；
// 方案卡=对话流内（点模板=出 1 个方案；方案确定后聊天内问「生成？」）。
// 服务端组件取 Post（域隔离：非本人 Post → 404）；不走 product-page 壳，满屏工作台（TopNav 仍在 (dashboard) 布局）。
export default async function PublishSessionPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const user = await requireAuth();
  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    include: {
      variants: {
        orderBy: { platform: "asc" },
        include: { job: { select: { id: true, scheduledAt: true, status: true, lastError: true } } },
      },
    },
  });
  if (!post) notFound();

  const dto: PublishPostDto = {
    id: post.id,
    title: post.title,
    body: post.body,
    mediaPaths: post.mediaPaths,
    status: post.status,
    createdAt: post.createdAt.toISOString(),
    variants: post.variants.map((v) => ({
      id: v.id,
      postId: v.postId,
      platform: v.platform,
      title: v.title,
      body: v.body,
      tags: v.tags,
      coverPath: v.coverPath,
      status: v.status,
      plan: v.plan ?? null,
      job: v.job
        ? { id: v.job.id, scheduledAt: v.job.scheduledAt.toISOString(), status: v.job.status, lastError: v.job.lastError }
        : null,
    })),
  };

  return <EaselShell postId={post.id} postTitle={post.title} post={dto} />;
}
