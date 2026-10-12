import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET /api/publish/login?platform=：透传 worker 的 GET /login（后台启 Easel 扫码登录，
// 返 {qrPath,statusFile}；gzh→501 透传；缺参→400 透传）
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const platform = (searchParams.get("platform") ?? "").trim();
  try {
    const resp = await fetch(`${workerBase()}/login?platform=${encodeURIComponent(platform)}`);
    const data = await resp.json().catch(() => ({}));
    // worker 业务状态码（400/501）透传；仅网络层失败才 502
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
