// 排期器（Task 5）：每分钟扫 due 的 PENDING Job，只自动发 APPROVED 变体
// Global Constraints 排期闸门与 processJob 批准闸门双保险：dueJobs 只认 variant.status=APPROVED
import type { PrismaClient, PublishJob } from "@prisma-generated/client";
import { processJob } from "./process-job";

const TICK_MS = 60_000;

/**
 * 到期的可自动发布 Job（status=PENDING 且 scheduledAt<=now，且 variant.status=APPROVED）。
 * join 用 nested findMany 二次查（Prisma 无跨表嵌套 where）：
 * ① 先查 PENDING+due job；② 再按 variantId 批查 variant，过滤出 APPROVED 的 job
 */
export async function dueJobs(prisma: PrismaClient): Promise<PublishJob[]> {
  const pending = await prisma.publishJob.findMany({
    where: { status: "PENDING", scheduledAt: { lte: new Date() } },
  });
  if (pending.length === 0) return [];
  const variants = await prisma.postVariant.findMany({
    where: { id: { in: [...new Set(pending.map((j) => j.variantId))] } },
  });
  const approved = new Set(variants.filter((v) => v.status === "APPROVED").map((v) => v.id));
  return pending.filter((j) => approved.has(j.variantId));
}

/**
 * 一轮扫描：逐 job 调 processJob（主链路自带批准闸门/日志/终态落库）；
 * 单 job 异常吞掉记 log 不阻塞其余（返回本轮成功处理数）
 */
export async function tick(prisma: PrismaClient): Promise<number> {
  const jobs = await dueJobs(prisma);
  let processed = 0;
  for (const job of jobs) {
    try {
      await processJob(job.id);
      processed++;
    } catch (e) {
      console.error(
        `[scheduler] processJob(${job.id}) 异常（继续其余任务）:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (jobs.length > 0) console.log(`[scheduler] tick 处理 ${processed}/${jobs.length} 个到期任务`);
  return processed;
}

/**
 * 启动 60s 排期（setInterval，unref 不阻止进程退出——worker kill 干净）；
 * tick 自身异常（如 DB 断连）吞掉，不让定时器炸掉进程
 */
export function startScheduler(prisma: PrismaClient): NodeJS.Timeout {
  const timer = setInterval(() => {
    tick(prisma).catch((e) => {
      console.error("[scheduler] tick 异常（等待下轮）:", e instanceof Error ? e.message : e);
    });
  }, TICK_MS);
  timer.unref();
  return timer;
}
