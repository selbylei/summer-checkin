import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { type Platform } from "@/lib/publish/format-check";

// POST /api/publish/accounts：账号画像（P1 只存不消费，P2 起填入 pi 会话）
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const platform = String(body.platform ?? "").toUpperCase() as Platform;
  const fields: Record<string, string> = {};
  for (const key of ["handle", "positioning", "style", "tone"]) {
    fields[key] = typeof body[key] === "string" ? (body[key] as string).trim() : "";
  }
  if (!["GZH", "DOUYIN", "XHS"].includes(platform) || !fields.handle || !fields.positioning || !fields.style || !fields.tone) {
    return NextResponse.json(
      { error: "platform(GZH/DOUYIN/XHS)/handle/positioning/style/tone 必填" },
      { status: 400 }
    );
  }

  // upsert（按 userId+platform，最早一行）：重复保存只 update 不新增行；schema 不加唯一约束（控制器裁决）。
  // 该表无 createdAt 列，orderBy id asc：cuid 时间单调序，等效取最早一行
  const existing = await prisma.accountProfile.findFirst({
    where: { userId: user.id, platform },
    take: 1,
    orderBy: { id: "asc" },
  });
  const data = {
    handle: fields.handle,
    positioning: fields.positioning,
    style: fields.style,
    tone: fields.tone,
    ...(typeof body.constraints === "string" ? { constraints: body.constraints } : {}),
  };
  if (existing) {
    const account = await prisma.accountProfile.update({
      where: { id: existing.id },
      data,
    });
    return NextResponse.json({ id: account.id, saved: "updated" });
  }
  const account = await prisma.accountProfile.create({
    data: {
      platform,
      ...data,
      userId: user.id, // user 域隔离（缺口裁决①：AccountProfile 挂 userId）
    },
  });
  return NextResponse.json({ id: account.id, saved: "created" });
}

// GET /api/publish/accounts：当前 user 的账号画像列表
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await prisma.accountProfile.findMany({ where: { userId: user.id } });
  return NextResponse.json(accounts);
}
