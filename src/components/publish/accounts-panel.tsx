"use client";

// 账号页（brief Step 5）：AccountProfile 表单（P1 只存不消费，保存走 POST /accounts）+
// 每平台「扫码登录」：GET /login 触发 worker 后台登录 → 展示 /api/publish/qrcode 二维码 img
// → 3s 轮询 GET /login-status，直到 success/error（worker 未启动→502 文案；过期→提示重扫）。
// GZH 扫码登录禁用（与适配页同口径：未接入，P2 官方 API；API 侧 worker 返 501，UI 不发起）。
import { useEffect, useRef, useState } from "react";
import { QrCode, Scan } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  LIVE_PLATFORMS,
  PLATFORMS,
  PLATFORM_LABEL,
  LOGIN_PLATFORM,
  publishFetch,
  type AccountProfileDto,
  type Platform,
} from "./publish-shared";

type LoginState =
  | { kind: "idle" }
  // starting：登录进行中；qrReady=true 时二维码 PNG 已落盘（img 才渲染，404 兜底前不展示裂图）
  | { kind: "starting"; message: string; qrReady: boolean }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const GZH_HINT = "未接入（P2 官方 API）";

const FIELDS = [
  { key: "handle", label: "账号（handle）" },
  { key: "positioning", label: "定位" },
  { key: "style", label: "内容风格" },
  { key: "tone", label: "语气" },
] as const;

export function AccountsPanel({ profiles }: { profiles: AccountProfileDto[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {PLATFORMS.map((platform) => {
        const profile = profiles.find((p) => p.platform === platform) ?? null;
        return <PlatformAccountCard key={platform} platform={platform} profile={profile} />;
      })}
    </div>
  );
}

function PlatformAccountCard({
  platform,
  profile,
}: {
  platform: Platform;
  profile: AccountProfileDto | null;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    handle: profile?.handle ?? "",
    positioning: profile?.positioning ?? "",
    style: profile?.style ?? "",
    tone: profile?.tone ?? "",
    constraints: profile?.constraints ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [login, setLogin] = useState<LoginState>({ kind: "idle" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // 轮询卸载清理（防卸载后 setState / 定时器泄漏）
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const r = await publishFetch("/api/publish/accounts", {
        method: "POST",
        body: JSON.stringify({
          platform,
          handle: values.handle.trim(),
          positioning: values.positioning.trim(),
          style: values.style.trim(),
          tone: values.tone.trim(),
          ...(values.constraints.trim() ? { constraints: values.constraints.trim() } : {}),
        }),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${PLATFORM_LABEL[platform]} 账号画像已保存（P1 只存不消费）`);
    } finally {
      setSaving(false);
    }
  }

  function pollStatus(p: Platform) {
    const tick = async () => {
      const r = await publishFetch<{ state?: string; status?: string; message?: string }>(
        `/api/publish/login-status?platform=${LOGIN_PLATFORM[p]}`
      );
      if (unmountedRef.current) return;
      if (!r.ok) {
        // worker 未启动等网络/502：停轮询，提示可重试
        setLogin({ kind: "error", message: r.error });
        return;
      }
      const data = r.data ?? {};
      // 文件不存在→{status:"pending"}；存在→Easel login_state {state,message}
      const state = data.state ?? data.status;
      if (state === "success") {
        setLogin({ kind: "success", message: data.message || "登录成功" });
        toast.success(`${PLATFORM_LABEL[p]} 登录成功`);
        return;
      }
      if (state === "error" || state === "expired") {
        setLogin({
          kind: "error",
          message: state === "expired" ? "二维码超时未扫，请重新点登录" : data.message || "登录失败",
        });
        return;
      }
      setLogin({
        kind: "starting",
        message: state === "qr_ready" ? "二维码已就绪，请扫码" : "正在启动扫码登录…",
        qrReady: state === "qr_ready",
      });
      timerRef.current = setTimeout(() => void tick(), 3000);
    };
    void tick();
  }

  async function handleScanLogin() {
    if (login.kind === "starting") return;
    setLogin({ kind: "starting", message: "正在启动扫码登录…", qrReady: false });
    const r = await publishFetch<{ ok?: boolean; qrPath?: string }>(
      `/api/publish/login?platform=${LOGIN_PLATFORM[platform]}`
    );
    if (unmountedRef.current) return;
    if (!r.ok) {
      setLogin({ kind: "error", message: r.error });
      return;
    }
    pollStatus(platform);
  }

  const live = LIVE_PLATFORMS.includes(platform);

  return (
    <article
      aria-label={`${PLATFORM_LABEL[platform]} 账号`}
      className="flex flex-col gap-3 rounded-lg border border-white/9 bg-[var(--surface-panel-bg)] p-4 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{PLATFORM_LABEL[platform]}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleScanLogin()}
          disabled={!live || login.kind === "starting"}
          title={live ? undefined : GZH_HINT}
        >
          <Scan className="size-3.5" />
          扫码登录
        </Button>
      </div>

      {live && login.kind !== "idle" && (
        <div className="flex flex-col gap-2">
          {login.kind === "starting" && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-white/10 bg-black/15 px-3 py-4">
              {login.qrReady && (
                <img
                  src={`/api/publish/qrcode?platform=${LOGIN_PLATFORM[platform]}`}
                  alt={`${PLATFORM_LABEL[platform]} 扫码登录二维码`}
                  width={180}
                  height={180}
                  className="rounded-lg bg-white object-contain p-1.5"
                />
              )}
              <p className="text-xs text-muted-foreground">{login.message}</p>
            </div>
          )}
          {login.kind === "success" && (
            <p className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 text-xs text-emerald-400">{login.message}</p>
          )}
          {login.kind === "error" && (
            <div className="flex flex-col gap-1.5 rounded-md border border-red-400/25 bg-red-400/5 px-2.5 py-2" role="alert">
              <p className="text-xs leading-5 text-red-400">{login.message}</p>
              <Button variant="ghost" size="xs" onClick={() => { setLogin({ kind: "idle" }); void handleScanLogin(); }}>
                重新登录
              </Button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="flex flex-1 flex-col gap-2.5 border-t border-white/8 pt-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`acc-${platform}-${f.key}`} className="text-[11px] text-muted-foreground">{f.label}</Label>
            <Input
              id={`acc-${platform}-${f.key}`}
              value={values[f.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`acc-${platform}-constraints`} className="text-[11px] text-muted-foreground">约束（可选）</Label>
          <Textarea
            id={`acc-${platform}-constraints`}
            rows={2}
            value={values.constraints}
            onChange={(e) => setValues((prev) => ({ ...prev, constraints: e.target.value }))}
          />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <QrCode className="size-3.5" weight="duotone" aria-hidden />
            {live ? "P1 只存不消费，P2 起填入 pi 会话" : GZH_HINT}
          </span>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={
              saving ||
              !values.handle.trim() ||
              !values.positioning.trim() ||
              !values.style.trim() ||
              !values.tone.trim()
            }
          >
            {saving ? "保存中..." : "保存画像"}
          </Button>
        </div>
      </form>
    </article>
  );
}
