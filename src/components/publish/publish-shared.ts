// 发布五页 UI 共享层：API fetch 入口 + 平台/状态文案映射（Global Constraints：不引入新依赖，
// 文案口径与现有 plans/statistics 页一致）。
// 422 口径来自 Task 6：body={errors: string[]}（format-check 拦截）；其他非 2xx={error}。

export type Platform = "GZH" | "DOUYIN" | "XHS";
export type PostStatus = "DRAFT" | "READY" | "PUBLISHED" | "FAILED";
export type VariantStatus = "DRAFT" | "APPROVED" | "PUBLISHED";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
export type LogStage = "PLAN" | "PUBLISH" | "VERIFY" | "COLLECT";

// P1 平台集：XHS/DOUYIN 可用；GZH 卡片整体置灰（未接入，P2 官方 API）
export const PLATFORMS: Platform[] = ["XHS", "DOUYIN", "GZH"];
export const LIVE_PLATFORMS: Platform[] = ["XHS", "DOUYIN"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  XHS: "小红书",
  DOUYIN: "抖音",
  GZH: "公众号",
};

// worker 扫码登录/二维码路由用小写 platform 参数（与 worker status.ts LoginPlatform 一致）
export const LOGIN_PLATFORM: Record<Platform, string> = {
  XHS: "xhs",
  DOUYIN: "douyin",
  GZH: "gzh",
};

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: "草稿",
  READY: "就绪",
  PUBLISHED: "已发布",
  FAILED: "发布失败",
};

export const VARIANT_STATUS_LABEL: Record<VariantStatus, string> = {
  DRAFT: "草稿",
  APPROVED: "已批准",
  PUBLISHED: "已发布",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  PENDING: "待发布",
  RUNNING: "发布中",
  SUCCESS: "成功",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export const LOG_STAGE_LABEL: Record<LogStage, string> = {
  PLAN: "规划",
  PUBLISH: "发布",
  VERIFY: "验证",
  COLLECT: "收集",
};

export const JOB_TERMINAL: JobStatus[] = ["SUCCESS", "FAILED", "CANCELLED"];

// 内容/适配页（服务端 prisma 传入）
export interface PublishVariantDto {
  id: string;
  postId: string;
  platform: Platform;
  title: string;
  body: string;
  tags: string[];
  coverPath: string | null;
  status: VariantStatus;
  job: { id: string; scheduledAt: string; status: JobStatus; lastError: string | null } | null;
  /** AI 规划层方案 JSON（planner 产出，一次生成后保留；null=未生成/已撤销） */
  plan?: string | null;
}

export interface PublishPostDto {
  id: string;
  title: string;
  body: string;
  mediaPaths: string[];
  status: PostStatus;
  createdAt: string;
  variants: PublishVariantDto[];
}

// 排期页 GET /api/publish/jobs（Task 6 裁决②：列表 include variant 摘要）
export interface PublishJobDto {
  id: string;
  variantId: string;
  scheduledAt: string;
  status: JobStatus;
  lastError: string | null;
  variant: { id: string; platform: Platform; status: VariantStatus; title: string };
}

// 日志页 GET /api/publish/logs?jobId=
export interface PublishLogDto {
  id: string;
  jobId: string;
  stage: LogStage;
  detail: string;
  screenshotPath: string | null;
  createdAt: string;
}

// 账号页 GET /api/publish/accounts
export interface AccountProfileDto {
  id: string;
  platform: Platform;
  handle: string;
  positioning: string;
  style: string;
  tone: string;
  constraints: string | null;
}

export interface PublishApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  /** 422 校验错误逐条（红字列出） */
  errors: string[];
  /** 非 422 的单条错误文案 */
  error: string;
}

// 统一 fetch：JSON body 自动带 Content-Type；multipart（media 上传）不带，交由浏览器/FormData
export async function publishFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<PublishApiResult<T>> {
  const headers: Record<string, string> = {};
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";
  let resp: Response;
  try {
    resp = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    return { ok: false, status: 0, data: null, errors: [], error: "网络异常，请检查连接" };
  }
  const data = (await resp.json().catch(() => null)) as T & { error?: string; errors?: string[] } | null;
  if (resp.ok) {
    return { ok: true, status: resp.status, data, errors: [], error: "" };
  }
  if (resp.status === 422 && data && Array.isArray(data.errors)) {
    return { ok: false, status: resp.status, data, errors: data.errors, error: "格式校验未通过" };
  }
  const error =
    (data && typeof data.error === "string" && data.error) || `请求失败（${resp.status}）`;
  return { ok: false, status: resp.status, data: null, errors: [], error };
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 时间线用：完整到秒
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// datetime-local input 需要本地时区格式（YYYY-MM-DDTHH:mm）
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
