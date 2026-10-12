-- Task 6 缺口裁决①：user.id 域隔离落点——Post / AccountProfile 加 userId 列（必填）+ 索引。
-- Job/Variant/Log 经 Post 归属天然隔离，不加列；worker 排期器全量扫 PENDING 不动（P1 单用户，
-- P2 多租户时再收敛，worker 侧注释留痕在 server/publish-worker/scheduler.ts 由后续任务补）。
-- 三段式回填（R1 修复：原稿直接 ADD COLUMN NOT NULL，仅 0 行库可过；改后含行库也能执行）：
--   1) ADD COLUMN 可空 → 2) UPDATE 回填 → 3) ALTER COLUMN SET NOT NULL → CREATE INDEX。
-- 回填值：P1 单用户库，既有行统一挂 dev 库首个 user（子查询随库自动对齐，不写死 magic value；
-- 执行者先 SELECT id FROM "user" LIMIT 1 确认该库）。
-- DB 级 FK 不入本文件：schema.prisma 的 Post/AccountProfile 未声明 →User 关系，
-- `npx prisma db push` 会移除 schema 外约束（R1 实测）；域隔离主闸在应用层
-- findFirst({where:{id,userId}}) 复合条件；DB 级 ON DELETE CASCADE 约束随 P2 多租户
-- 在 schema 里声明 relation 时一并落库。
-- 执行前提：dev 库至少 1 个 user（better-auth 首个 sign-up 即满足；user 表为空时子查询返 NULL，
-- SET NOT NULL 会报错——P1 单用户前提下不会发生）。
-- 应用方式（同 Task 1）：psql "$DATABASE_URL" -f 本文件（或 npx prisma db execute --file）
--   → npx prisma db push（零漂移核验）。仅执行一次：已含 userId 列的库重跑会报
--   column already exists（与 Task 1 迁移同口径）。

ALTER TABLE "post" ADD COLUMN "userId" TEXT;
UPDATE "post" SET "userId" = (SELECT id FROM "user" LIMIT 1) WHERE "userId" IS NULL;
ALTER TABLE "post" ALTER COLUMN "userId" SET NOT NULL;
CREATE INDEX "post_userId_idx" ON "post" ("userId");

ALTER TABLE "accountprofile" ADD COLUMN "userId" TEXT;
UPDATE "accountprofile" SET "userId" = (SELECT id FROM "user" LIMIT 1) WHERE "userId" IS NULL;
ALTER TABLE "accountprofile" ALTER COLUMN "userId" SET NOT NULL;
CREATE INDEX "accountprofile_userId_idx" ON "accountprofile" ("userId");
