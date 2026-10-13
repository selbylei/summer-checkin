-- 发布会话+技能批次：PostVariant 增加 format 列（内容形式：IMAGE_TEXT/VIDEO）
-- 形式跟着技能走（Easel 工作流对齐）：旧数据/表单通道默认 IMAGE_TEXT，零迁移风险
ALTER TABLE "postvariant" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'IMAGE_TEXT';
