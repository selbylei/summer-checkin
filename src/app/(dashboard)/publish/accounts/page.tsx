// 账号页（brief Step 5）：AccountProfile 表单（P1 只存不消费）+ 每平台扫码登录，交互在 AccountsPanel。
import { requireAuth } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { AccountsPanel } from "@/components/publish/accounts-panel";
import type { AccountProfileDto } from "@/components/publish/publish-shared";

export default async function PublishAccountsPage() {
  const user = await requireAuth();
  const profiles = await prisma.accountProfile.findMany({ where: { userId: user.id } });

  const serialized: AccountProfileDto[] = profiles.map((p) => ({
    id: p.id,
    platform: p.platform,
    handle: p.handle,
    positioning: p.positioning,
    style: p.style,
    tone: p.tone,
    constraints: p.constraints,
  }));

  return (
    <div className="product-page product-page--redesigned">
      <header className="product-header">
        <div>
          <p className="product-eyebrow">Accounts</p>
          <h1 className="product-title">账号</h1>
          <p className="product-subtitle">各平台账号画像（P1 只存不消费）与扫码登录。</p>
        </div>
      </header>
      <div className="mt-8">
        <AccountsPanel profiles={serialized} />
      </div>
    </div>
  );
}
