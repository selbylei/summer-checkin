// 内容页（brief Step 2）：Post 列表（标题/状态/创建时间）+ 新建表单（media 走 Task 6 media 路由）。
// 服务端组件读 prisma（口径同 plans/page.tsx；Task 6 API 面没有 GET /posts 列表路由，
// 列表照 plans 惯例直接 prisma，CRUD 变更走 API 路由 + router.refresh）。
// 控制器裁决②：不提供 Post.status 手改入口（PUBLISHED/FAILED 由发布链路写，UI 自封混淆对账语义）。
import Link from "next/link";
import { requireAuth } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { FileText, ArrowUpRight, Flag } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { PostForm } from "@/components/publish/post-form";
import { DocImportButton } from "@/components/publish/doc-import-button";
import { PostStatusBadge } from "@/components/publish/publish-status-badge";
import {
  PLATFORM_LABEL,
  formatDateTime,
  type PublishPostDto,
} from "@/components/publish/publish-shared";

export default async function PublishContentPage() {
  const user = await requireAuth();
  const posts = await prisma.post.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { variants: { select: { id: true, platform: true, status: true } } },
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
      title: "",
      body: "",
      tags: [],
      coverPath: null,
      status: v.status,
      job: null,
    })),
  }));

  const publishedCount = posts.filter((p) => p.status === "PUBLISHED").length;
  const draftCount = posts.length - publishedCount;

  return (
    <div className="product-page product-page--redesigned">
      <header className="product-header">
        <div>
          <p className="product-eyebrow">Publish content</p>
          <h1 className="product-title">内容</h1>
          <p className="product-subtitle">正文与媒体统一存放，多平台适配与排期在适配页完成。</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/publish/hot" className="inline-flex">
            <Button variant="secondary">
              拉热点
              <ArrowUpRight className="h-4 w-4" weight="bold" />
            </Button>
          </Link>
          <DocImportButton />
          <Link href="/publish/variants" className="inline-flex">
            <Button variant="secondary">
              去适配
              <ArrowUpRight className="h-4 w-4" weight="bold" />
            </Button>
          </Link>
        </div>
      </header>

      <section className="product-metrics mt-7 grid-cols-1 sm:grid-cols-3" aria-label="内容总览">
        {[
          { label: "全部内容", value: String(posts.length), unit: "篇" },
          { label: "已发布", value: String(publishedCount), unit: "篇" },
          { label: "编辑中", value: String(draftCount), unit: "篇" },
        ].map((item, index) => (
          <div key={item.label} className={`product-metric flex items-center gap-3 ${index > 0 ? "border-t border-white/10 sm:border-t-0" : ""}`}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/8 bg-white/[0.035] text-primary">
              <FileText className="size-[18px]" weight="duotone" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-[1.35rem] font-semibold tabular-nums text-foreground">{item.value}<span className="ml-1 text-xs font-normal text-muted-foreground">{item.unit}</span></p>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-8" aria-label="新建内容">
        <PostForm />
      </section>

      {posts.length === 0 ? (
        <div className="mt-8 flex min-h-60 flex-col items-center justify-center border border-dashed border-white/16 bg-black/10 px-5 text-center">
          <Flag className="size-7 text-primary" weight="duotone" />
          <h2 className="mt-3 text-sm font-medium text-foreground">从第一篇内容开始</h2>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">在上方新建内容，再去适配页为各平台做适配版并批准发布。</p>
        </div>
      ) : (
        <section className="mt-8" aria-label="内容列表">
          <div className="mb-4 flex items-end justify-between border-b border-white/8 pb-3">
            <div>
              <h2 className="text-sm font-medium text-foreground/90">全部内容</h2>
              <p className="mt-1 text-xs text-muted-foreground">状态由发布链路写入，UI 不可手改（对账口径）。</p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{posts.length} 篇</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {serialized.map((post) => (
              <article key={post.id} className="product-row flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-white/9 bg-[var(--surface-panel-bg)] p-4 backdrop-blur-xl">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{post.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {post.variants.length === 0 && (
                      <span className="text-[11px] text-muted-foreground/70">尚未适配</span>
                    )}
                    {post.variants.map((v) => (
                      <span key={v.platform} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {PLATFORM_LABEL[v.platform]}·{v.status === "APPROVED" ? "已批准" : v.status === "PUBLISHED" ? "已发布" : "草稿"}
                      </span>
                    ))}
                  </div>
                </div>
                <PostStatusBadge status={post.status} />
                <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(post.createdAt)}</span>
                <Link
                  href={`/publish/session/${post.id}`}
                  className="flex items-center gap-1 text-xs font-medium text-primary transition hover:gap-1.5"
                >
                  会话创作
                  <ArrowUpRight className="size-3.5" weight="bold" />
                </Link>
                <Link
                  href="/publish/variants"
                  className="flex items-center gap-1 text-xs font-medium text-primary transition hover:gap-1.5"
                >
                  适配
                  <ArrowUpRight className="size-3.5" weight="bold" />
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
