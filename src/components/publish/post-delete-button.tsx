"use client";

// 内容删除（2026-10-15 拍板：发布主页每条可删除）：DELETE /api/publish/posts/:id（DB 级联 variants/job/logs）。
// 确认弹框=自定义 ConfirmDialog（拍板不用系统 window.confirm）；级联删除不可恢复。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { publishFetch } from "@/components/publish/publish-shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/publish/confirm-dialog";

export function PostDeleteButton({ postId, postTitle }: { postId: string; postTitle: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    const r = await publishFetch<{ ok?: boolean }>(`/api/publish/posts/${postId}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) {
      toast.success(`已删除「${postTitle}」`);
      router.refresh();
    } else {
      toast.error(r.error ?? "删除失败");
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() =>
          setConfirm({
            title: "删除这条内容？",
            body: `「${postTitle}」及其全部平台适配版与排期任务会一起删除，不可恢复。`,
            confirmLabel: busy ? "删除中…" : "删除",
            danger: true,
            onConfirm: () => void handleDelete(),
          })
        }
      >
        <Trash className="size-3.5" weight="bold" />
        删除
      </Button>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
