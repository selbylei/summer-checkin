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
    accountProfile: { findMany: vi.fn(), create: vi.fn() },
    publishLog: { findMany: vi.fn() },
  },
}));

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

import { POST as createPost } from "@/app/api/publish/posts/route";
import { POST as createVariant } from "@/app/api/publish/variants/route";
import { GET as loginGet } from "@/app/api/publish/login/route";

const USER = { id: "u1", name: "tester", email: "t@example.com" };

const mUser = getCurrentUser as unknown as Mock;
const mPost = prisma.post as unknown as { findFirst: Mock; create: Mock; update: Mock };
const mVariant = prisma.postVariant as unknown as { findFirst: Mock; create: Mock; update: Mock };

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
