#!/usr/bin/env node
/**
 * 离线自测：校验 vendor 的 Easel 发布脚本（server/publish/easel）完整性。
 *
 * 依次以 child_process 跑：
 *   1. xhs_publish.py    selftest   （离线自检）
 *   2. douyin_publish.py selftest   （离线自检）
 *   3. web_publisher.py  selftest   （离线自检；若某版本无 selftest 子命令则回退 platforms）
 *   4. xhs_publish.py    plan       （dry-run 缺省，只打印发布步骤，不触网不发布）
 *
 * 全部离线，不触网、不真正发布。任一脚本非 0 退出 → 打印失败项 + 退出码，process.exit(1)。
 *
 * 用法：node scripts/publish-selftest.mjs   （可用 PYTHON 环境变量覆盖解释器，默认 python3）
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EASEL_DIR = path.join(__dirname, '..', 'server', 'publish', 'easel');
const PYTHON = process.env.PYTHON || 'python3';

const script = (rel) => path.join(EASEL_DIR, rel);

// 每一步：{ 名称, 相对脚本, 其余参数 }。顺序即执行顺序。
const steps = [
  { name: 'xhs_publish selftest', rel: 'xhs_publish.py', args: ['selftest'] },
  { name: 'douyin_publish selftest', rel: 'douyin_publish.py', args: ['selftest'] },
  { name: 'web_publisher selftest', rel: 'web_publisher.py', args: ['selftest'] },
  // 控制器裁决：xhs plan 不传 --exec（缺省即 dry-run，只打印步骤、不触网、不真正发布）。
  { name: 'xhs plan dry-run', rel: 'xhs_publish.py', args: ['plan', '--title', '测试', '--content', '测试'] },
];

// 用 --help 探测某脚本支持的子命令，用于 web_publisher selftest→platforms 的兜底判定。
function subcommands(rel) {
  try {
    const out = execFileSync(PYTHON, [script(rel), '--help'], {
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    });
    // 在 --help 输出里找子命令名（argparse 的可选子命令段落）
    return ['selftest', 'platforms'].filter((c) => new RegExp(`(^|\\s)${c}(\\s|$)`, 'm').test(out));
  } catch {
    return ['selftest'];
  }
}

function runStep(name, rel, args) {
  const cmd = [script(rel), ...args];
  process.stdout.write(`\n=== ${name} :: ${PYTHON} ${rel} ${args.join(' ')}\n`);
  try {
    const out = execFileSync(PYTHON, cmd, {
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    });
    if (out) process.stdout.write(out.trimEnd() + '\n');
    return null;
  } catch (err) {
    if (err.stdout) process.stderr.write(String(err.stdout));
    if (err.stderr) process.stderr.write(String(err.stderr));
    if (err.status === undefined) return `无法执行 ${PYTHON}：${err.code || err.message}`;
    return `失败（退出码 ${err.status}）`;
  }
}

let failed = 0;
for (const step of steps) {
  let args = step.args;
  // 仅 web_publisher：若其当前版本无 selftest 子命令，则回退到 platforms（brief 兜底规则）
  if (step.rel === 'web_publisher.py' && !subcommands(step.rel).includes('selftest')) {
    args = ['platforms'];
  }
  const failure = runStep(step.name, step.rel, args);
  if (failure) {
    failed += 1;
    console.error(`❌ ${step.name} ${failure}`);
  } else {
    process.stdout.write(`✅ ${step.name} 通过\n`);
  }
}

if (failed > 0) {
  console.error(`\n[ERROR] ${failed}/${steps.length} 项发布脚本自测失败`);
  process.exit(1);
}
console.log(`\n[OK] ${steps.length}/${steps.length} 项发布脚本自测通过（离线）`);
