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

  const account = await prisma.accountProfile.create({
    data: {
      platform,
      handle: fields.handle,
      positioning: fields.positioning,
      style: fields.style,
      tone: fields.tone,
      userId: user.id, // user 域隔离（缺口裁决①：AccountProfile 挂 userId）
      ...(typeof body.constraints === "string" ? { constraints: body.constraints } : {}),
    },
  });
  return NextResponse.json(account);
}

// GET /api/publish/accounts：当前 user 的账号画像列表
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await prisma.accountProfile.findMany({ where: { userId: user.id } });
  return NextResponse.json(accounts);
}
