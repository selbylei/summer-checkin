#!/usr/bin/env python3
"""把 Easel web/frontend 的 CSS 作用域化到 .easel-shell（1:1 视觉，不污染宿主 app）。
来源：Easel dev_pi/web/frontend/src/styles/{index.css,theme.css}（Apache-2.0）。"""
import re, sys

SRC = "/Users/selbylei/orca/workspaces/Easel/dev_pi/web/frontend/src/styles"
OUT = "src/components/publish/easel/easel.css"

# 需要的选择器前缀（top-level 类名 / 组合）
KEEP = [
    ".app-layout",
    ".sidebar", ".sidebar-header", ".sidebar-logo", ".sidebar-section", ".sidebar-status",
    ".session-item", ".session-actions", ".session-act", ".session-rename-input",
    ".new-chat-btn", ".status-dot",
    ".card", ".badge", ".btn", ".spinner",
    ".main-content", ".page-host",
    ".chat-page", ".chat-messages", ".chat-thread", ".chat-hero", ".chat-input",
    ".suggestions", ".suggestion", ".chat-empty",
    ".composer", ".brush", ".message-row", ".message-bubble", ".msg-col", ".msg-actions",
    ".msg-action", ".live-panel", ".live-activity", ".live-pulse", ".live-still",
    ".thinking-block", ".thinking-text", ".streaming-cursor", ".send-btn", ".typing",
    ".theme-toggle",
]
DROP_EXACT = {"*", "*::before, *::after", "* , *::before, *::after", "html, body, #root", "body",
              "html", "#root", ":root, :root *", "::-webkit-scrollbar", "::-webkit-scrollbar-track", "::-webkit-scrollbar-thumb", "::-webkit-scrollbar-thumb:hover"}

def parse_top(css):
    """top-level 块解析：返回 [(selector_or_at, body_text_including_braces)]，注释/空行丢弃"""
    out = []
    i, n = 0, len(css)
    while i < n:
        # 跳过注释/空白
        while i < n and (css[i].isspace() or css[i:i+2] == "/*"):
            if css[i:i+2] == "/*":
                j = css.find("*/", i)
                i = j + 2 if j != -1 else n
            else:
                i += 1
        if i >= n:
            break
        if css[i] == "@":
            m = re.match(r"@([a-z-]+)", css[i:])
            at = m.group(1)
            # 找块开始
            brace = css.find("{", i)
            sel = css[i:brace].strip()
            # 配对大括号取 body
            depth, k = 0, brace
            while k < n:
                if css[k] == "{": depth += 1
                elif css[k] == "}":
                    depth -= 1
                    if depth == 0: break
                k += 1
            block = css[i:k+1]
            out.append((sel, block))
            i = k + 1
        else:
            # 普通规则（可能多选择器同块；到下一个 top 级 } 为止）
            brace = css.find("{", i)
            sel = css[i:brace].strip()
            depth, k = 0, brace
            while k < n:
                if css[k] == "{": depth += 1
                elif css[k] == "}":
                    depth -= 1
                    if depth == 0: break
                k += 1
            out.append((sel, css[i:k+1]))
            i = k + 1
    return out

def selector_kept(sel):
    """sel 形如 '.a, .b:hover'；任一选择器命中 KEEP 且不在 DROP 即保留（后续逐个前缀化）"""
    parts = [p.strip() for p in sel.split(",")]
    kept = [p for p in parts if p and p not in DROP_EXACT and any(p.startswith(k) for k in KEEP)]
    return kept

def transform_sel(s):
    s = s.strip()
    # :is(…)/:where(…) 合法 CSS：切分器已括号感知，前缀化后原样保留
    if s == ":root":
        return ".easel-shell"
    if s == ":root[data-theme='dark']":
        return ".easel-shell[data-theme='dark']"
    # 复合选择器（如 .composer-top .chat-input、.theme-toggle:hover、:root[data-theme='dark'] .sidebar）
    m = re.match(r"^:root\[data-theme='dark'\]\s+(.+)$", s)
    if m:
        target = m.group(1)
        if target in DROP_EXACT:
            return None
        return f".easel-shell[data-theme='dark'] {target}"
    if s.startswith("::") or s in DROP_EXACT:
        return None
    if not any(s.startswith(k) for k in KEEP):
        return None
    return f".easel-shell {s}"

KF_MAP = {"fadeIn": "easel-fadeIn", "spin": "easel-spin", "blink": "easel-blink",
          "slideInRight": "easel-slideInRight", "popIn": "easel-popIn", "pulse": "easel-pulse",
          "brush-float": "easel-brush-float", "brush-pop": "easel-brush-pop", "typingBounce": "easel-typingBounce"}

def main():
    chunks = []
    for f in ("index.css", "theme.css"):
        css = open(f"{SRC}/{f}").read()
        for sel, block in parse_top(css):
            if block.startswith("@keyframes"):
                name = sel.replace("@keyframes", "").strip()
                new = KF_MAP.get(name, "easel-" + name)
                chunks.append(block.replace(f"@keyframes {name}", f"@keyframes {new}"))
            elif block.startswith("@media"):
                # @media 内部规则逐个前缀化（Easel 的 media 块都很小）
                m = re.match(r"@media[^{]+\{(.*)\}\s*$", block, re.S)
                inner = m.group(1)
                out_inner = []
                for sel2, block2 in parse_top(inner):
                    s = transform_sel(sel2.strip())
                    if s:
                        out_inner.append(f"{s} {{\n{block2[block2.find('{')+1:-1]}\n}}")
                if out_inner:
                    media_head = re.match(r"@media[^{]+", block).group(0)
                    chunks.append(media_head + " {\n" + "\n".join(out_inner) + "\n}")
            else:
                kept = []
                # 顶层逗号切分（括号内逗号属于 :is(…)/:where(…)，不切）
                parts, depth, buf = [], 0, ""
                for ch in sel:
                    if ch == "(":
                        depth += 1
                    elif ch == ")":
                        depth = max(0, depth - 1)
                    if ch == "," and depth == 0:
                        parts.append(buf)
                        buf = ""
                    else:
                        buf += ch
                parts.append(buf)
                for p in parts:
                    p = p.strip()
                    t = transform_sel(p)
                    if t:
                        kept.append(t)
                if not kept:
                    continue
                body = block[block.find("{") + 1 : block.rfind("}")]
                chunks.append(f"{', '.join(kept)} {{\n{body.rstrip()}\n}}")
    text = "\n".join(chunks)
    # 统一 keyframes 引用（animation: spin … → easel-spin；brush-float/brush-pop/typingBounce/pulse）
    for old, new in KF_MAP.items():
        text = re.sub(rf"(?<![\w-]){old}(?![\w-])", new, text)
    header = ("/* Easel 聊天界面 CSS（1:1 视觉复刻，作用域 .easel-shell）\n"
              "来源：Easel dev_pi/web/frontend/src/styles（Apache-2.0）；仅保留会话工作台所需规则。\n"
              "keyframes 已加 easel- 前缀避免与 Tailwind 撞名。 */\n\n")
    # 本项目补丁（Easel 原版没有的少量控件）
    patch = """
/* ---- 本项目补丁（Easel 原版没有的少量控件） ---- */
.easel-shell .session-item { position: relative; }
.easel-shell .session-item-time {
  margin-left: auto; font-size: 10px; color: var(--text-tertiary); flex: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 64px; text-align: right;
}
.easel-shell .session-item:hover .session-item-time { visibility: hidden; }
.easel-shell .sidebar-empty { padding: 10px 6px; font-size: 12px; color: var(--text-tertiary); }
.easel-shell .sidebar-status-post {
  margin-left: 8px; font-size: 10px; color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; display: inline-block; vertical-align: middle;
}
/* 产物出稿卡（Easel card 语言里的发布流专用） */
.easel-shell .artifact-card {
  background: var(--bg-elevated, #fff); border: 1px solid var(--border, rgba(0,0,0,.08));
  border-radius: var(--radius-lg, 14px); padding: 14px 16px; margin-top: 14px;
  box-shadow: 0 3px 14px rgba(23,25,28,.06); display: grid; gap: 10px; width: 100%;
  animation: easel-fadeIn 0.24s var(--ease);
}
.easel-shell .artifact-title { font-size: 14px; font-weight: 650; color: var(--text); display: flex; align-items: center; gap: 8px; }
.easel-shell .artifact-note { font-size: 12px; color: var(--text-secondary); }
.easel-shell .artifact-item {
  border: 1px solid var(--border, rgba(0,0,0,.08)); border-radius: var(--radius, 10px);
  padding: 10px 12px; display: grid; gap: 6px; background: var(--bg, #fff);
}
.easel-shell .artifact-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.easel-shell .artifact-tags { font-size: 11px; color: var(--accent-end, #3f56a8); }
.easel-shell .artifact-body { font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.easel-shell .artifact-media { font-size: 11px; color: var(--text-tertiary); }
.easel-shell .artifact-actions { display: flex; align-items: center; gap: 8px; }
.easel-shell .artifact-state { font-size: 12px; }
.easel-shell .artifact-state.ok { color: var(--green); }
.easel-shell .artifact-state.warn { color: var(--amber); }
.easel-shell .artifact-state.err { color: var(--red); }
.easel-shell .composer-skill-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; font-size: 12px;
  border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: var(--text-secondary);
  cursor: pointer; transition: border-color var(--t-fast), color var(--t-fast);
}
.easel-shell .composer-skill-chip:hover { border-color: var(--accent-start); color: var(--text); }
"""
    open(OUT, "w").write(header + text + patch)
    print(f"wrote {OUT} ({len(text.splitlines())} lines, {len(chunks)} rules)")

if __name__ == "__main__":
    main()
