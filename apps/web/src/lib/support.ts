/**
 * G-924 — where "raise a ticket" goes. Deployments point this at their help
 * desk (Zendesk / Jira SM / Freshdesk …) or a support mailbox; when neither is
 * configured the page says so instead of showing a dead button.
 */
export function resolveSupportTicketHref(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const url = env['NEXT_PUBLIC_SUPPORT_TICKET_URL']?.trim();
  if (url && /^https?:\/\//i.test(url)) return url;
  const email = env['NEXT_PUBLIC_SUPPORT_EMAIL']?.trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return `mailto:${email}?subject=${encodeURIComponent('Support request')}`;
  }
  return null;
}
