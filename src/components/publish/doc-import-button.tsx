"use client";

// 内容页「阅读导入」：/docs 文档工作台 → 一键导入为发布内容（Easel 无此概念，本项目扩展）。
// GET /api/publish/docs 列文档；选中 → POST /api/publish/posts/from-doc → router.refresh。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { publishFetch } from "@/components/publish/publish-shared";

interface DocOption {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
}

export function DocImportButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState("");
  const reqSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    void publishFetch<{ docs: DocOption[] }>("/api/publish/docs").then((r) => {
      if (seq !== reqSeq.current) return;
      setLoading(false);
      if (r.ok) setDocs(r.data?.docs ?? []);
      else toast.error(r.error || "读取阅读列表失败");
    });
  }, [open]);

  async function importDoc(doc: DocOption) {
    setImporting(doc.id);
    const r = await publishFetch<{ post?: { id: string; title: string } }>(
      "/api/publish/posts/from-doc",
      { method: "POST", body: JSON.stringify({ documentId: doc.id }) }
    );
    setImporting("");
    if (!r.ok) {
      toast.error(r.error || "导入失败");
      return;
    }
    toast.success(`已导入「${doc.title}」为发布内容`);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
        <BookOpen className="h-4 w-4" weight="duotone" />
        阅读导入
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-96 rounded-lg border border-white/10 bg-[var(--surface-panel-bg)] p-3 shadow-xl backdrop-blur-xl">
          <p className="mb-2 text-xs font-medium text-foreground/80">从阅读（文档工作台）导入为发布内容</p>
          {loading && <p className="px-1 py-4 text-center text-xs text-muted-foreground">加载中…</p>}
          {!loading && docs.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">还没有文档</p>
          )}
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto">
            {docs.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => void importDoc(d)}
                  disabled={importing !== ""}
                  className="w-full rounded-md border border-white/8 bg-black/10 px-3 py-2 text-left transition hover:bg-white/5 disabled:opacity-50"
                >
                  <p className="truncate text-xs font-medium text-foreground">{d.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{d.preview}</p>
                </button>
              </li>
            ))}
          </ul>
          {importing !== "" && (
            <p className="mt-2 text-center text-[11px] text-primary">导入中…</p>
          )}
        </div>
      )}
    </div>
  );
}
