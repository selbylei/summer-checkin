-- Task 6 缺口裁决①：user.id 域隔离落点——Post / AccountProfile 加 userId 列（必填）+ 索引 + FK。
-- Job/Variant/Log 经 Post 归属天然隔离，不加列；worker 排期器全量扫 PENDING 不动（P1 单用户，
-- P2 多租户时再收敛，worker 侧注释留痕在 server/publish-worker/scheduler.ts 由后续任务补）。
-- 执行前提：dev 库 5 张发布表当时为 0 行（Task 6 手测核实），NOT NULL 直接加列无需回填 UPDATE。
-- 应用方式（同 Task 1）：psql "$DATABASE_URL" -f 本文件（或 npx prisma db execute --file）
--   → npx prisma db push（零漂移核验）→ npx prisma generate

ALTER TABLE "post" ADD COLUMN "userId" TEXT NOT NULL;
ALTER TABLE "post"
  ADD CONSTRAINT "post_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "post_userId_idx" ON "post" ("userId");

ALTER TABLE "accountprofile" ADD COLUMN "userId" TEXT NOT NULL;
ALTER TABLE "accountprofile"
  ADD CONSTRAINT "accountprofile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "accountprofile_userId_idx" ON "accountprofile" ("userId");
