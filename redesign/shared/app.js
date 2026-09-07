/* ============================================================
   CivitasOne — Shell renderer v2.0
   Usage: <body data-active="students"> … include this script.
   Page must contain: .sidebar[data-shell=sidebar],
   .topbar[data-shell=topbar] inside .shell markup.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Icon set (lucide-style, stroke) ---------- */
  const I = (paths, vb) =>
    `<svg viewBox="${vb || '0 0 24 24'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const icons = {
    home: I(
      '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    ),
    building: I(
      '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>',
    ),
    calendar: I(
      '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    ),
    gradcap: I('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'),
    briefcase: I(
      '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    ),
    clipboard: I(
      '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
    ),
    checkcircle: I(
      '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    ),
    filetext: I(
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    ),
    award: I('<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>'),
    heart: I(
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    ),
    gitbranch: I(
      '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    ),
    database: I(
      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    ),
    barchart: I(
      '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    ),
    settings: I(
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    ),
    search: I('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    bell: I(
      '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    ),
    help: I(
      '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    ),
    moon: I('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    menu: I(
      '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
    ),
    plus: I('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    upload: I(
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    ),
    download: I(
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    ),
    edit: I('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'),
    eye: I(
      '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    ),
    trash: I(
      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    ),
    more: I(
      '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
    ),
    chevdown: I('<path d="m6 9 6 6 6-6"/>'),
    chevright: I('<path d="m9 18 6-6-6-6"/>'),
    chevleft: I('<path d="m15 18-6-6 6-6"/>'),
    chevsort: I('<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>'),
    x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    filter: I('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'),
    trendup: I(
      '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    ),
    user: I('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    users: I(
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    ),
    logout: I(
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    ),
    school: I(
      '<path d="m4 6 8-4 8 4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M14 22v-4a2 2 0 0 0-4 0v4"/><path d="M18 5v17M6 5v17"/><circle cx="12" cy="9" r="2"/>',
    ),
    sparkles: I(
      '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    ),
    arrowleft: I('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
    check: I('<polyline points="20 6 9 17 4 12"/>'),
    alert: I(
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    ),
    info: I(
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    ),
    clock: I('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    mapview: I(
      '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
    ),
    layers: I(
      '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    ),
    shield: I('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>'),
    key: I(
      '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    ),
    grid: I(
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    ),
    bus: I(
      '<path d="M8 6v6M16 6v6M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
    ),
    survey: I(
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/>',
    ),
  };

  /* ---------- Navigation config ---------- */
  const NAV = [
    {
      label: 'Overview',
      items: [
        { id: 'dashboard', icon: 'home', text: 'Dashboard', href: 'dashboard-overview.html' },
      ],
    },
    {
      label: 'People',
      items: [
        { id: 'students', icon: 'gradcap', text: 'Students', href: 'students-list.html' },
        { id: 'staff', icon: 'briefcase', text: 'Staff', href: 'staff-list.html' },
      ],
    },
    {
      label: 'Academics',
      items: [
        {
          id: 'institutions',
          icon: 'school',
          text: 'Institutions',
          href: 'institutions-list.html',
        },
        {
          id: 'academic-periods',
          icon: 'calendar',
          text: 'Academic Periods',
          href: 'academic-periods-list.html',
        },
        { id: 'attendance', icon: 'checkcircle', text: 'Attendance', href: 'attendance-mark.html' },
        {
          id: 'assessments',
          icon: 'clipboard',
          text: 'Assessments',
          href: 'assessments-list.html',
        },
        {
          id: 'examinations',
          icon: 'filetext',
          text: 'Examinations',
          href: 'examinations-list.html',
        },
      ],
    },
    {
      label: 'Services',
      items: [
        { id: 'scholarships', icon: 'award', text: 'Scholarships', href: 'scholarships-list.html' },
        { id: 'health', icon: 'heart', text: 'Health & Wellness', href: 'health-list.html' },
        {
          id: 'notifications',
          icon: 'bell',
          text: 'Notifications',
          href: 'notifications-center.html',
        },
        { id: 'transport', icon: 'bus', text: 'Transport', href: 'transport-overview.html' },
        {
          id: 'communication',
          icon: 'megaphone',
          text: 'Communication',
          href: 'communication-overview.html',
        },
        { id: 'hostel', icon: 'home', text: 'Hostel', href: 'hostel-overview.html' },
        { id: 'library', icon: 'book', text: 'Library', href: 'library-overview.html' },
        {
          id: 'workflows',
          icon: 'gitbranch',
          text: 'Workflows',
          href: 'workflows-list.html',
          badge: '4',
        },
      ],
    },
    {
      label: 'Insights',
      items: [
        { id: 'reports', icon: 'barchart', text: 'Reports', href: 'reports-list.html' },
        { id: 'surveys', icon: 'survey', text: 'Surveys', href: 'surveys-list.html' },
        {
          id: 'data-warehouse',
          icon: 'database',
          text: 'Data Warehouse',
          href: 'data-warehouse-overview.html',
        },
      ],
    },
    {
      label: 'System',
      items: [
        { id: 'admin', icon: 'settings', text: 'Administration', href: 'admin-overview.html' },
      ],
    },
  ];

  const BOTTOM_NAV = [
    { id: 'dashboard', icon: 'home', text: 'Home', href: 'dashboard-overview.html' },
    { id: 'students', icon: 'gradcap', text: 'Students', href: 'students-list.html' },
    { id: 'attendance', icon: 'checkcircle', text: 'Attendance', href: 'attendance-mark.html' },
    { id: 'workflows', icon: 'gitbranch', text: 'Approvals', href: 'workflows-approvals.html' },
    { id: 'menu', icon: 'menu', text: 'Menu', href: '#menu' },
  ];

  const active = document.body.dataset.active || '';

  /* ---------- Sidebar ---------- */
  const sidebar = document.querySelector('[data-shell="sidebar"]');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <div class="logo-mark">C</div>
        <div class="logo-name">Civitas<span>One</span></div>
      </div>
      <button class="sidebar-tenant" type="button" aria-label="Switch institution">
        <span class="t-icon">GV</span>
        <span class="t-meta">
          <span class="t-name">Govt. Sr. Sec. School, Puri</span>
          <span class="t-role">District: Puri · Odisha</span>
        </span>
        ${icons.chevdown}
      </button>
      <nav class="sidebar-nav" aria-label="Primary">
        ${NAV.map(
          (g) => `
          <div class="nav-group">
            <div class="nav-group-label">${g.label}</div>
            ${g.items
              .map(
                (it) => `
              <a class="nav-item${it.id === active ? ' active' : ''}" href="${it.href}" ${it.id === active ? 'aria-current="page"' : ''}>
                ${icons[it.icon]}<span>${it.text}</span>${it.badge ? `<span class="nav-badge">${it.badge}</span>` : ''}
              </a>`,
              )
              .join('')}
          </div>`,
        ).join('')}
      </nav>
      <div class="sidebar-footer">
        <a class="nav-item" href="#help">${icons.help}<span>Help &amp; Support</span></a>
      </div>`;
  }

  /* ---------- Topbar ---------- */
  const topbar = document.querySelector('[data-shell="topbar"]');
  if (topbar) {
    topbar.innerHTML = `
      <button class="icon-btn hamburger" type="button" aria-label="Open menu">${icons.menu}</button>
      <button class="global-search" type="button" aria-label="Search (Ctrl+K)">
        ${icons.search}<span>Search students, staff, schools…</span><span class="kbd">⌘K</span>
      </button>
      <div class="topbar-right">
        <button class="icon-btn hide-mobile" type="button" aria-label="Toggle theme" data-theme-toggle>${icons.moon}</button>
        <button class="icon-btn" type="button" aria-label="Notifications">${icons.bell}<span class="dot"></span></button>
        <button class="icon-btn hide-mobile" type="button" aria-label="Help">${icons.help}</button>
        <div class="topbar-divider"></div>
        <button class="user-chip" type="button">
          <span class="avatar av-1">DN</span>
          <span class="u-meta"><span class="u-name">D. Nayak</span><br><span class="u-role">District Administrator</span></span>
          <span class="hide-mobile" style="color:var(--text-3)">${icons.chevdown}</span>
        </button>
      </div>`;
  }

  /* ---------- Mobile bottom nav ---------- */
  const bn = document.createElement('nav');
  bn.className = 'bottom-nav';
  bn.setAttribute('aria-label', 'Mobile');
  bn.innerHTML = BOTTOM_NAV.map(
    (it) =>
      `<a href="${it.href}" class="${it.id === active ? 'active' : ''}">${icons[it.icon]}<span>${it.text}</span></a>`,
  ).join('');
  document.body.appendChild(bn);

  /* ---------- Drawer (mobile sidebar) ---------- */
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  document.body.appendChild(backdrop);
  const openDrawer = () => {
    document.body.classList.add('drawer-open');
    backdrop.classList.add('open');
  };
  const closeDrawer = () => {
    document.body.classList.remove('drawer-open');
    backdrop.classList.remove('open');
  };
  document.querySelector('.hamburger')?.addEventListener('click', openDrawer);
  backdrop.addEventListener('click', closeDrawer);
  bn.querySelector('a[href="#menu"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    openDrawer();
  });

  /* ---------- Theme toggle ---------- */
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? '' : 'dark';
  });

  /* ---------- Command palette ---------- */
  const cmdk = document.createElement('div');
  cmdk.className = 'cmdk-backdrop';
  cmdk.innerHTML = `
    <div class="cmdk" role="dialog" aria-label="Command palette">
      <div class="cmdk-input">${icons.search}<input type="text" placeholder="Type a command or search…" /></div>
      <div class="cmdk-list">
        <div class="cmdk-group">Quick actions</div>
        <div class="cmdk-item">${icons.plus} Add student</div>
        <div class="cmdk-item">${icons.checkcircle} Mark today's attendance</div>
        <div class="cmdk-item">${icons.upload} Bulk import students</div>
        <div class="cmdk-group">Go to</div>
        ${NAV.flatMap((g) => g.items)
          .map(
            (it) =>
              `<div class="cmdk-item" data-href="${it.href}">${icons[it.icon]} ${it.text}</div>`,
          )
          .join('')}
      </div>
    </div>`;
  document.body.appendChild(cmdk);
  const openCmdk = () => {
    cmdk.classList.add('open');
    cmdk.querySelector('input').focus();
  };
  const closeCmdk = () => cmdk.classList.remove('open');
  document.querySelector('.global-search')?.addEventListener('click', openCmdk);
  cmdk.addEventListener('click', (e) => {
    if (e.target === cmdk) closeCmdk();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCmdk();
    }
    if (e.key === 'Escape') {
      closeCmdk();
      closeDrawer();
    }
  });
  cmdk
    .querySelectorAll('[data-href]')
    .forEach((el) => el.addEventListener('click', () => (location.href = el.dataset.href)));

  window.CivitasIcons = icons;
})();
