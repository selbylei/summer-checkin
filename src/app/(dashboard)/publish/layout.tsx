// 发布五页的布局：(dashboard) 组布局（TopNav/鉴权/Onboarding）已在外层承载，
// 本页面群不引入额外壳——plans/stats 等现有页面同样无子布局，保持同款密度与挂载方式。
export default function PublishLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
