// Task 4: process-job 主链路（全 mock：spawnEasel + prisma）
// 控制器裁决：测试②「写入 2 条 Log」= PUBLISH 段 1 条 + VERIFY 段 1 条
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../server/publish-worker/spawn", () => ({
  spawnEasel: vi.fn(),
}));
vi.mock("../server/db", () => ({
  prisma: {
    publishJob: { findUnique: vi.fn(), update: vi.fn() },
    postVariant: { findUnique: vi.fn(), update: vi.fn() },
    publishLog: { create: vi.fn() },
  },
}));

import { spawnEasel } from "../server/publish-worker/spawn";
import { prisma } from "../server/db";
import { processJob } from "../server/publish-worker/process-job";

const mSpawn = spawnEasel as unknown as Mock;
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

  it("④ GZH 平台 P1 未接入（web_publisher 无 gzh 适配器）→ FAILED 且不调 spawn", async () => {
    mJob.findUnique.mockResolvedValue(makeJob({ platform: "GZH" }));
    const status = await processJob("job1");
    expect(status).toBe("FAILED");
    expect(mSpawn).not.toHaveBeenCalled();
    expect(String(mJob.update.mock.calls[0][0].data.lastError)).toContain("GZH");
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
