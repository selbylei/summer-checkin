// 排期页（brief Step 4）：任务列表/改期/取消/短信墙黄条全在 ScheduleBoard（GET /jobs 轮询）。
// 鉴权由 (dashboard) 布局 requireAuth 承载；任务数据经 API 路由拉取（含 user 域隔离）。
import { ScheduleBoard } from "@/components/publish/schedule-board";

export default function PublishSchedulePage() {
  return (
    <div className="product-page product-page--redesigned">
      <header className="product-header">
        <div>
          <p className="product-eyebrow">Schedule</p>
          <h1 className="product-title">排期</h1>
          <p className="product-subtitle">已批准内容的发布任务队列，改期与取消都在这里。</p>
        </div>
      </header>
      <div className="mt-8">
        <ScheduleBoard />
      </div>
    </div>
  );
}
