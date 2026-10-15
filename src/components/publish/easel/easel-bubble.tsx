// Easel 1:1 复刻：消息气泡（搬自 Easel web/frontend/src/components/MessageBubble.tsx，Apache-2.0）。
// 适配：worker 同步等待（无 SSE 流式）→ pending 态用 Easel 同款 typing dots + live-activity 脉冲；
// markdown 走项目既有 MarkdownRenderer（Easel 气泡 CSS 生效），复制动作保留，重试去掉（同步模式不适用）。
"use client";

import { useMemo, useState } from "react";
import { MarkdownRenderer } from "@/components/ai/markdown-renderer";
import { IconCheck, IconCopy } from "./easel-icons";

function ActionBar({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="msg-actions">
      <button className="msg-action" onClick={copy} title="复制">
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
      {onRetry && (
        <button className="msg-action" onClick={onRetry} title="重新生成">
          <span>重试</span>
        </button>
      )}
    </div>
  );
}

export function EaselBubble({
  role,
  content,
  pending,
  onRetry,
}: {
  role: "user" | "assistant";
  content: string;
  /** 该 assistant 消息还在等 worker 回 */
  pending?: boolean;
  onRetry?: () => void;
}) {
  const html = useMemo(() => (role === "assistant" ? content : ""), [role, content]);

  if (role === "user") {
    if (!content.trim()) return null;
    return (
      <div className="message-row user">
        <div className="msg-col user">
          <div className="message-bubble user">{content}</div>
        </div>
      </div>
    );
  }

  // 等待中（还没有正文）：typing dots
  if (pending && !content) {
    return (
      <div className="message-row assistant">
        <div className="message-bubble assistant">
          <div className="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-row assistant">
      <div className="msg-col assistant">
        <div className="message-bubble assistant">
          {pending ? (
            <div className="live-panel">
              <div className="live-activity">
                <span className="live-pulse" />
                agent 按技能流程生成中（约 30-180 秒）…
              </div>
            </div>
          ) : null}
          {content ? <MarkdownRenderer content={content} /> : null}
        </div>
        {!pending && onRetry && <ActionBar text={content} onRetry={onRetry} />}
      </div>
    </div>
  );
}
