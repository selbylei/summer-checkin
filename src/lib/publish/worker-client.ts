// 发布 worker 薄 fetch 助手（Task 6 API 代理层专用）：
// base 取 .env 的 PUBLISH_WORKER_URL，缺省与 worker 默认端口一致（Global Constraints :3022）。
// 网络层失败（worker 未启动 → ECONNREFUSED 等）由调用方 catch 后映射 502 {error:"publish worker 未启动"}。
export function workerBase(): string {
  return process.env.PUBLISH_WORKER_URL ?? "http://127.0.0.1:3022";
}
