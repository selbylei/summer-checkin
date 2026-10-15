// Easel 1:1 复刻：笔入口（搬自 Easel web/frontend/src/components/BrushEntry.tsx，Apache-2.0）。
// 适配：能力菜单数据=Easel 113 项静态库 → 我们的 5 个工作流技能（layer 分组 tabs + 搜索）；
// 选中=定该纪录工作流 + 预填输入框（Easel 原行为：选中即预填，不自动发送）。
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch } from "./easel-icons";
import type { SkillInfo } from "./easel-data";

const LAYER_LABEL: Record<string, string> = {
  produce: "制作",
  publish: "发布",
  strategy: "策划",
  discovery: "发现",
  attribution: "归因",
};

export function EaselBrush({
  skills,
  onPick,
}: {
  skills: SkillInfo[];
  onPick: (skill: SkillInfo, prefillText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 技能按 layer 分组成 tabs（Easel tabs 同构）
  const tabs = useMemo(() => {
    const groups = new Map<string, SkillInfo[]>();
    for (const s of skills) {
      const k = (LAYER_LABEL[s.layer] ?? s.layer) || "技能";
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [skills]);

  const ql = q.trim().toLowerCase();
  const hit = (s: SkillInfo) => !ql || `${s.name}${s.short || s.description}${s.slug}`.toLowerCase().includes(ql);

  const pick = (s: SkillInfo) => {
    onPick(s, `帮我按「${s.name}」出稿`);
    setOpen(false);
  };

  return (
    <div className={`brush-entry${open ? " open" : ""}`} ref={wrapRef}>
      <button type="button" className="brush-btn" onClick={() => setOpen((v) => !v)}
        aria-label="看看能做什么" title="看看能做什么">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="sc-brushHandleGrad" x1="12" y1="1.6" x2="12" y2="11.6" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#8adfce" /><stop offset="1" stopColor="#45b0b4" />
            </linearGradient>
            <linearGradient id="sc-brushTipGrad" x1="12" y1="13.2" x2="12" y2="22.6" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#2f6fae" /><stop offset="1" stopColor="#222e83" />
            </linearGradient>
          </defs>
          <g transform="rotate(45 12 12)">
            <rect x="11.15" y="1.6" width="1.7" height="10" rx=".85" fill="url(#sc-brushHandleGrad)" />
            <rect x="10.6" y="11.5" width="2.8" height="1.75" rx=".6" fill="#b9e3d9" stroke="#7fb3aa" strokeWidth=".3" />
            <path d="M10.7 13.2 C9.95 16.6 10.2 19.9 11.95 22.6 C13.7 19.9 13.95 16.6 13.2 13.2 Z" fill="url(#sc-brushTipGrad)" />
            <path d="M11.95 13.6 L11.95 21.2" stroke="#1d2c6f" strokeWidth=".4" strokeLinecap="round" opacity=".38" />
          </g>
        </svg>
        <span className="brush-mark" aria-hidden="true" />
        <span className="brush-tip">看看能做什么</span>
      </button>

      {open && (
        <div className="brush-panel" role="dialog" aria-label="能做的都在这">
          <div className="brush-panel-head">
            <div className="brush-panel-headline">
              <div className="brush-panel-title">能做的都在这</div>
              <div className="brush-panel-sub">选一个 → 自动填进输入框；选技能 = 选工作流</div>
            </div>
            <div className="brush-search-wrap">
              <IconSearch size={13} className="brush-search-ic" />
              <input ref={searchRef} className="brush-search" placeholder="搜索…" value={q}
                onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {tabs.length > 1 && (
            <div className="brush-tabs">
              {tabs.map((t, i) => (
                <button type="button" key={t.label} className={`brush-tab${i === tab ? " on" : ""}`}
                  onClick={() => setTab(i)}>{t.label}</button>
              ))}
            </div>
          )}
          <div className="brush-body">
            {(tabs[tab]?.items ?? skills).filter(hit).map((s) => (
              <button type="button" key={s.slug} className="brush-item" onClick={() => pick(s)}>
                <span className="brush-dot s-ready" title="可用" />
                <span className="brush-il">{s.name}</span>
                <span className="brush-idesc">{s.short || s.description}</span>
                <span className="brush-iadd">＋</span>
              </button>
            ))}
            {skills.length === 0 && <div className="brush-empty">技能清单加载中…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
