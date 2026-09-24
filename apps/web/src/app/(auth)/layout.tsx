/**
 * Auth layout for unauthenticated routes (login, MFA, password reset, OAuth
 * callback). Fills the viewport with the themed page surface. The login page
 * itself overrides this with a split-screen.
 *
 * `bg-background` rather than the `bg-slate-50` this used to hardcode. The
 * foreground was already tokenised, so in dark mode near-white text landed on a
 * fixed light panel. Reverting this line and the two `bg-white` literals it pairs
 * with makes all five anonymous auth routes fail their dark axe scan on settled
 * colours — `#e7ebf4` on `#ffffff` at **1.19:1** and `#9ca9c4` at 2.36:1, against
 * a 4.5:1 floor. Restoring them makes all five pass.
 *
 * `bg-background` is also what the other 266 surfaces in this app use; the eight
 * `bg-white` and ten `bg-slate-50` literals were the exceptions.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
