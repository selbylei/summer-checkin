// spawn.ts 纯逻辑：--profile-base 注入规则（Easel argparse 源对齐）
import { describe, it, expect } from "vitest";
import { buildEaselArgs, DEFAULT_PROFILE_BASE } from "../server/publish-worker/spawn";

describe("buildEaselArgs（--profile-base 默认注入）", () => {
  it("接受 --profile-base 的子命令默认注入（Global Constraints：登录态在仓库外）", () => {
    expect(buildEaselArgs("xhs_publish.py", "plan", ["--title", "t"])).toEqual([
      "xhs_publish.py", "plan", "--profile-base", DEFAULT_PROFILE_BASE, "--title", "t",
    ]);
    expect(buildEaselArgs("douyin_publish.py", "whoami", [])).toEqual([
      "douyin_publish.py", "whoami", "--profile-base", DEFAULT_PROFILE_BASE,
    ]);
  });

  it("显式传了 --profile-base 不重复注入", () => {
    expect(buildEaselArgs("xhs_publish.py", "plan", ["--profile-base", "/custom"])).toEqual([
      "xhs_publish.py", "plan", "--profile-base", "/custom",
    ]);
  });

  it("check/selftest/platforms 子命令没有 --profile-base 参数（argparse 源），注入会报错 → 不注入", () => {
    expect(buildEaselArgs("xhs_publish.py", "check", [])).toEqual(["xhs_publish.py", "check"]);
    expect(buildEaselArgs("xhs_publish.py", "selftest", [])).toEqual(["xhs_publish.py", "selftest"]);
    expect(buildEaselArgs("web_publisher.py", "platforms", [])).toEqual(["web_publisher.py", "platforms"]);
  });
});
