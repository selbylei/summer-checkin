"use client";

// 内容页新建表单（brief Step 2）：title/body 必填 + media 走 Task 6 media 路由。
// 上传链路：POST /posts（先建内容拿到 postId）→ 逐文件 POST /media（multipart）→
// PATCH /posts/:id 回填 mediaPaths → router.refresh() 刷新服务端列表。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Camera } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { publishFetch } from "./publish-shared";

export function PostForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(""); // 上传进度提示（媒体 n/m）
  const [fieldError, setFieldError] = useState("");

  async function handleFiles(fileList: FileList | null) {
    setFiles(fileList ? Array.from(fileList) : []);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFieldError("");
    if (!title.trim() || !body.trim()) {
      setFieldError("标题与正文必填（口径同 API：400 title/body 必填）");
      return;
    }
    setBusy(true);
    try {
      // 1) 建内容中枢 Post
      const created = await publishFetch<{ id: string }>("/api/publish/posts", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (!created.ok) {
        setFieldError(created.error);
        return;
      }
      // 2) 媒体逐文件上传（multipart：postId + file，浏览器自动带登录 cookie）
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`正在上传媒体 ${i + 1}/${files.length}`);
        const form = new FormData();
        form.append("postId", created.data!.id);
        form.append("file", files[i]);
        const up = await publishFetch<{ path: string }>("/api/publish/media", {
          method: "POST",
          body: form,
        });
        if (!up.ok) {
          setFieldError(`媒体「${files[i].name}」上传失败：${up.error}`);
          return;
        }
        paths.push(up.data!.path);
      }
      // 3) 回填 mediaPaths（无媒体则跳过；服务端媒体数上限校验由适配页 format-check 负责）
      if (paths.length > 0) {
        const patched = await publishFetch(`/api/publish/posts/${created.data!.id}`, {
          method: "PATCH",
          body: JSON.stringify({ mediaPaths: paths }),
        });
        if (!patched.ok) {
          setFieldError(patched.error);
          return;
        }
      }
      toast.success(paths.length ? "内容已创建，媒体已上传" : "内容已创建");
      setTitle("");
      setBody("");
      setFiles([]);
      router.refresh();
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="product-row flex flex-col gap-3 rounded-lg border border-white/9 bg-[var(--surface-panel-bg)] p-5 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Plus className="size-4 text-primary" weight="bold" />
        新建内容
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="post-title" className="text-xs text-muted-foreground">标题</Label>
          <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话说清楚这篇内容" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="post-media" className="text-xs text-muted-foreground">
            媒体（可选，小红书图文上限 9 张）
          </Label>
          <div className="flex h-8 items-center gap-2 rounded-md border border-dashed border-white/16 px-2.5">
            <Camera className="size-4 text-muted-foreground" weight="duotone" />
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => void handleFiles(e.target.files)}
              className="min-w-0 flex-1 text-xs text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-primary file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/80"
            />
            <span className="text-[11px] tabular-nums text-muted-foreground">{files.length > 0 ? `${files.length} 个` : ""}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="post-body" className="text-xs text-muted-foreground">正文</Label>
        <Textarea
          id="post-body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="正文一次写全，适配页再按平台微调（抖音正文上限 55 字）"
        />
      </div>
      {fieldError && <p className="text-xs leading-5 text-red-400">{fieldError}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "创建中..." : "创建内容"}
        </Button>
        {progress && <span className="text-[11px] tabular-nums text-muted-foreground">{progress}</span>}
      </div>
    </form>
  );
}
