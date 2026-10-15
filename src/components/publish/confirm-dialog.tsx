"use client";

// 自定义确认弹框（2026-10-15 拍板：替换系统 window.confirm，统一用于删除/重置类破坏性操作）。
// 用法：父组件持 state（{title, body, confirmLabel, onConfirm, danger?}）→ 传 children 渲染 <ConfirmDialog/>；
// 未打开（state=null）时不渲染。
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export interface ConfirmState {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{state.title}</h3>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground transition hover:text-foreground"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        {state.body ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{state.body}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={state.danger ? "destructive" : "default"}
            size="sm"
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            {state.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
