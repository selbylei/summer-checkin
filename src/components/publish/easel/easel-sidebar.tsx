// Easel 1:1 复刻：侧栏（搬自 Easel web/frontend/src/components/Sidebar.tsx，Apache-2.0）。
// 适配：会话=该 Post 的聊天记录（worker meta.json）；保留 Easel 视觉（logo 行/「对话」区/纪录项 hover 动作/状态脚）。
// 拍板（2026-10-14 grill）：同一内容复用一个会话——无「新对话」入口、标题=内容名（不可改名）；
// hover 动作=重置会话（pi 上下文推倒重来）+ 删除（清历史纪录用）。
"use client";

import { IconRefresh, IconTrash } from "./easel-icons";
import { EaselThemeToggle } from "./easel-theme";
import type { EaselChatRecord } from "./easel-data";

function relTime(ms: number): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return `${Math.floor(d / 86_400_000)} 天前`;
}

interface Props {
  theme: "light" | "dark";
  onThemeToggle: () => void;
  /** worker 在线状态（决定状态脚文案） */
  workerOnline: boolean;
  postTitle: string;
  sessions: EaselChatRecord[];
  activeSessionId: string | null;
  onSessionSelect: (id: string) => void;
  onSessionReset: (id: string) => void;
  onSessionDelete: (id: string) => void;
}

export function EaselSidebar({
  theme,
  onThemeToggle,
  workerOnline,
  postTitle,
  sessions,
  activeSessionId,
  onSessionSelect,
  onSessionReset,
  onSessionDelete,
}: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img className="sidebar-logo-icon" src="/static/easel-icon-transparent.png" alt="" />
          <h1>Summer</h1>
          <EaselThemeToggle theme={theme} onToggle={onThemeToggle} />
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span className="sidebar-section-title">对话</span>
        </div>
        {sessions.map((s) => (
          <div
            key={s.chatId}
            className={`session-item ${s.chatId === activeSessionId ? "active" : ""}`}
            onClick={() => onSessionSelect(s.chatId)}
          >
            <span className="session-item-title">{s.title || s.chatId}</span>
            <span className="session-item-time" title={relTime(s.mtimeMs)}>{relTime(s.mtimeMs)}</span>
            <div className="session-actions">
              <button className="session-act" title="重置会话（清空上下文与出稿）"
                onClick={(e) => { e.stopPropagation(); onSessionReset(s.chatId); }}><IconRefresh size={14} /></button>
              <button className="session-act danger" title="删除"
                onClick={(e) => { e.stopPropagation(); onSessionDelete(s.chatId); }}><IconTrash size={14} /></button>
            </div>
          </div>
        ))}
        {sessions.length === 0 && <p className="sidebar-empty">还没有对话，发一条消息即建会话</p>}
      </div>

      <div className="sidebar-status">
        <span className={`status-dot ${workerOnline ? "" : "offline"}`} />
        {workerOnline ? "已连接" : "worker 离线"}
        <span className="sidebar-status-post" title={postTitle}>{postTitle}</span>
      </div>
    </div>
  );
}
