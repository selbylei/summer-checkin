import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET /api/publish/health：publish worker 在线状态（Easel 侧栏状态脚用；鉴权同其他 publish 代理）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const resp = await fetch(`${workerBase()}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json({ ok: resp.ok && !!data.ok });
  } catch {
    return NextResponse.json({ ok: false, error: "publish worker 未启动" }, { status: 502 });
  }
}
