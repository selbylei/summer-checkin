"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RocketLaunch } from "@phosphor-icons/react";
import { MarkdownStudio } from "@/components/studio/markdown-studio";

interface DocStudioClientProps {
  docId: string;
  title: string;
  initialContent: string;
  /** 只读：不可编辑、不可重命名。知识库文档用它（改了会与已切好的分片对不上），文档区不用 */
  readOnly?: boolean;
  /**
   * 是否开放 AI 面板。缺省跟随 readOnly（只读则不开）。
   * 之所以单独留一个开关：「能不能改」和「能不能用 AI」本是两件事，
   * 之前把 AI 绑死在 readOnly 上，导致文档一旦只读就连 AI 一起没了。
   */
  enableAi?: boolean;
  backHref?: string;
  backLabel?: string;
  backNavigation?: "push" | "replace";
}

export function DocStudioClient({
  docId,
  title: initialTitle,
  initialContent,
  readOnly = false,
  enableAi,
  backHref = "/docs",
  backLabel = "返回文档列表",
  backNavigation = "push",
}: DocStudioClientProps) {
  const [title, setTitle] = useState(initialTitle);
  const aiEnabled = enableAi ?? !readOnly;

  const handleSave = useCallback(
    async (content: string) => {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("保存失败");
    },
    [docId]
  );

  const handleRename = useCallback(
    async (nextTitle: string) => {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      if (!res.ok) throw new Error("重命名失败");
      setTitle(nextTitle);
      toast.success("已重命名");
    },
    [docId]
  );

  // 发布为内容（Easel 对齐批次②：阅读→发布）：导入到发布内容中枢，后续在 /publish 适配发布
  const [publishing, setPublishing] = useState(false);
  const handlePublishAsContent = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/publish/posts/from-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[]; post?: { title: string } };
      if (!res.ok) {
        toast.error(data.errors?.[0] ?? data.error ?? "导入发布内容失败");
        return;
      }
      toast.success(`「${data.post?.title ?? title}」已导入发布内容，去 /publish 适配并批准发布`);
    } finally {
      setPublishing(false);
    }
  }, [docId, title, publishing]);

  const fetchLatest = useCallback(async () => {
    const res = await fetch(`/api/documents/${docId}`);
    if (!res.ok) throw new Error("拉取文档失败");
    const data = (await res.json()) as {
      document?: { content?: string };
    };
    return data.document?.content ?? "";
  }, [docId]);

  return (
    // 全屏覆盖（z-50 盖住 TopNav 与雨林球），上下 100% 占满
    <div className="fixed inset-0 z-50">
      <MarkdownStudio
        document={{ id: docId, title, content: initialContent }}
        onSave={handleSave}
        onRename={readOnly ? undefined : handleRename}
        backHref={backHref}
        backLabel={backLabel}
        backNavigation={backNavigation}
        actions={
          <button
            type="button"
            onClick={() => void handlePublishAsContent()}
            disabled={publishing}
            title="将本文档导入发布内容中枢（/publish），后续在 /publish 适配并批准发布"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            <RocketLaunch className="size-3.5" weight="fill" />
            {publishing ? "导入中…" : "发布为内容"}
          </button>
        }
        ai={
          aiEnabled
            ? {
                context: { kind: "doc", refId: docId },
                fetchLatest,
              }
            : undefined
        }
        readOnly={readOnly}
        // 进入文档工作台直接是专注阅读模式；想对照编辑时点顶栏"专注阅读"切换
        defaultMode="focus"
      />
    </div>
  );
}
