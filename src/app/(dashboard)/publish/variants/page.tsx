// 适配·确认页（brief Step 3）：按平台 3 卡片（XHS/DOUYIN/GZH，GZH 置灰在卡片层钉死）。
// 服务端组件读 prisma（含 variant.job，供卡片展示既有任务状态）；交互走 VariantCards。
import Link from "next/link";
import { requireAuth } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { Flag } from "@phosphor-icons/react/dist/ssr";
import { type PublishPostDto } from "@/components/publish/publish-shared";
import { VariantCards } from "@/components/publish/variant-cards";

export default async function PublishVariantsPage() {
  const user = await requireAuth();
  const posts = await prisma.post.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      variants: {
        orderBy: { platform: "asc" },
        include: {
          job: { select: { id: true, scheduledAt: true, status: true, lastError: true } },
        },
      },
    },
  });

  const serialized: PublishPostDto[] = posts.map((p) => ({
    id: p.id,
    title: p.title,
    body: p.body,
    mediaPaths: p.mediaPaths,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    variants: p.variants.map((v) => ({
      id: v.id,
      postId: p.id,
      platform: v.platform,
      title: v.title,
      body: v.body,
      tags: v.tags,
      coverPath: v.coverPath,
      status: v.status,
      job: v.job
        ? {
            id: v.job.id,
            scheduledAt: v.job.scheduledAt.toISOString(),
            status: v.job.status,
            lastError: v.job.lastError,
          }
        : null,
    })),
  }));

  return (
    <div className="product-page product-page--redesigned">
      <header className="product-header">
        <div>
          <p className="product-eyebrow">Platform variants</p>
          <h1 className="product-title">适配 · 确认</h1>
          <p className="product-subtitle">按平台调整各份内容，批准后才能排期发布（排期只发已批准内容）。</p>
        </div>
      </header>

      {posts.length === 0 ? (
        <div className="mt-8 flex min-h-72 flex-col items-center justify-center border border-dashed border-white/16 bg-black/10 px-5 text-center">
          <Flag className="size-7 text-primary" weight="duotone" />
          <h2 className="mt-3 text-sm font-medium text-foreground">还没有可适配的内容</h2>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">先在内容页新建正文与媒体，再回到这里做各平台适配。</p>
          <div className="mt-3">
            <Link href="/publish" className="text-xs font-medium text-primary hover:underline">去内容页新建</Link>
          </div>
        </div>
      ) : (
        <section className="mt-8" aria-label="平台适配卡片">
          <VariantCards posts={serialized} />
        </section>
      )}
    </div>
  );
}
