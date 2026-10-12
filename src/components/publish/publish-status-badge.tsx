"use client";

// 状态徽章：统一发布域各状态的颜色口径（plans 页状态同款 muted/primary/destructive 语义）
import { Badge } from "@/components/ui/badge";
import {
  JOB_STATUS_LABEL,
  LOG_STAGE_LABEL,
  POST_STATUS_LABEL,
  VARIANT_STATUS_LABEL,
  type JobStatus,
  type LogStage,
  type PostStatus,
  type VariantStatus,
} from "./publish-shared";

const POST_TONE: Record<PostStatus, "outline" | "secondary" | "default" | "destructive"> = {
  DRAFT: "outline",
  READY: "secondary",
  PUBLISHED: "default",
  FAILED: "destructive",
};

const VARIANT_TONE: Record<VariantStatus, "outline" | "secondary" | "default"> = {
  DRAFT: "outline",
  APPROVED: "secondary",
  PUBLISHED: "default",
};

const JOB_TONE: Record<JobStatus, "outline" | "secondary" | "default" | "destructive"> = {
  PENDING: "outline",
  RUNNING: "secondary",
  SUCCESS: "default",
  FAILED: "destructive",
  CANCELLED: "outline",
};

const STAGE_TONE: Record<LogStage, "outline" | "secondary" | "default"> = {
  PLAN: "outline",
  PUBLISH: "secondary",
  VERIFY: "default",
  COLLECT: "outline",
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  return (
    <Badge variant={POST_TONE[status]}>
      {POST_STATUS_LABEL[status]}
    </Badge>
  );
}

export function VariantStatusBadge({ status }: { status: VariantStatus }) {
  return <Badge variant={VARIANT_TONE[status]}>{VARIANT_STATUS_LABEL[status]}</Badge>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge variant={JOB_TONE[status]}>{JOB_STATUS_LABEL[status]}</Badge>;
}

export function LogStageBadge({ stage }: { stage: LogStage }) {
  return <Badge variant={STAGE_TONE[stage]}>{LOG_STAGE_LABEL[stage]}</Badge>;
}
