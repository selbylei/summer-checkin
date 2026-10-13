// Task 6 Next API 代理层（鉴权 + user 域隔离 + worker 薄代理）的契约测试。
// 全 mock：prisma（@/lib/prisma）+ getCurrentUser（@/lib/auth-utils）+ 全局 fetch，
// 只钉薄代理语义——401 未鉴权 / 409 同 post 同 platform 重复 variant / 422 透传 checkVariant
// errors / 502 worker 未启动（fetch 抛 ECONNREFUSED）。
import { describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    postVariant: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    publishJob: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    accountProfile: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    publishLog: { findMany: vi.fn() },
    document: { findFirst: vi.fn() },
  },
}));

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

import { POST as createPost } from "@/app/api/publish/posts/route";
import { POST as createVariant } from "@/app/api/publish/variants/route";
import { POST as createJob } from "@/app/api/publish/jobs/route";
import { POST as saveAccount } from "@/app/api/publish/accounts/route";
import { GET as loginGet } from "@/app/api/publish/login/route";

const USER = { id: "u1", name: "tester", email: "t@example.com" };

const mUser = getCurrentUser as unknown as Mock;
const mPost = prisma.post as unknown as { findFirst: Mock; create: Mock; update: Mock };
const mVariant = prisma.postVariant as unknown as { findFirst: Mock; create: Mock; update: Mock };
const mJob = prisma.publishJob as unknown as { findFirst: Mock; findMany: Mock; create: Mock; update: Mock };
const mAccount = prisma.accountProfile as unknown as { findMany: Mock; findFirst: Mock; create: Mock; update: Mock };


function jsonReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

function plainReq(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe("publish routes（薄代理契约）", () => {
  it("401：无 session 时 POST /api/publish/posts 拒绝且不落库", async () => {
    mUser.mockResolvedValue(null);
    const res = await createPost(jsonReq("http://localhost/api/publish/posts", { title: "t", body: "b" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mPost.create).not.toHaveBeenCalled();
  });

  it("409：同 post 同 platform 已存在 variant 时 POST /api/publish/variants 拒绝且不建", async () => {
    mUser.mockResolvedValue(USER);
    mPost.findFirst.mockResolvedValue({ id: "p1", userId: "u1", mediaPaths: [] });
    mVariant.findFirst.mockResolvedValue({ id: "v-exist" });
    const res = await createVariant(
      jsonReq("http://localhost/api/publish/variants", {
        postId: "p1",
        platform: "XHS",
        title: "合规标题",
        body: "正文",
        tags: ["a"],
      })
    );
    expect(res.status).toBe(409);
    // 重复检查必须按 postId+platform（全局唯一约束口径）
    expect(mVariant.findFirst.mock.calls[0][0]).toMatchObject({
      where: { postId: "p1", platform: "XHS" },
    });
    expect(mVariant.create).not.toHaveBeenCalled();
  });

  it("422：XHS 标题超 20 字时校验不过，errors 直接透传 checkVariant 结果且不落库", async () => {
    mUser.mockResolvedValue(USER);
    mPost.findFirst.mockResolvedValue({ id: "p1", userId: "u1", mediaPaths: [] });
    mVariant.findFirst.mockResolvedValue(null);
    const res = await createVariant(
      jsonReq("http://localhost/api/publish/variants", {
        postId: "p1",
        platform: "XHS",
        title: "一".repeat(21), // 超过 XHS 标题上限 20
        body: "正文",
        tags: ["a"],
      })
    );
    expect(res.status).toBe(422);
    const data = (await res.json()) as { errors: string[] };
    expect(Array.isArray(data.errors)).toBe(true);
    expect(data.errors.length).toBeGreaterThan(0);
    expect(data.errors[0]).toContain("XHS 标题超长");
    // 校验不过不落库（brief：errors 非空→422）
    expect(mVariant.create).not.toHaveBeenCalled();
  });

  it("409（并发兜底）：同 (postId,platform) 绕过 pre-check 后 create 撞 P2002 → 409，而非裸 500", async () => {
    mUser.mockResolvedValue(USER);
    // 1 图：过图片下限闸，让用例真正走到 create 撞 P2002
    mPost.findFirst.mockResolvedValue({ id: "p1", userId: "u1", mediaPaths: ["data/publish/media/p1/a.jpg"] });
    mVariant.findFirst.mockResolvedValue(null); // 并发：pre-check 时还不存在
    mVariant.create.mockRejectedValueOnce({ code: "P2002" });
    const res = await createVariant(
      jsonReq("http://localhost/api/publish/variants", {
        postId: "p1",
        platform: "XHS",
        title: "合规标题",
        body: "正文",
        tags: ["a"],
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: `该 post 的 XHS 适配版已存在` });
  });

  it("409（并发兜底）：同 variantId 绕过 pre-check 后 create 撞 P2002 → 409", async () => {
    mUser.mockResolvedValue(USER);
    mVariant.findFirst.mockResolvedValue({ id: "v1", post: { userId: "u1" } });
    mJob.findFirst.mockResolvedValue(null);
    mJob.create.mockRejectedValueOnce({ code: "P2002" });
    const res = await createJob(
      jsonReq("http://localhost/api/publish/jobs", { variantId: "v1", scheduledAt: new Date().toISOString() })
    );
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("该 variant 已有任务");
  });

  it("非 P2002 的 create 异常不被吞：FK 违约 P2003 需 rethrow（路由 500 路径），不降级为 409", async () => {
    mUser.mockResolvedValue(USER);
    mPost.findFirst.mockResolvedValue({ id: "p1", userId: "u1", mediaPaths: ["data/publish/media/p1/a.jpg"] });
    mVariant.findFirst.mockResolvedValue(null);
    mVariant.create.mockRejectedValueOnce({ code: "P2003" });
    await expect(
      createVariant(
        jsonReq("http://localhost/api/publish/variants", {
          postId: "p1",
          platform: "XHS",
          title: "合规标题",
          body: "正文",
          tags: ["a"],
        })
      )
    ).rejects.toEqual({ code: "P2003" });
  });

  it("I-2：POST /accounts 已有画像（userId+platform）→ update 不新增行，响应 {id, saved:'updated'}", async () => {
    mUser.mockResolvedValue(USER);
    mAccount.findFirst.mockClear();
    mAccount.create.mockClear();
    mAccount.update.mockClear();
    mAccount.findFirst.mockResolvedValue({ id: "acc-1", userId: "u1", platform: "XHS" });
    mAccount.update.mockResolvedValue({ id: "acc-1", userId: "u1", platform: "XHS" });
    const res = await saveAccount(
      jsonReq("http://localhost/api/publish/accounts", {
        platform: "xhs",
        handle: "@summer",
        positioning: "夏日打卡",
        style: "生活记录",
        tone: "轻松",
        constraints: "不发广告",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "acc-1", saved: "updated" });
    // 查找口径：按 userId+platform 取最早一行（该表无 createdAt，cuid id 时间序 asc）
    expect(mAccount.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", platform: "XHS" },
      take: 1,
      orderBy: { id: "asc" },
    });
    expect(mAccount.create).not.toHaveBeenCalled();
    expect(mAccount.update.mock.calls[0][0]).toMatchObject({
      where: { id: "acc-1" },
      data: { constraints: "不发广告" },
    });
  });

  it("I-2：POST /accounts 无画像 → create 新建一行，响应 {id, saved:'created'}", async () => {
    mUser.mockResolvedValue(USER);
    mAccount.findFirst.mockClear();
    mAccount.create.mockClear();
    mAccount.update.mockClear();
    mAccount.findFirst.mockResolvedValue(null);
    mAccount.create.mockResolvedValue({ id: "acc-new", userId: "u1", platform: "DOUYIN" });
    const res = await saveAccount(
      jsonReq("http://localhost/api/publish/accounts", {
        platform: "DOUYIN",
        handle: "@summer",
        positioning: "夏日打卡",
        style: "生活记录",
        tone: "轻松",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "acc-new", saved: "created" });
    expect(mAccount.update).not.toHaveBeenCalled();
    expect(mAccount.create.mock.calls[0][0]).toMatchObject({
      data: { userId: "u1", platform: "DOUYIN", handle: "@summer" },
    });
  });

  it("502：worker 未启动（fetch 抛 ECONNREFUSED）时 GET /api/publish/login 返 {error:'publish worker 未启动'}", async () => {
    mUser.mockResolvedValue(USER);
    const connRefused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3022"), { code: "ECONNREFUSED" }),
    });
    const fetchMock = vi.fn().mockRejectedValue(connRefused);
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await loginGet(plainReq("http://localhost/api/publish/login?platform=xhs"));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "publish worker 未启动" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

import { GET as hotGet } from "@/app/api/publish/hot/route";
import { POST as fromHot } from "@/app/api/publish/posts/from-hot/route";
import { POST as fromDoc } from "@/app/api/publish/posts/from-doc/route";
import { POST as planAi } from "@/app/api/publish/plan-ai/route";
import { GET as docsGet } from "@/app/api/publish/docs/route";

const mDoc = (prisma as unknown as { document: { findFirst: Mock; findMany: Mock } }).document;

describe("Easel 对齐批次：hot / from-hot / from-doc / docs / plan-ai", () => {
  it("401：hot 未鉴权拒绝且不请求上游", async () => {
    mUser.mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await hotGet(plainReq("http://localhost/api/publish/hot?platform=douyin"));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("400：hot 平台白名单外拒绝（防参数注入）", async () => {
    mUser.mockResolvedValue(USER);
    const res = await hotGet(plainReq("http://localhost/api/publish/hot?platform=evil%2Fx"));
    expect(res.status).toBe(400);
  });

  it("hot 成功：60s v2 响应归一化为 {title,hot,url,cover,platform}", async () => {
    mUser.mockResolvedValue(USER);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 200, data: [{ title: "t1", hot_value: 123, url: "https://x", cover: "https://c" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const res = await hotGet(plainReq("http://localhost/api/publish/hot?platform=douyin"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      { title: "t1", hot: 123, url: "https://x", cover: "https://c", platform: "douyin" },
    ]);
    vi.unstubAllGlobals();
  });

  it("from-doc：404 非本人文档不落库", async () => {
    mUser.mockResolvedValue(USER);
    mDoc.findFirst.mockResolvedValue(null);
    const res = await fromDoc(jsonReq("http://x/api/publish/posts/from-doc", { documentId: "d1" }));
    expect(res.status).toBe(404);
    expect(mPost.create).not.toHaveBeenCalled();
  });

  it("from-doc：正文为空 422 拒绝导入", async () => {
    mUser.mockResolvedValue(USER);
    mDoc.findFirst.mockResolvedValue({ id: "d1", title: "标题", content: "   " });
    const res = await fromDoc(jsonReq("http://x/api/publish/posts/from-doc", { documentId: "d1" }));
    expect(res.status).toBe(422);
  });

  it("from-doc：正常导入建 Post（title/body 搬运，fromHotlist=false）", async () => {
    mUser.mockResolvedValue(USER);
    mDoc.findFirst.mockResolvedValue({ id: "d1", title: "  文档A ", content: "正文B" });
    mPost.create.mockResolvedValue({ id: "p9", userId: "u1" });
    const res = await fromDoc(jsonReq("http://x/api/publish/posts/from-doc", { documentId: "d1" }));
    expect(res.status).toBe(200);
    expect(mPost.create).toHaveBeenCalledWith({
      data: { title: "文档A", body: "正文B", mediaPaths: [], fromHotlist: false, userId: "u1" },
    });
  });

  it("from-hot：无 title 400", async () => {
    mUser.mockResolvedValue(USER);
    const res = await fromHot(jsonReq("http://x/api/publish/posts/from-hot", { url: "https://h" }));
    expect(res.status).toBe(400);
  });

  it("from-hot：建 Post（fromHotlist=true，body=来源链接，无封面时 mediaPaths 空）", async () => {
    mUser.mockResolvedValue(USER);
    mPost.create.mockResolvedValue({ id: "p7", mediaPaths: [] });
    mPost.update.mockResolvedValue({});
    const res = await fromHot(
      jsonReq("http://x/api/publish/posts/from-hot", { title: "热点T", url: "https://hot/1" })
    );
    expect(res.status).toBe(200);
    expect(mPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromHotlist: true, mediaPaths: [] }) })
    );
  });

  it("from-hot：autoVariant=DOUYIN 标题超 30 字 → post 保留 + variantError（422 透传，不建 variant）", async () => {
    mVariant.create.mockClear();
    mUser.mockResolvedValue(USER);
    mPost.create.mockResolvedValue({ id: "p8", mediaPaths: [] });
    const longTitle = "一".repeat(31);
    const res = await fromHot(
      jsonReq("http://x/api/publish/posts/from-hot", { title: longTitle, url: "u", autoVariant: "DOUYIN" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.variant).toBeNull();
    expect(body.variantError?.errors?.length).toBeGreaterThan(0);
    expect(mVariant.create).not.toHaveBeenCalled();
  });

  it("plan-ai：404 非本人 variant 不代理 worker", async () => {
    mUser.mockResolvedValue(USER);
    mVariant.findFirst.mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await planAi(jsonReq("http://x/api/publish/plan-ai", { variantId: "v9" }));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("plan-ai：worker 未起 → 502「publish worker 未启动」", async () => {
    mUser.mockResolvedValue(USER);
    mVariant.findFirst.mockResolvedValue({ id: "v1", platform: "DOUYIN" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await planAi(jsonReq("http://x/api/publish/plan-ai", { variantId: "v1" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "publish worker 未启动" });
    vi.unstubAllGlobals();
  });

  it("docs 列表：401 未鉴权", async () => {
    mUser.mockResolvedValue(null);
    const res = await docsGet();
    expect(res.status).toBe(401);
  });
});

describe("jobs 终态复用重触发（方案变更/修复后重新排期）", () => {
  it("FAILED 旧 job → 复用重触发：reset PENDING + 新 scheduledAt + 清 lastError，返回 {reused:true}", async () => {
    mJob.update.mockClear();
    mJob.create.mockClear();
    mUser.mockResolvedValue(USER);
    mVariant.findFirst.mockResolvedValue({ id: "v1", platform: "XHS", post: { userId: "u1" } });
    mJob.findFirst.mockResolvedValue({ id: "j-old", variantId: "v1", status: "FAILED", lastError: "x", scheduledAt: new Date("2026-10-01") });
    mJob.update.mockResolvedValue({ id: "j-old", variantId: "v1", status: "PENDING", scheduledAt: new Date("2026-10-13"), lastError: null });
    const res = await createJob(jsonReq("http://x/api/publish/jobs", { variantId: "v1", scheduledAt: "2026-10-13T00:00:00Z" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "j-old", reused: true, status: "PENDING" });
    expect(mJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", lastError: null }) }));
    expect(mJob.create).not.toHaveBeenCalled();
  });

  it("CANCELLED 旧 job → 同样复用重触发", async () => {
    mJob.update.mockClear();
    mUser.mockResolvedValue(USER);
    mVariant.findFirst.mockResolvedValue({ id: "v1", platform: "XHS", post: { userId: "u1" } });
    mJob.findFirst.mockResolvedValue({ id: "j2", variantId: "v1", status: "CANCELLED", lastError: null, scheduledAt: new Date("2026-10-01") });
    mJob.update.mockResolvedValue({ id: "j2", status: "PENDING", lastError: null });
    const res = await createJob(jsonReq("http://x/api/publish/jobs", { variantId: "v1", scheduledAt: "2026-10-14T00:00:00Z" }));
    expect(res.status).toBe(200);
    expect((await res.json()).reused).toBe(true);
  });

  it("PENDING/SUCCESS 旧 job 仍 409（不可用 POST 重触发，改期走 PATCH）", async () => {
    mJob.update.mockClear();
    mUser.mockResolvedValue(USER);
    mVariant.findFirst.mockResolvedValue({ id: "v1", platform: "XHS", post: { userId: "u1" } });
    for (const status of ["PENDING", "SUCCESS"] as const) {
      mJob.findFirst.mockResolvedValue({ id: "j3", variantId: "v1", status, lastError: null, scheduledAt: new Date() });
      const res = await createJob(jsonReq("http://x/api/publish/jobs", { variantId: "v1", scheduledAt: "2026-10-15T00:00:00Z" }));
      expect(res.status).toBe(409);
    }
    expect(mJob.update).not.toHaveBeenCalled();
  });
});
