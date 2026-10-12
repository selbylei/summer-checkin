// Task 4: process-job 主链路（全 mock：spawnEasel + prisma）
// 控制器裁决：测试②「写入 2 条 Log」= PUBLISH 段 1 条 + VERIFY 段 1 条
// R1 修复：I1 抖音短信墙 → FAILED + Log(stage=PUBLISH, detail 含「需人工验证码」)
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../server/publish-worker/spawn", () => ({
  spawnEasel: vi.fn(),
}));
vi.mock("../server/publish-worker/status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/publish-worker/status")>();
  return { ...actual, readDouyinPublishStatus: vi.fn() };
});
vi.mock("../server/db", () => ({
  prisma: {
    publishJob: { findUnique: vi.fn(), update: vi.fn() },
    postVariant: { findUnique: vi.fn(), update: vi.fn() },
    publishLog: { create: vi.fn() },
  },
}));

import { spawnEasel } from "../server/publish-worker/spawn";
import { DOUYIN_PUBLISH_STATUS_FILE, readDouyinPublishStatus } from "../server/publish-worker/status";
import { prisma } from "../server/db";
import { processJob } from "../server/publish-worker/process-job";

const mSpawn = spawnEasel as unknown as Mock;
const mStatusFile = readDouyinPublishStatus as unknown as Mock;
const mJob = prisma.publishJob as unknown as { findUnique: Mock; update: Mock };
const mVariant = prisma.postVariant as unknown as { findUnique: Mock; update: Mock };
const mLog = prisma.publishLog as unknown as { create: Mock };

function makeJob(over: { variantStatus?: string; platform?: string } = {}) {
  return {
    id: "job1",
    variantId: "var1",
    scheduledAt: new Date(),
    status: "PENDING",
    lastError: null,
    variant: {
      id: "var1",
      postId: "post1",
      platform: over.platform ?? "XHS",
      title: "标题",
      body: "正文",
      tags: ["A", "B"],
      coverPath: null,
      status: over.variantStatus ?? "APPROVED",
      post: {
        id: "post1",
        mediaPaths: ["data/publish/media/a.jpg", "data/publish/media/b.jpg"],
      },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mJob.update.mockResolvedValue({});
  mVariant.update.mockResolvedValue({});
  mLog.create.mockResolvedValue({});
  mStatusFile.mockResolvedValue({});
});

describe("processJob 批准闸门", () => {
  it("① DRAFT 变体 → FAILED + lastError「需批准」，且绝不调用 spawn", async () => {
    mJob.findUnique.mockResolvedValue(makeJob({ variantStatus: "DRAFT" }));
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    expect(mSpawn).not.toHaveBeenCalled();
    const data = mJob.update.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(String(data.lastError)).toContain("需批准");
  });

  it("⑤ 不存在的 job → 抛 not found（HTTP 层转 404）", async () => {
    mJob.findUnique.mockResolvedValue(null);
    await expect(processJob("nope")).rejects.toThrow(/not found/);
    expect(mSpawn).not.toHaveBeenCalled();
  });
});

describe("processJob 主链路", () => {
  it("② APPROVED → 按序 plan / publish --exec / whoami；publish code=0 → SUCCESS + 恰好 2 条 Log（PUBLISH 1 + VERIFY 1）", async () => {
    mJob.findUnique.mockResolvedValue(makeJob());
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan")
        return Promise.resolve({ code: 0, stdout: "dry-run 步骤预览…", stderr: "" });
      if (args[1] === "publish")
        return Promise.resolve({
          code: 0,
          stdout: "✅ 发布成功，已跳转：https://creator.xiaohongshu.com/publish/success\n",
          stderr: "",
        });
      if (args[1] === "whoami")
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ loggedIn: true, name: "测试号", avatar: "http://a/b.png" }) + "\n",
          stderr: "",
        });
      return Promise.resolve({ code: 1, stdout: "", stderr: "unexpected subcmd " + args[1] });
    });

    const status = await processJob("job1");
    expect(status).toBe("SUCCESS");

    // 调用次序：plan（dry-run）→ publish --exec → whoami（VERIFY）
    const c0 = mSpawn.mock.calls[0][0] as string[];
    const c1 = mSpawn.mock.calls[1][0] as string[];
    const c2 = mSpawn.mock.calls[2][0] as string[];
    expect(mSpawn.mock.calls.length).toBe(3);
    expect(c0.slice(0, 2)).toEqual(["xhs_publish.py", "plan"]);
    expect(c1.slice(0, 3)).toEqual(["xhs_publish.py", "publish", "--exec"]);
    expect(c2.slice(0, 2)).toEqual(["xhs_publish.py", "whoami"]);
    // 内容参数透传（标题/正文/图片逗号分隔/话题）
    expect(c0.slice(2)).toEqual([
      "--title", "标题",
      "--content", "正文",
      "--images", "data/publish/media/a.jpg,data/publish/media/b.jpg",
      "--tags", "A,B",
    ]);
    // I1 边界：xhs publish 无 --status-file 参数（argparse 源），绝不传（传了即 exit 2）
    expect(c1).not.toContain("--status-file");
    // 恰好 2 条 Log：PUBLISH 段 1 + VERIFY 段 1（控制器裁决）
    expect(mLog.create).toHaveBeenCalledTimes(2);
    const stages = mLog.create.mock.calls.map((c) => c[0].data.stage);
    expect(stages).toEqual(["PUBLISH", "VERIFY"]);
    expect(String(mLog.create.mock.calls[0][0].data.detail)).toContain("发布成功");
    expect(String(mLog.create.mock.calls[1][0].data.detail)).toContain("loggedIn");

    // Job=SUCCESS（清 lastError）+ Variant→PUBLISHED
    const lastJobUpdate = mJob.update.mock.calls.at(-1)![0].data;
    expect(lastJobUpdate.status).toBe("SUCCESS");
    expect(mVariant.update).toHaveBeenCalledWith({ where: { id: "var1" }, data: { status: "PUBLISHED" } });
  });

  it("③ publish code≠0 → FAILED + lastError 含 stderr 摘要", async () => {
    mJob.findUnique.mockResolvedValue(makeJob());
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan") return Promise.resolve({ code: 0, stdout: "dry-run", stderr: "" });
      return Promise.resolve({ code: 3, stdout: "", stderr: "ERROR: 未登录，请先 `login` 扫码\n" });
    });
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    const data = mJob.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe("FAILED");
    expect(String(data.lastError)).toContain("未登录");
    // 失败路径不写 PUBLISH/VERIFY log
    expect(mLog.create).not.toHaveBeenCalled();
    expect(mVariant.update).not.toHaveBeenCalled();
  });

  it("③b publish code=0 但 stdout 无读回成功标记 → FAILED（不把未核实当成功）", async () => {
    mJob.findUnique.mockResolvedValue(makeJob());
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan") return Promise.resolve({ code: 0, stdout: "dry-run", stderr: "" });
      if (args[1] === "publish") return Promise.resolve({ code: 0, stdout: "提交动作完成", stderr: "" });
      return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });
    });
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    expect(String(mJob.update.mock.calls.at(-1)![0].data.lastError)).toContain("未核实");
  });

  it("④ GZH 平台 P1 未接入（P2 官方 API 未接入，web_publisher 无 gzh 适配器）→ FAILED 且不调 spawn", async () => {
    mJob.findUnique.mockResolvedValue(makeJob({ platform: "GZH" }));
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    expect(mSpawn).not.toHaveBeenCalled();
    const le = String(mJob.update.mock.calls[0][0].data.lastError);
    expect(le).toContain("GZH");
    expect(le).toContain("P2 官方 API 未接入");
  });

  it("I1 DOUYIN 发布触发短信墙（status file state=sms_required）→ FAILED + Log(stage=PUBLISH, detail 含「需人工验证码」），且 publish 调用附 --status-file", async () => {
    mJob.findUnique.mockResolvedValue(makeJob({ platform: "DOUYIN" }));
    mStatusFile.mockResolvedValue({ state: "sms_required", message: "发布需短信验证，正在发送验证码…" });
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan") return Promise.resolve({ code: 0, stdout: "dry-run", stderr: "" });
      if (args[1] === "publish")
        return Promise.resolve({ code: 5, stdout: "", stderr: "ERROR: 发布短信验证未完成\n" });
      return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });
    });
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    // 抖音 publish 附加 --status-file data/publish/qrcode/douyin-publish.json
    const pubCall = mSpawn.mock.calls[1][0] as string[];
    expect(pubCall.slice(0, 3)).toEqual(["douyin_publish.py", "publish", "--exec"]);
    expect(pubCall).toContain("--status-file");
    expect(pubCall[pubCall.indexOf("--status-file") + 1]).toBe(DOUYIN_PUBLISH_STATUS_FILE);
    // 短信墙不静默：恰好 1 条 Log（stage=PUBLISH，detail 含「需人工验证码」）
    expect(mLog.create).toHaveBeenCalledTimes(1);
    expect(mLog.create.mock.calls[0][0].data.stage).toBe("PUBLISH");
    expect(String(mLog.create.mock.calls[0][0].data.detail)).toContain("需人工验证码");
    // Job=FAILED + lastError 提示人工验证码
    const last = mJob.update.mock.calls.at(-1)![0].data;
    expect(last.status).toBe("FAILED");
    expect(String(last.lastError)).toContain("需人工验证码");
  });

  it("I1b DOUYIN 短信墙超时终态（源：退出时 state=error 且 message 含「短信验证」）→ 同样 FAILED + PUBLISH log「需人工验证码」", async () => {
    mJob.findUnique.mockResolvedValue(makeJob({ platform: "DOUYIN" }));
    mStatusFile.mockResolvedValue({ state: "error", message: "发布短信验证超时未完成" });
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan") return Promise.resolve({ code: 0, stdout: "dry-run", stderr: "" });
      if (args[1] === "publish")
        return Promise.resolve({ code: 5, stdout: "", stderr: "发布未确认成功\n" });
      return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });
    });
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    expect(mLog.create).toHaveBeenCalledTimes(1);
    expect(mLog.create.mock.calls[0][0].data.stage).toBe("PUBLISH");
    expect(String(mLog.create.mock.calls[0][0].data.detail)).toContain("需人工验证码");
  });

  it("I1c DOUYIN 一般失败（status file 非短信墙，如读回未确认）→ 保持 0 条 log（不误报验证码）", async () => {
    mJob.findUnique.mockResolvedValue(makeJob({ platform: "DOUYIN" }));
    mStatusFile.mockResolvedValue({ state: "error", message: "发布未确认：读回作品列表未见本次内容" });
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan") return Promise.resolve({ code: 0, stdout: "dry-run", stderr: "" });
      if (args[1] === "publish")
        return Promise.resolve({ code: 5, stdout: "", stderr: "ERROR: 发布未确认\n" });
      return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });
    });
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    expect(mLog.create).not.toHaveBeenCalled();
    expect(String(mJob.update.mock.calls.at(-1)![0].data.lastError)).not.toContain("需人工验证码");
  });

  it("裁决② 主链路意外异常（publish spawn reject）→ 落 lastError 转 FAILED，不外抛（fire-and-forget 路由 await 不到）", async () => {
    mJob.findUnique.mockResolvedValue(makeJob());
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan") return Promise.resolve({ code: 0, stdout: "dry-run", stderr: "" });
      return Promise.reject(new Error("spawn 链路损坏"));
    });
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    const last = mJob.update.mock.calls.at(-1)![0].data;
    expect(last.status).toBe("FAILED");
    expect(String(last.lastError)).toContain("发布链路异常");
    expect(String(last.lastError)).toContain("spawn 链路损坏");
  });

  it("DOUYIN 平台 → 走 douyin_publish.py 脚本", async () => {
    mJob.findUnique.mockResolvedValue(makeJob({ platform: "DOUYIN" }));
    mSpawn.mockImplementation((args: string[]) => {
      if (args[1] === "plan") return Promise.resolve({ code: 0, stdout: "dry-run", stderr: "" });
      if (args[1] === "publish")
        return Promise.resolve({
          code: 0,
          stdout: "✅ 抖音发布成功（读回核验：7350000000000000001；账号：测试）\n",
          stderr: "",
        });
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ loggedIn: true, name: "x" }), stderr: "" });
    });
    const status = await processJob("job1");
    expect(status).toBe("SUCCESS");
    expect((mSpawn.mock.calls[0][0] as string[])[0]).toBe("douyin_publish.py");
    const publishLogDetail = String(mLog.create.mock.calls[0][0].data.detail);
    expect(publishLogDetail).toContain("7350000000000000001");
  });
});
