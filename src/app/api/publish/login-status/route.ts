import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET /api/publish/login-status?platform=：透传 worker 的 GET /login-status
// （statusFile JSON；worker 侧文件不存在→{status:"pending"}，前端轮询到 success/error 才停）
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const platform = (searchParams.get("platform") ?? "").trim();
  try {
    const resp = await fetch(`${workerBase()}/login-status?platform=${encodeURIComponent(platform)}`);
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
