-- 发布平台 Easel 对齐批次③：PostVariant 增加 plan 列（AI 规划层方案 JSON 持久化）
-- 与 prisma/schema.prisma PostVariant.plan 对应；应用方式：
--   psql "$DATABASE_URL" -f prisma/add-publish-variant-plan.sql && npx prisma db push && npx prisma generate
ALTER TABLE "postvariant" ADD COLUMN "plan" TEXT;
COMMENT ON COLUMN "postvariant"."plan" IS 'AI 规划层方案 JSON（angle/format/titles/bodyOutline/tags/timeliness）；生成一次后保留，force 重新生成，置 NULL 撤销';
