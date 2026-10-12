// Easel 脚本 spawn 封装（Task 4）
// - cwd 固定仓库根，脚本绝对路径定位（server/publish/easel/，Task 2 vendor）
// - 默认注入 --profile-base ~/.publish-profiles（Global Constraints：登录态目录在仓库外）
//   仅对「接受该参数」的子命令注入：check/selftest/platforms 的 argparse 里没有此参数，
//   注入会直接 argparse error（参数表逐一核对自 xhs/douyin/web_publisher 三个脚本源）
// - 超时默认 PUBLISH_WORKER_TIMEOUT_MS（毫秒，缺省 10min：视频上传处理最长 ~10min）
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface EaselResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOpts {
  timeoutMs?: number;
}

// 仓库根（server/publish-worker/spawn.ts → 上两级）
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 默认登录态根目录（Global Constraints；spawn 侧注入，Easel 脚本自身默认 ~/.easel-browser-profiles 被覆盖） */
export const DEFAULT_PROFILE_BASE = "~/.publish-profiles";

/** 接受 --profile-base 的子命令（argparse 源：add_common 挂在 login/plan/publish/publish-video/whoami；web 为 login-qr） */
const PROFILE_SUBCMDS = new Set(["login", "login-qr", "plan", "publish", "publish-video", "whoami"]);

/**
 * 拼完整 CLI 参数（纯函数，便于测试）：[script, subcmd?, ...rest]
 * 规则：rest 已含 --profile-base 则不注入；subcmd 不接受该参数则不注入。
 */
export function buildEaselArgs(script: string, subcmd: string | null, rest: string[]): string[] {
  const needProfile =
    !rest.includes("--profile-base") && !!subcmd && PROFILE_SUBCMDS.has(subcmd);
  const argv = needProfile ? [subcmd, "--profile-base", DEFAULT_PROFILE_BASE, ...rest] : [subcmd ?? "", ...rest];
  return [script, ...argv.filter((a) => a !== "")];
}

function defaultTimeoutMs(): number {
  const v = parseInt(process.env.PUBLISH_WORKER_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 600_000;
}

/**
 * spawn `python3 <repo>/server/publish/easel/<script> <subcmd> ...args`。
 * 永不 reject：python3 不存在/超时均以 code（127/124）+ stderr 摘要返回，主链路单点处理。
 */
export function spawnEasel(args: string[], opts: SpawnOpts = {}): Promise<EaselResult> {
  const [script, ...rest] = args;
  if (!script) throw new Error("spawnEasel: args[0] 必须是脚本名（如 xhs_publish.py）");
  const subcmd = rest[0] ?? null;
  const argv = buildEaselArgs(script, subcmd, rest.slice(1));
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(
      process.env.PUBLISH_WORKER_PYTHON ?? "python3",
      [path.join(REPO_ROOT, "server", "publish", "easel", argv[0]), ...argv.slice(1)],
      { cwd: REPO_ROOT },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\nspawn error: ${err.message}`.trim() });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ code: 124, stdout, stderr: `${stderr}\n[timeout ${timeoutMs}ms] ${signal ?? ""}`.trim() });
        return;
      }
      resolve({ code: code ?? (signal ? -1 : 0), stdout, stderr });
    });
  });
}
