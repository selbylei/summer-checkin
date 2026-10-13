import { describe, expect, it } from "vitest";

import { checkVariant } from "@/lib/publish/format-check";

// 全角长度一律按「字符数」（code point）计：`"字".repeat(n)` 恰好 n 个字符。
const zh = (n: number) => "字".repeat(n);
const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

// 数值来源：Easel social-content/references/platform-specs.md（各平台上限）
// 交叉验证：skill-xhs-publisher（标题≤20 脚本校验）、skill-douyin-upload（标题≤30 脚本校验）。
describe("checkVariant", () => {
  describe("XHS 小红书", () => {
    it("超限：21 字标题被拦（上限 20）", () => {
      const r = checkVariant("XHS", { title: zh(21), body: "好", tags: [], mediaCount: 1 });
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/标题/);
    });

    it("超限：11 个标签 + 10 张图同时被拦（标签上限 10、图片上限 9）", () => {
      const r = checkVariant("XHS", { title: "好标题", body: "好", tags: tags(11), mediaCount: 10 });
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(2);
      expect(r.errors.join(" ")).toMatch(/标签/);
      expect(r.errors.join(" ")).toMatch(/图片/);
    });

    it("正文不设上限（platform-specs 只给 300-800 字建议区间，无硬上限）", () => {
      const r = checkVariant("XHS", { title: "好", body: zh(5000), tags: [], mediaCount: 1 });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("合规：正好 20 字标题 + 10 标签 + 9 图全部放行（边界=上限不报错）", () => {
      const r = checkVariant("XHS", { title: zh(20), body: "好", tags: tags(10), mediaCount: 9 });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("合规：emoji 按 code point 计数，20 个 emoji 标题=20 字放行", () => {
      const r = checkVariant("XHS", { title: "😀".repeat(20), body: "好", tags: [], mediaCount: 1 });
      // UTF-16 单元数会是 40，若实现误用 .length 此处会误报超限
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });
  });

  describe("DOUYIN 抖音", () => {
    it("超限：31 字标题被拦（上限 30）", () => {
      const r = checkVariant("DOUYIN", { title: zh(31), body: "好", tags: [], mediaCount: 1 });
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/标题/);
    });

    it("超限：56 字正文被拦（文案可见上限 55）", () => {
      const r = checkVariant("DOUYIN", { title: "好", body: zh(56), tags: [], mediaCount: 1 });
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/正文/);
    });

    it("超限：6 个标签被拦（上限 5）", () => {
      const r = checkVariant("DOUYIN", { title: "好", body: "好", tags: tags(6), mediaCount: 1 });
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/标签/);
    });

    it("图片数不设上限（references 未给抖音图片数上限，以视频为主）", () => {
      const r = checkVariant("DOUYIN", { title: "好", body: "好", tags: [], mediaCount: 100 });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("合规：正好 30 字标题 + 55 字正文 + 5 标签放行", () => {
      const r = checkVariant("DOUYIN", { title: zh(30), body: zh(55), tags: tags(5), mediaCount: 3 });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });
  });

  describe("GZH 公众号", () => {
    it("超限：65 字标题被拦（主标题上限 64）", () => {
      const r = checkVariant("GZH", { title: zh(65), body: "好", tags: [], mediaCount: 1 });
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/标题/);
    });

    it("合规：正好 64 字标题放行；正文/标签/图片数均不设上限", () => {
      const r = checkVariant("GZH", { title: zh(64), body: zh(10000), tags: tags(50), mediaCount: 99 });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
    });
  });
});

describe("图片下限（发布脚本硬门前移）", () => {
  it("DOUYIN 0 图 → 报缺少图片；1 图 → 通过", () => {
    const bad = checkVariant("DOUYIN", { title: "t", body: "好", tags: [], mediaCount: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain("缺少图片");
    const ok = checkVariant("DOUYIN", { title: "t", body: "好", tags: [], mediaCount: 1 });
    expect(ok.ok).toBe(true);
  });

  it("XHS 0 图 → 报缺少图片（图文 1-9 张下限 1）", () => {
    const bad = checkVariant("XHS", { title: "t", body: "好", tags: [], mediaCount: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain("缺少图片");
  });

  it("GZH 不设下限：0 图通过", () => {
    const r = checkVariant("GZH", { title: "t", body: "正文", tags: [], mediaCount: 0 });
    expect(r.ok).toBe(true);
  });
});
