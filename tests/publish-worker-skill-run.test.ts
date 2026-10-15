// 技能工作流执行面（Easel 对齐）：pi --skill 原生发现 + read/write 工具面参数
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildPiArgs, listSkills, WORKFLOW_SKILLS } from "../server/publish-worker/skill-run";

describe("buildPiArgs（pi 执行面）", () => {
  it("含 -p prompt + --skill <skillsdir>/<slug> + --tools read,write + --no-mcp", () => {
    const args = buildPiArgs("PROMPT", "copywriting", "m");
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("PROMPT");
    const skillPath = args[args.indexOf("--skill") + 1] as string;
    expect(skillPath).toBe(path.join(process.cwd(), "server", "publish", "skills", "copywriting"));
    expect(args[args.indexOf("--tools") + 1]).toBe("read,write");
    expect(args).toContain("--no-mcp");
    expect(args).toContain("m"); // model 透传
    // session-dir 落 drafts 下（data/publish/ gitignored）
    const sd = args[args.indexOf("--session-dir") + 1] as string;
    expect(sd).toContain("data");
    expect(sd).toContain("publish");
  });
});

describe("listSkills（选择器口径）", () => {
  it("列出全部技能（2026-10-15 拍板：毛筆入口全量，不限首批 5）；首批 5 仍在其内", () => {
    const skills = listSkills();
    expect(skills.length).toBeGreaterThan(50); // 全量库（当前 114 技能）
    for (const w of WORKFLOW_SKILLS) {
      expect(skills.some((s) => s.slug === w)).toBe(true); // 首批 5 仍在
    }
    for (const s of skills) expect(s.name.length).toBeGreaterThan(0);
  });
});

// 全量技能库 vendor 冒烟（2026-10-14 Easel 全库 114 技能）：
// 不做全量逐条测试——随机抽几个验完整性（SKILL.md 存在 + frontmatter name/description 可解析 + 目录同名）。
// 库随 Easel 更新重 vendor，全量断言会跟着烂；抽样 = 验证「rsync 没断、目录结构没变」这一层不变式。
const SKILLS_DIR = path.join(process.cwd(), "server", "publish", "skills");
const SHARED_DIR = path.join(process.cwd(), "server", "publish", "shared");

describe("技能全量库 vendor 完整性（随机抽样）", () => {
  function sampleSkills(n: number): string[] {
    const all = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    // Fisher–Yates 前 n 个（不关心可复现性，只要随机均匀）
    const pool = [...all];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(n, pool.length));
  }

  it("抽 6 个技能：SKILL.md 存在且 frontmatter name 可解析（=目录名或已知别名）、description 非空", () => {
    const slugs = sampleSkills(6);
    expect(slugs.length).toBeGreaterThanOrEqual(5); // 库不该缩水到 5 以下（114 量级）
    // vendor 数据已知：个别技能 name≠目录名（别名表），不断言全量一致
    const NAME_ALIASES: Record<string, string> = { redbook: "skill-xhs-analyzer" };
    for (const slug of slugs) {
      const raw = fs.readFileSync(path.join(SKILLS_DIR, slug, "SKILL.md"), "utf8");
      const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      expect(name, `${slug}/SKILL.md frontmatter name 为空`).toBeTruthy();
      expect(name === slug || NAME_ALIASES[name ?? ""] === slug, `${slug} name=${name} 既非目录名也非已知别名`).toBe(true);
      expect(raw.slice(0, 400).includes("description"), `${slug} 缺 description`).toBe(true);
    }
  });

  it("shared 共享层在位（技能 ../../shared/ 相对引用的落点）", () => {
    expect(fs.existsSync(path.join(SHARED_DIR, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(SHARED_DIR, "references"))).toBe(true);
    expect(fs.existsSync(path.join(SHARED_DIR, "scripts"))).toBe(true);
  });
});
