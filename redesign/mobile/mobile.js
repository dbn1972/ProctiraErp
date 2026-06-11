/* CivitasOne Mobile mockups — injects status bar + tab bar.
   <body data-tab="home|students|attendance|services|profile"> ; omit data-tab for bare screens (login etc.) */
(function () {
  'use strict';
  const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const icons = {
    home: I('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
    students: I('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>'),
    attendance: I('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
    services: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'),
    profile: I('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  };
  const TABS = [
    ['home', 'Home', 'home.html'],
    ['students', 'Students', 'students.html'],
    ['attendance', 'Attendance', 'attendance.html'],
    ['services', 'Services', 'services.html'],
    ['profile', 'Profile', 'profile.html'],
  ];
  const phone = document.querySelector('.phone');
  if (!phone) return;

  const sb = document.createElement('div');
  sb.className = 'statusbar';
  sb.innerHTML = `<span>9:41</span>
    <span class="sb-icons">
      <svg viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="7" width="3" height="5" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2.5" width="3" height="9.5" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
      <svg viewBox="0 0 17 12" fill="currentColor"><path d="M8.5 12 12 8.1a5.4 5.4 0 0 0-7 0Zm-5.6-6.3 1.8 2A8.2 8.2 0 0 1 8.5 5.6c1.4 0 2.7.6 3.8 2.1l1.8-2A11 11 0 0 0 8.5 2.8c-2.2 0-4.2 1-5.6 2.9ZM.4 3.2l1.8 2C3.7 3 6 1.9 8.5 1.9s4.8 1.1 6.3 3.3l1.8-2A13.7 13.7 0 0 0 8.5 0C5.3 0 2.4 1.2.4 3.2Z"/></svg>
      <svg viewBox="0 0 25 12" fill="none"><rect x=".5" y=".5" width="21" height="11" rx="3" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="15" height="8" rx="1.5" fill="currentColor"/><path d="M23.5 4v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity=".4"/></svg>
    </span>`;
  phone.prepend(sb);

  const tab = document.body.dataset.tab;
  if (tab) {
    const bar = document.createElement('nav');
    bar.className = 'm-tabbar';
    bar.setAttribute('aria-label', 'Tabs');
    bar.innerHTML = TABS.map(([id, label, href]) =>
      `<a href="${href}" class="${id === tab ? 'active' : ''}">${icons[id]}<span>${label}</span></a>`).join('');
    phone.appendChild(bar);
  }
  const hi = document.createElement('div');
  hi.className = 'm-home-indicator';
  phone.appendChild(hi);
})();
