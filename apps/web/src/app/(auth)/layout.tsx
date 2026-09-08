/**
 * Auth layout for unauthenticated routes (login, MFA, password reset, OAuth
 * callback). Centers the content on a light slate background and uses the
 * full viewport. The login page itself overrides this with a split-screen.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-foreground">{children}</div>;
}
