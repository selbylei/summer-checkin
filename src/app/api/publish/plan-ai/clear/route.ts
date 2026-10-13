import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

// POST /api/publish/plan-ai/clear {variantId}：撤销方案——variant.plan 置 null
//（不影响已批准/已发布状态与排期，仅清方案缓存）。撤销后可重新「生成方案」重选。
// 用 POST 而非 DELETE：undici（Node 18.18+）会剥掉 DELETE 请求的 body，variantId 传不进来。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  if (!variantId) return NextResponse.json({ error: "variantId 必填（JSON body）" }, { status: 400 });

  const variant = await prisma.postVariant.findFirst({
    where: { id: variantId, post: { userId: user.id } },
    select: { id: true, plan: true },
  });
  if (!variant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (variant.plan === null) {
    return NextResponse.json({ variantId, plan: null, cleared: false });
  }
  await prisma.postVariant.update({ where: { id: variantId }, data: { plan: null } });
  return NextResponse.json({ variantId, plan: null, cleared: true });
}
