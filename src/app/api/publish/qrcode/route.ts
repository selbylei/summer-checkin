import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth-utils";

// GET /api/publish/qrcode?platform=：静态读 worker 落盘的扫码 PNG（data/publish/qrcode/<platform>.png，
// 路径约定与 worker status.ts loginPaths 一致；需先调 GET /api/publish/login 触发 worker 生成）
const ALLOWED = ["xhs", "douyin"]; // 白名单兼防路径穿越（与 worker P1 平台集一致）

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const platform = (searchParams.get("platform") ?? "").trim().toLowerCase();
  if (!ALLOWED.includes(platform)) {
    return NextResponse.json({ error: "platform 参数缺失或不支持（P1 仅 xhs/douyin）" }, { status: 400 });
  }

  try {
    const file = path.join(process.cwd(), "data", "publish", "qrcode", `${platform}.png`);
    const buf = await fs.readFile(file);
    return new Response(buf, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "二维码未生成，请先调 GET /api/publish/login" }, { status: 404 });
  }
}
