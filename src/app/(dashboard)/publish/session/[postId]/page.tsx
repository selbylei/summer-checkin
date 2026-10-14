import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { PublishSessionPanel } from "@/components/publish/publish-session-panel";

// 发布会话工作台（复用 /agent 页同款聊天形态，三栏：左=技能选择（Easel 对齐+简短中文说明）、
// 中=聊天对话、右=出稿卡）。服务端组件取 Post（域隔离：非本人 Post → 404 口径同 plans/[id]）。
// 不走 product-page 壳——与 /agent 页一致，满屏工作台（TopNav 仍在 (dashboard) 布局）。
export default async function PublishSessionPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const user = await requireAuth();
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) notFound();

  return <PublishSessionPanel postId={post.id} postTitle={post.title} />;
}
