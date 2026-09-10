import {
  Building2,
  CreditCard,
  Globe,
  KeyRound,
  ScrollText,
  ShieldCheck,
  UserCircle,
  type LucideIcon,
} from 'lucide-react';

export interface AdminSection {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  iconClass: string;
}

/** Tenant-scoped administration destinations. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    href: '/admin/users',
    title: 'Users',
    description:
      'Invite staff, manage account status, reset MFA, and assign roles across institutions.',
    icon: UserCircle,
    iconClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  {
    href: '/admin/roles',
    title: 'Roles',
    description:
      'Bundle permissions into named roles like Headmaster or Clerk, then assign them to users.',
    icon: ShieldCheck,
    iconClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  },
  {
    href: '/admin/permissions',
    title: 'Permissions',
    description:
      'Inspect granular permissions across modules and review role coverage in the matrix.',
    icon: KeyRound,
    iconClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  },
  {
    href: '/admin/tenant',
    title: 'Tenant',
    description:
      'Institution identity, district mapping, academic year defaults, locale, timezone, and branding.',
    icon: Building2,
    iconClass: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  },
];

/**
 * Platform-scoped surfaces (G-727). Every admin can open them; the gateway
 * returns 403 on the data request unless the caller holds the `platform`
 * resource, and the pages render that state explicitly.
 */
export const PLATFORM_SECTIONS: readonly AdminSection[] = [
  {
    href: '/billing',
    title: 'Billing',
    description: 'Subscription plans, quotas and the feature entitlements the gateway enforces.',
    icon: CreditCard,
    iconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  },
  {
    href: '/audit-logs',
    title: 'Audit logs',
    description: 'Immutable who-changed-what trail with entity, actor, operation and date filters.',
    icon: ScrollText,
    iconClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  {
    href: '/tenant-lifecycle',
    title: 'Tenant lifecycle',
    description: 'Provisioning, suspension and decommission state across tenants and regions.',
    icon: Globe,
    iconClass: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  },
];
