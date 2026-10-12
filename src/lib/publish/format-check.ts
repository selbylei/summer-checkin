// 平台格式校验：入库/发布前对单个 variant 做平台维度限制检查。
// 数值来源：Easel social-content/references/platform-specs.md（各平台「标题/正文/标签/图片」规格），
// 交叉验证 skill-xhs-publisher（标题≤20 由脚本 calc_title_length 实际拦截）与
// skill-douyin-upload（标题≤30 由脚本实际拦截）。
// 注意：任务 brief 指定的 cross-platform-diff references/platform-traits.md 只含定性特征、
// 无数值上限；数值实际出自同仓 Easel 的 platform-specs.md（见各 LIMITS 条目注释）。
// references 未给上限的项一律不设限，不设 9999 占位。

// Platform 与 Prisma enum Platform（prisma/schema.prisma）保持一致；
// 此处用字面量联合而非 import @prisma-generated，避免纯逻辑模块产生跨层依赖。
export type Platform = "GZH" | "DOUYIN" | "XHS";

export interface VariantInput {
  title: string;
  body: string;
  tags: string[];
  mediaCount: number;
}

export interface VariantCheckResult {
  ok: boolean;
  errors: string[];
}

interface FieldLimits {
  titleLen?: number;
  bodyLen?: number;
  tagCount?: number;
  mediaCount?: number;
}

const LIMITS: Record<Platform, FieldLimits> = {
  XHS: {
    // 标题 ≤20 字：platform-specs.md「标题 ≤20 字」；skill-xhs-publisher 脚本实际按 20 全角字拦截
    titleLen: 20,
    // 标签 5-10 个：platform-specs.md「标签 5-10 个，正文末尾 #话题」→ 上限 10
    tagCount: 10,
    // 图片 1-9 张：platform-specs.md「图文 1-9 张」；cross-platform-diff platform-traits.md「3-9 张竖版图片」
    // 两处上限一致（9）
    mediaCount: 9,
    // 正文不设限：platform-specs.md 只给「300-800 字」建议区间，无硬上限
  },
  DOUYIN: {
    // 标题 ≤30 字：Easel skill-douyin-upload/SKILL.md「标题 ≤ 30 字（脚本校验，超限拦下）」
    titleLen: 30,
    // 正文/文案 ≤55 字：platform-specs.md「标题/文案 ≤55 字可见」
    bodyLen: 55,
    // 标签 3-5 个：platform-specs.md「标签 3-5 个，含 1-2 个热点/挑战话题」→ 上限 5
    tagCount: 5,
    // 图片数不设限：Easel references 未给抖音图片数上限（主力形式为短视频）
  },
  GZH: {
    // 主标题 ≤64 字：platform-specs.md「主标题 ≤64 字，双标题制造点击」
    titleLen: 64,
    // 正文不设限：platform-specs.md「1000-3000 字深度文」与建议区间 800-3000（platform-traits.md）
    // 均为深度文参考长度，非硬上限
    // 标签/图片数不设限：Easel GZH 规格未给标签数与图片数上限
  },
};

const charCount = (s: string) => [...s].length; // 全角/emoji 按 code point 计 1 字符

export function checkVariant(
  platform: Platform,
  input: VariantInput
): VariantCheckResult {
  const limits = LIMITS[platform];
  const errors: string[] = [];

  const titleLen = charCount(input.title);
  if (limits.titleLen !== undefined && titleLen > limits.titleLen) {
    errors.push(`${platform} 标题超长：${titleLen} 字（上限 ${limits.titleLen} 字）`);
  }

  if (limits.bodyLen !== undefined) {
    const bodyLen = charCount(input.body);
    if (bodyLen > limits.bodyLen) {
      errors.push(`${platform} 正文超长：${bodyLen} 字（上限 ${limits.bodyLen} 字）`);
    }
  }

  if (limits.tagCount !== undefined && input.tags.length > limits.tagCount) {
    errors.push(`${platform} 标签数过多：${input.tags.length} 个（上限 ${limits.tagCount} 个）`);
  }

  if (limits.mediaCount !== undefined && input.mediaCount > limits.mediaCount) {
    errors.push(
      `${platform} 图片数过多：${input.mediaCount} 张（上限 ${limits.mediaCount} 张）`
    );
  }

  return { ok: errors.length === 0, errors };
}
