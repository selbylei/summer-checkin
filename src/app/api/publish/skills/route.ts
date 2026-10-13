import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { workerBase } from "@/lib/publish/worker-client";

// GET /api/publish/skills：技能清单（vendor 于 server/publish/skills/，worker 读文件）。
// 会话页首步「选技能=选工作流」用；worker 未起 → 502（技能是本地文件，其实可不依赖 worker，
// 但保持与 skill-run 同一读取方（避免双份读取逻辑），暂走 worker）。
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const resp = await fetch(`${workerBase()}/skills`);
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "publish worker 未启动" }, { status: 502 });
  }
}
