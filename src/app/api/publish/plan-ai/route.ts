import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";
import { prisma } from "@/lib/prisma";

// POST /api/publish/plan-ai {variantId, force?}：规划层（Easel「策划」对齐）——薄代理 worker /ai-plan。
// worker 内 spawn pi headless（--no-tools）出发布方案 JSON；方案生成一次后存 variant.plan（保留，不重跑），
// force=true 才重新生成覆盖；同步等待（上限 ~180s）。
// 域隔离：variant 必须归属当前 user（404 口径同 variants/[id]）。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  const force = body.force === true;
  if (!variantId) return NextResponse.json({ error: "variantId 必填" }, { status: 400 });

  const variant = await prisma.postVariant.findFirst({
    where: { id: variantId, post: { userId: user.id } },
  });
  if (!variant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const resp = await fetch(`${workerBase()}/ai-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId, force }),
    });
    const data = await resp.json().catch(() => ({}));
    // worker 业务码透传（400/502）；仅网络层失败才 502「worker 未启动」
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
