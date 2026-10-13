-- 发布平台 P1：5 张新表 + 5 个枚举（与设计稿 docs/发布平台设计.md §3 对应，字段与 prisma/schema.prisma 逐字段一致）
-- PostMetric 属 P3，不在本脚本内。
-- 应用方式：psql "$DATABASE_URL" -f prisma/add-publish-platform-tables.sql
-- 随后 npx prisma db push（应为无变更）+ npx prisma generate

CREATE TYPE "Platform" AS ENUM ('GZH', 'DOUYIN', 'XHS');
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'READY', 'PUBLISHED', 'FAILED');
CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE "LogStage" AS ENUM ('PLAN', 'PUBLISH', 'VERIFY', 'COLLECT');

CREATE TABLE "post" (
  "id"          TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "mediaPaths"  TEXT[] NOT NULL,
  "status"      "PostStatus" NOT NULL DEFAULT 'DRAFT',
  "fromHotlist" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "postvariant" (
  "id"          TEXT NOT NULL,
  "postId"      TEXT NOT NULL,
  "platform"    "Platform" NOT NULL,
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "tags"        TEXT[] NOT NULL,
  "coverPath"   TEXT,
  "status"      "VariantStatus" NOT NULL DEFAULT 'DRAFT',
  "formatCheck" TEXT,
  CONSTRAINT "postvariant_pkey" PRIMARY KEY ("id")
);

-- 每 Post 每 platform 至多 1 个 Variant（设计稿 §3 联合唯一约束）
CREATE UNIQUE INDEX "postvariant_postId_platform_key" ON "postvariant" ("postId", "platform");
CREATE INDEX "postvariant_postId_idx" ON "postvariant" ("postId");

CREATE TABLE "publishjob" (
  "id"          TEXT NOT NULL,
  "variantId"   TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status"      "JobStatus" NOT NULL DEFAULT 'PENDING',
  "lastError"   TEXT,
  CONSTRAINT "publishjob_pkey" PRIMARY KEY ("id")
);

-- Job 与 Variant 1:1 排期（改期=改时间不重建）
CREATE UNIQUE INDEX "publishjob_variantId_key" ON "publishjob" ("variantId");
-- 排期器每分钟扫描：status=PENDING AND scheduledAt<=now
CREATE INDEX "publishjob_status_scheduledAt_idx" ON "publishjob" ("status", "scheduledAt");

CREATE TABLE "publishlog" (
  "id"             TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "stage"          "LogStage" NOT NULL,
  "detail"         TEXT NOT NULL,
  "screenshotPath" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "publishlog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "publishlog_jobId_idx" ON "publishlog" ("jobId");

CREATE TABLE "accountprofile" (
  "id"          TEXT NOT NULL,
  "platform"    "Platform" NOT NULL,
  "handle"      TEXT NOT NULL,
  "positioning" TEXT NOT NULL,
  "style"       TEXT NOT NULL,
  "tone"        TEXT NOT NULL,
  "constraints" TEXT,
  CONSTRAINT "accountprofile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "postvariant"
  ADD CONSTRAINT "postvariant_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publishjob"
  ADD CONSTRAINT "publishjob_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "postvariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publishlog"
  ADD CONSTRAINT "publishlog_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "publishjob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
