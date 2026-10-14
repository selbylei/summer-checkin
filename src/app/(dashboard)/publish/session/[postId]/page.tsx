import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { PublishSessionPanel } from "@/components/publish/publish-session-panel";

// 发布会话页（Easel 对齐：每个发布一个聊天会话，选技能=选工作流，可多轮对话迭代草稿）。
// 服务端组件取 Post（域隔离：非本人 Post → 404 口径同 plans/[id]）；交互在客户端面板内。
export default async function PublishSessionPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const user = await requireAuth();
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) notFound();

  return (
    <div className="product-page product-page--redesigned">
      <header className="product-header">
        <div>
          <p className="product-eyebrow">Publish session</p>
          <h1 className="product-title">会话创作</h1>
          <p className="product-subtitle">
            选技能（=选工作流）后直接对话：agent 按技能流程出稿，可继续对话迭代；采纳后走适配页批准排期。
          </p>
        </div>
      </header>
      <div className="mt-6 flex flex-col gap-4">
        <PublishSessionPanel postId={post.id} postTitle={post.title} />
      </div>
    </div>
  );
}
