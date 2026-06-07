'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: '📊' },
  { label: 'API Keys', href: '/dashboard/api-keys', icon: '🔑' },
  { label: 'Plugins', href: '/dashboard/plugins', icon: '🧩' },
  { label: 'Marketplace', href: '/marketplace', icon: '🏪' },
  { label: 'Documentation', href: '/docs', icon: '📖' },
  { label: 'Webhooks', href: '/dashboard/webhooks', icon: '🔔' },
  { label: 'Sandbox', href: '/dashboard/sandbox', icon: '🧪' },
];

/**
 * Sidebar navigation for the developer portal dashboard.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white" role="navigation" aria-label="Main navigation">
      <div className="flex h-16 items-center border-b border-gray-200 px-6">
        <Link href="/" className="text-lg font-bold text-primary-700">
          ProctiraERP Dev
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="text-base" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
