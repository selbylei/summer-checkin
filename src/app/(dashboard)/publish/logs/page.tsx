// 日志页（brief Step 6）：jobId 选择器 + 时间线，交互在 LogsPanel（GET /logs?jobId=）。
// 服务端拼任务选项（平台 · 标题 · 计划时间 · 状态），避免客户端再拉一次列表。
import { requireAuth } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { LogsPanel, type PublishJobOption } from "@/components/publish/logs-panel";
import {
  PLATFORM_LABEL,
  JOB_STATUS_LABEL,
  formatDateTime,
} from "@/components/publish/publish-shared";

export default async function PublishLogsPage() {
  const user = await requireAuth();
  const rows = await prisma.postVariant.findMany({
    where: { post: { userId: user.id } },
    include: {
      job: { select: { id: true, scheduledAt: true, status: true } },
    },
  });

  const options: PublishJobOption[] = rows
    .filter((v) => v.job !== null)
    .map((v) => ({
      scheduledAt: v.job!.scheduledAt.getTime(),
      option: {
        id: v.job!.id,
        label: `${PLATFORM_LABEL[v.platform]} · ${v.title} · ${formatDateTime(v.job!.scheduledAt.toISOString())} · ${JOB_STATUS_LABEL[v.job!.status]}`,
      },
    }))
    .sort((a, b) => b.scheduledAt - a.scheduledAt)
    .map(({ option }) => option);

  return (
    <div className="product-page product-page--redesigned">
      <header className="product-header">
        <div>
          <p className="product-eyebrow">Publish logs</p>
          <h1 className="product-title">日志</h1>
          <p className="product-subtitle">发布任务的执行留痕，验证日志用于读回对账。</p>
        </div>
      </header>
      <div className="mt-8">
        <LogsPanel jobs={options} />
      </div>
    </div>
  );
}
