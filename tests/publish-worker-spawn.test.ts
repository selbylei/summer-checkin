// spawn.ts 纯逻辑：--profile-base 注入规则（Easel argparse 源对齐，C1 修复后：plan 绝不注入）
import { describe, it, expect } from "vitest";
import { buildEaselArgs, DEFAULT_PROFILE_BASE } from "../server/publish-worker/spawn";

describe("buildEaselArgs（--profile-base 默认注入）", () => {
  it("接受 --profile-base 的子命令默认注入（Global Constraints：登录态在仓库外）", () => {
    expect(buildEaselArgs("xhs_publish.py", "publish", ["--exec", "--title", "t"])).toEqual([
      "xhs_publish.py", "publish", "--profile-base", DEFAULT_PROFILE_BASE, "--exec", "--title", "t",
    ]);
    expect(buildEaselArgs("douyin_publish.py", "login-qr", [])).toEqual([
      "douyin_publish.py", "login-qr", "--profile-base", DEFAULT_PROFILE_BASE,
    ]);
    expect(buildEaselArgs("xhs_publish.py", "whoami", [])).toEqual([
      "xhs_publish.py", "whoami", "--profile-base", DEFAULT_PROFILE_BASE,
    ]);
  });

  it("plan 绝不注入 --profile-base（C1：xhs/douyin plan 只挂 add_content，注入即 argparse exit 2；web_publisher plan 虽接受但 P1 不用 web 脚本）", () => {
    expect(buildEaselArgs("xhs_publish.py", "plan", ["--title", "t"])).toEqual([
      "xhs_publish.py", "plan", "--title", "t",
    ]);
    expect(buildEaselArgs("douyin_publish.py", "plan", ["--title", "t"])).toEqual([
      "douyin_publish.py", "plan", "--title", "t",
    ]);
  });

  it("显式传了 --profile-base 不重复注入", () => {
    expect(buildEaselArgs("xhs_publish.py", "login", ["--profile-base", "/custom"])).toEqual([
      "xhs_publish.py", "login", "--profile-base", "/custom",
    ]);
  });

  it("check/selftest/platforms 子命令没有 --profile-base 参数（argparse 源），注入会报错 → 不注入", () => {
    expect(buildEaselArgs("xhs_publish.py", "check", [])).toEqual(["xhs_publish.py", "check"]);
    expect(buildEaselArgs("xhs_publish.py", "selftest", [])).toEqual(["xhs_publish.py", "selftest"]);
    expect(buildEaselArgs("web_publisher.py", "platforms", [])).toEqual(["web_publisher.py", "platforms"]);
  });
});
