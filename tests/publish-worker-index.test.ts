// Task 4 R1 修复（裁决②）：POST /publish fire-and-forget 202 + GET /jobs/:id（Task 7 轮询入口）
// 全 mock：prisma + processJob（index 路由层只验证「不等待 processJob 完成」与「404 语义」）
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

vi.mock("../server/db", () => ({
  prisma: {
    publishJob: { findUnique: vi.fn(), update: vi.fn() },
    postVariant: { findUnique: vi.fn(), update: vi.fn() },
    publishLog: { create: vi.fn() },
  },
}));
vi.mock("../server/publish-worker/process-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/publish-worker/process-job")>();
  return { ...actual, processJob: vi.fn() };
});

import { prisma } from "../server/db";
import { processJob } from "../server/publish-worker/process-job";
import { handle } from "../server/publish-worker/index";

const mProcess = processJob as unknown as Mock;
const mJob = prisma.publishJob as unknown as { findUnique: Mock; update: Mock };

function fakeReq(method: string, url: string, body?: string) {
  const listeners: Record<string, Array<(p: unknown) => void>> = {};
  const req = {
    method,
    url,
    on(ev: string, cb: (p: unknown) => void) {
      (listeners[ev] ??= []).push(cb);
      return req;
    },
  };
  // readBody 依赖 data/end 事件：微任务里补发，模拟 node:http 流
  if (body !== undefined) {
    queueMicrotask(() => {
      listeners["data"]?.forEach((cb) => cb(Buffer.from(body)));
      listeners["end"]?.forEach((cb) => cb(undefined));
    });
  }
  return req;
}

function fakeRes() {
  return {
    statusCode: 0,
    body: "",
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(b = "") {
      this.body += b;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mJob.update.mockResolvedValue({});
});

describe("POST /publish（裁决②：fire-and-forget 202）", () => {
  it("Job 存在 → 立即 202 {ok,jobId}，不等待 processJob 完成（后台跑）", async () => {
    mJob.findUnique.mockResolvedValue({ id: "j1", status: "PENDING" });
    let resolveProcess: (v: string) => void = () => {};
    mProcess.mockReturnValue(
      new Promise<string>((r) => {
        resolveProcess = r;
      }),
    );
    const res = fakeRes();
    const p = handle(
      fakeReq("POST", "/publish", JSON.stringify({ jobId: "j1" })) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    // 关键：processJob 尚未完成时 handle 已应答（若同步 await 则 300ms 内不会 settled）
    const settled = await Promise.race([
      p.then(() => "responded" as const),
      new Promise<string>((r) => setTimeout(() => r("timeout"), 300)),
    ]);
    expect(settled).toBe("responded");
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ ok: true, jobId: "j1" });
    expect(mProcess).toHaveBeenCalledWith("j1");
    resolveProcess("SUCCESS");
    await mProcess.mock.results[0].value;
  });

  it("Job 不存在 → 404 且不调 processJob", async () => {
    mJob.findUnique.mockResolvedValue(null);
    const res = fakeRes();
    await handle(
      fakeReq("POST", "/publish", JSON.stringify({ jobId: "nope" })) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: "job not found: nope" });
    expect(mProcess).not.toHaveBeenCalled();
  });

  it("缺 jobId → 400", async () => {
    const res = fakeRes();
    await handle(
      fakeReq("POST", "/publish", "{}") as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    expect(res.statusCode).toBe(400);
    expect(mProcess).not.toHaveBeenCalled();
  });

  it("I-1: 非 PENDING job（RUNNING / CANCELLED）→ 409「已被触发/进行中，勿重试」且不调 processJob", async () => {
    for (const status of ["RUNNING", "CANCELLED"] as const) {
      mJob.findUnique.mockResolvedValue({ id: "j1", status });
      const res = fakeRes();
      await handle(
        fakeReq("POST", "/publish", JSON.stringify({ jobId: "j1" })) as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      );
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      expect(body.status).toBe(status);
      expect(String(body.error)).toContain("已被触发/进行中");
    }
    expect(mProcess).not.toHaveBeenCalled();
  });
});

describe("GET /jobs/:id（Task 7 轮询出状态）", () => {
  it("Job 存在 → 200 + 完整 job 行（status/lastError 可被轮询到终态）", async () => {
    const job = {
      id: "j1",
      variantId: "v1",
      scheduledAt: new Date("2026-10-13T00:00:00Z"),
      status: "FAILED",
      lastError: "publish 失败（code=5）：发布短信验证超时未完成",
    };
    mJob.findUnique.mockResolvedValue(job);
    const res = fakeRes();
    await handle(fakeReq("GET", "/jobs/j1") as unknown as IncomingMessage, res as unknown as ServerResponse);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.job).toEqual(expect.objectContaining({ id: "j1", status: "FAILED", lastError: expect.stringContaining("短信验证") }));
  });

  it("Job 不存在 → 404（语义同 cancel 路由）", async () => {
    mJob.findUnique.mockResolvedValue(null);
    const res = fakeRes();
    await handle(fakeReq("GET", "/jobs/missing") as unknown as IncomingMessage, res as unknown as ServerResponse);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: "job not found: missing" });
  });
});
