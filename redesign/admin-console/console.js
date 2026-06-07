/* ============================================================
   ProctiraERP — Platform Admin Console shell renderer
   Usage: <body data-active="tenants"> … include this script.
   Page must contain .sidebar[data-shell=sidebar] and
   .topbar[data-shell=topbar] inside .shell markup.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Icon set (lucide-style, stroke) ---------- */
  const I = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const icons = {
    globe: I('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    building: I('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>'),
    layers: I('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
    plug: I('<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>'),
    palette: I('<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>'),
    shieldalert: I('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
    lifebuoy: I('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/>'),
    activity: I('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    filetext: I('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
    search: I('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    bell: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    moon: I('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    menu: I('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>'),
    chevdown: I('<path d="m6 9 6 6 6-6"/>'),
    logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
    book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  };

  /* ---------- Navigation config ---------- */
  const NAV = [
    { label: 'Platform', items: [
      { id: 'overview', icon: 'globe',    text: 'Overview', href: 'overview.html' },
      { id: 'tenants',  icon: 'building', text: 'Tenants',  href: 'tenants.html' },
      { id: 'plans',    icon: 'layers',   text: 'Plans',    href: 'plans.html' },
    ]},
    { label: 'Marketplace', items: [
      { id: 'plugins', icon: 'plug',    text: 'Plugins', href: 'plugins.html', badge: '2' },
      { id: 'themes',  icon: 'palette', text: 'Themes',  href: 'themes.html' },
    ]},
    { label: 'Trust & access', items: [
      { id: 'break-glass', icon: 'shieldalert', text: 'Break-glass', href: 'break-glass.html', badge: '1' },
    ]},
    { label: 'Operations', items: [
      { id: 'support', icon: 'lifebuoy', text: 'Support',   href: 'support.html' },
      { id: 'health',  icon: 'activity', text: 'Health',    href: 'health.html' },
      { id: 'audit',   icon: 'filetext', text: 'Audit log', href: 'audit.html' },
    ]},
  ];

  const active = document.body.dataset.active || '';

  /* ---------- Sidebar ---------- */
  const sidebar = document.querySelector('[data-shell="sidebar"]');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <div class="logo-mark">P</div>
        <div class="logo-name">Proctira<span>ERP</span></div>
      </div>
      <span class="pa-badge">Platform Admin</span>
      <nav class="sidebar-nav" aria-label="Primary">
        ${NAV.map(g => `
          <div class="nav-group">
            <div class="nav-group-label">${g.label}</div>
            ${g.items.map(it => `
              <a class="nav-item${it.id === active ? ' active' : ''}" href="${it.href}" ${it.id === active ? 'aria-current="page"' : ''}>
                ${icons[it.icon]}<span>${it.text}</span>${it.badge ? `<span class="nav-badge">${it.badge}</span>` : ''}
              </a>`).join('')}
          </div>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <a class="nav-item" href="#runbooks">${icons.book}<span>Operator runbooks</span></a>
        <a class="nav-item" href="login.html">${icons.logout}<span>Sign out</span></a>
      </div>`;
  }

  /* ---------- Topbar ---------- */
  const topbar = document.querySelector('[data-shell="topbar"]');
  if (topbar) {
    topbar.innerHTML = `
      <button class="icon-btn hamburger" type="button" aria-label="Open menu">${icons.menu}</button>
      <button class="global-search" type="button" aria-label="Search">
        ${icons.search}<span>Search tenants, plugins, operators…</span><span class="kbd">⌘K</span>
      </button>
      <div class="topbar-right">
        <span class="env-pill" title="Environment"><span class="env-dot"></span>Production<span class="env-region">&nbsp;· ap-south-1</span></span>
        <button class="icon-btn hide-mobile" type="button" aria-label="Toggle theme" data-theme-toggle>${icons.moon}</button>
        <button class="icon-btn" type="button" aria-label="Notifications">${icons.bell}<span class="dot"></span></button>
        <div class="topbar-divider"></div>
        <button class="user-chip" type="button">
          <span class="avatar av-3">AK</span>
          <span class="u-meta"><span class="u-name">A. Kulkarni</span><br><span class="u-role">Platform Operator</span></span>
          <span class="hide-mobile" style="color:var(--text-3)">${icons.chevdown}</span>
        </button>
      </div>`;
  }

  /* ---------- Drawer (mobile sidebar) ---------- */
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  document.body.appendChild(backdrop);
  const openDrawer = () => { document.body.classList.add('drawer-open'); backdrop.classList.add('open'); };
  const closeDrawer = () => { document.body.classList.remove('drawer-open'); backdrop.classList.remove('open'); };
  document.querySelector('.hamburger')?.addEventListener('click', openDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  /* ---------- Theme toggle ---------- */
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? '' : 'dark';
  });

  window.ConsoleIcons = icons;
})();
