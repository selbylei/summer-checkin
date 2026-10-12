// 登录态/二维码路径 + statusFile 读取（Task 4；Easel login 的 --qr-out/--status-file 约定路径）
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type LoginPlatform = "xhs" | "douyin";

/** 平台 → Easel 脚本 + 登录子命令（xhs/douyin 是 login；web_publisher 才有 login-qr，但 GZH P1 未接入） */
export const LOGIN_SCRIPTS: Record<LoginPlatform, { script: string; subcmd: "login" | "login-qr" }> = {
  xhs: { script: "xhs_publish.py", subcmd: "login" },
  douyin: { script: "douyin_publish.py", subcmd: "login" },
};

/** 二维码/状态文件目录（仓库相对；spawn cwd=仓库根，Global Constraints data/publish/qrcode/） */
export const QRCODE_DIR = path.join("data", "publish", "qrcode");

export function loginPaths(platform: LoginPlatform): { qrPath: string; statusFile: string } {
  return {
    qrPath: path.join(QRCODE_DIR, `${platform}.png`),
    statusFile: path.join(QRCODE_DIR, `${platform}.json`),
  };
}

/** 抖音发布状态文件（douyin publish 的 --status-file，I1 短信墙轮询；JSON 结构=login_state：{state,message,qr,ts}） */
export const DOUYIN_PUBLISH_STATUS_FILE = path.join(QRCODE_DIR, "douyin-publish.json");

/**
 * 读抖音发布状态文件（Easel douyin publish --status-file 落盘）。容错：不存在/解析失败 → {}
 * 调用方按 .state/.message 判断（state=sms_required 或 error+「短信验证」message=短信墙）
 */
export async function readDouyinPublishStatus(): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(path.join(REPO_ROOT, DOUYIN_PUBLISH_STATUS_FILE), "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 读登录/发布状态文件（Easel login_state JSON：state=starting|success|error…）。
 * 容错：文件不存在/解析失败 → {status:"pending"}（前端轮询到 success/error 才停）
 */
export async function readLoginStatus(platform: LoginPlatform): Promise<Record<string, unknown>> {
  const { statusFile } = loginPaths(platform);
  try {
    const text = await fs.readFile(path.join(REPO_ROOT, statusFile), "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { status: "pending" };
  }
}
