/** Auth layout — full-bleed branded panel for /login. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-secondary text-foreground">{children}</div>;
}
