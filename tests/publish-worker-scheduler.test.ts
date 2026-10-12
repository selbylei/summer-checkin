// Task 5: 排期器（只自动发 APPROVED）——全 mock：prisma + processJob
// 钉死三条：① due 只返回 APPROVED 变体的 job（DRAFT 的 PENDING 到期 job 被滤掉）；
//          ② tick 对每个 due job 调 processJob；③ 无 due 时 0 次调用
//          ④（接口「异常吞掉记 log」）单 job 抛异常不阻塞其余 job
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../server/db", () => ({
  prisma: {
    publishJob: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    postVariant: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    publishLog: { create: vi.fn() },
  },
}));
vi.mock("../server/publish-worker/process-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/publish-worker/process-job")>();
  return { ...actual, processJob: vi.fn() };
});

import { prisma } from "../server/db";
import { processJob } from "../server/publish-worker/process-job";
import { dueJobs, tick } from "../server/publish-worker/scheduler";

const mJob = prisma.publishJob as unknown as { findMany: Mock };
const mVariant = prisma.postVariant as unknown as { findMany: Mock };
const mProcess = processJob as unknown as Mock;

function makeJob(id: string, variantId: string) {
  return {
    id,
    variantId,
    scheduledAt: new Date(Date.now() - 3_600_000), // 已到期
    status: "PENDING",
    lastError: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("dueJobs（二次查：PENDING+due → 批查 variant 过滤 APPROVED）", () => {
  it("① DRAFT 变体的 PENDING 到期 job 不在结果（只留 APPROVED）", async () => {
    const j1 = makeJob("j1", "v1");
    const j2 = makeJob("j2", "v2");
    mJob.findMany.mockResolvedValue([j1, j2]);
    mVariant.findMany.mockResolvedValue([
      { id: "v1", status: "APPROVED" },
      { id: "v2", status: "DRAFT" },
    ]);
    const due = await dueJobs(prisma);
    expect(due.map((j) => j.id)).toEqual(["j1"]);
    // 两段式：先查 PENDING + scheduledAt<=now，再按 variantId 批查过滤
    expect(mJob.findMany).toHaveBeenCalledWith({
      where: { status: "PENDING", scheduledAt: { lte: expect.any(Date) } },
    });
    expect(mVariant.findMany).toHaveBeenCalledWith({ where: { id: { in: ["v1", "v2"] } } });
  });
});

describe("tick（逐 job 调 processJob，异常吞掉记 log，返回处理数）", () => {
  it("② 对每个 due job 调 processJob，返回处理数", async () => {
    mJob.findMany.mockResolvedValue([makeJob("j1", "v1"), makeJob("j2", "v2")]);
    mVariant.findMany.mockResolvedValue([
      { id: "v1", status: "APPROVED" },
      { id: "v2", status: "APPROVED" },
    ]);
    mProcess.mockResolvedValue("SUCCESS");
    const n = await tick(prisma);
    expect(n).toBe(2);
    expect(mProcess).toHaveBeenCalledTimes(2);
    expect(mProcess).toHaveBeenNthCalledWith(1, "j1");
    expect(mProcess).toHaveBeenNthCalledWith(2, "j2");
  });

  it("③ 无到期 PENDING job → 0 次调用 processJob（也不批查 variant）", async () => {
    mJob.findMany.mockResolvedValue([]);
    const n = await tick(prisma);
    expect(n).toBe(0);
    expect(mProcess).not.toHaveBeenCalled();
    expect(mVariant.findMany).not.toHaveBeenCalled();
  });

  it("④ 单 job 的 processJob 抛异常 → 吞掉记 log 不阻塞其余 job，返回成功处理数", async () => {
    mJob.findMany.mockResolvedValue([makeJob("j1", "v1"), makeJob("j2", "v2"), makeJob("j3", "v3")]);
    mVariant.findMany.mockResolvedValue([
      { id: "v1", status: "APPROVED" },
      { id: "v2", status: "APPROVED" },
      { id: "v3", status: "APPROVED" },
    ]);
    mProcess.mockImplementation((id: string) =>
      id === "j2" ? Promise.reject(new Error("boom")) : Promise.resolve("SUCCESS"),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const n = await tick(prisma);
    expect(n).toBe(2); // j1+j3 成功，j2 失败被吞
    expect(mProcess).toHaveBeenCalledTimes(3); // j2 失败不中断循环
    expect(mProcess).toHaveBeenLastCalledWith("j3");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("j2"), expect.stringContaining("boom"));
    spy.mockRestore();
  });
});
