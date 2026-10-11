import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { get } from '../lib/api';
import { useSocketEvents } from '../lib/useSocket';
import { Button, useToast } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  perms: string[];
  badge?: 'review' | 'alerts';
}

export const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'ภาพรวม',
    items: [
      { to: '/admin', label: 'Dashboard', icon: '📊', perms: ['dashboard.view'] },
      { to: '/admin/gates', label: 'ทางเข้า–ออก (Live)', icon: '🚧', perms: ['gate.control', 'dashboard.view'] },
      { to: '/admin/alerts', label: 'การแจ้งเตือน', icon: '🔔', perms: ['alerts.manage', 'dashboard.view'], badge: 'alerts' },
    ],
  },
  {
    section: 'ลานจอด',
    items: [
      { to: '/admin/sessions', label: 'รายการจอดรถ', icon: '🚗', perms: ['sessions.view'] },
      { to: '/admin/review', label: 'ตรวจสอบป้ายทะเบียน', icon: '🔍', perms: ['lpr.review'], badge: 'review' },
      { to: '/admin/payments', label: 'การชำระเงิน', icon: '💳', perms: ['payment.view'] },
      { to: '/admin/members', label: 'สมาชิก & บัตรจอด', icon: '🪪', perms: ['members.manage'] },
      { to: '/admin/plate-lists', label: 'Blacklist / Whitelist', icon: '⛔', perms: ['lists.manage'] },
      { to: '/admin/reservations', label: 'จองที่จอด', icon: '📅', perms: ['reservations.manage'] },
    ],
  },
  {
    section: 'ร้านค้า & ส่วนลด',
    items: [
      { to: '/admin/merchants', label: 'ร้านค้า (Merchants)', icon: '🏪', perms: ['merchants.view', 'merchants.manage'] },
      { to: '/admin/validation', label: 'กฎแสตมป์ / Validation', icon: '🎟️', perms: ['validation.rules'] },
      { to: '/counter', label: 'ประชาสัมพันธ์ (Counter)', icon: '🛎️', perms: ['validation.apply'] },
    ],
  },
  {
    section: 'รายงาน',
    items: [
      { to: '/admin/reports', label: 'รายงาน', icon: '📈', perms: ['reports.view'] },
      { to: '/admin/audit', label: 'Audit Log', icon: '🧾', perms: ['audit.view'] },
    ],
  },
  {
    section: 'ตั้งค่า',
    items: [
      { to: '/admin/rates', label: 'อัตราค่าจอด', icon: '💰', perms: ['rates.manage'] },
      { to: '/admin/sites', label: 'สาขา / โซน / ทางเข้า', icon: '🏢', perms: ['sites.manage'] },
      { to: '/admin/devices', label: 'อุปกรณ์', icon: '📷', perms: ['devices.manage'] },
      { to: '/admin/kiosk-content', label: 'Kiosk Content', icon: '🖼️', perms: ['kiosk_content.manage'] },
      { to: '/admin/appearance', label: 'Appearance & Fonts', icon: '🎨', perms: ['appearance.edit'] },
      { to: '/admin/settings', label: 'ตั้งค่าระบบ', icon: '⚙️', perms: ['settings.manage'] },
      { to: '/admin/users', label: 'ผู้ใช้ & สิทธิ์', icon: '👥', perms: ['users.manage'] },
      { to: '/admin/system', label: 'สำรองข้อมูล & PDPA', icon: '🛡️', perms: ['backup.manage', 'pdpa.manage'] },
    ],
  },
];

export default function AdminLayout() {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<{ review: number; alerts: number }>({ review: 0, alerts: 0 });
  const loc = useLocation();
  const toast = useToast();

  const loadCounts = () =>
    get<{ review: number; alerts: number }>('/api/admin/counts')
      .then(setCounts)
      .catch(() => undefined);
  useEffect(() => {
    loadCounts();
  }, []);
  useEffect(() => setOpen(false), [loc.pathname]);
  useSocketEvents({
    'alert:new': (a: { severity: string; message: string }) => {
      if (a.severity === 'CRITICAL') toast(a.message, 'error');
      loadCounts();
    },
    'alert:resolved': loadCounts,
    'detection:new': loadCounts,
  });

  return (
    <div className="admin-shell">
      <nav className={`admin-nav ${open ? 'open' : ''}`}>
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span>Smart Parking</span>
        </div>
        {NAV.map((s) => {
          const items = s.items.filter((i) => can(...i.perms));
          if (!items.length) return null;
          return (
            <div key={s.section}>
              <div className="section">{s.section}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/admin'} data-el="admin/layout/nav/item">
                  <span>{i.icon}</span>
                  <span>{i.label}</span>
                  {i.badge && counts[i.badge] > 0 && <span className="count">{counts[i.badge]}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="admin-main">
        <div className="admin-topbar">
          <Button className="menu-toggle" size="sm" onClick={() => setOpen((o) => !o)}>
            ☰
          </Button>
          <span className="spacer" />
          <span className="small muted">
            {user?.displayName} · {user?.role}
          </span>
          <Button size="sm" onClick={logout}>
            ออกจากระบบ
          </Button>
        </div>
        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
