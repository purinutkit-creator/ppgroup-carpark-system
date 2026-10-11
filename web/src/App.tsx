import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { ToastProvider } from './components/ui';
import { DesignProvider } from './design/DesignProvider';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import DeviceSetup from './pages/DeviceSetup';

const p = <T,>(f: () => Promise<{ default: T }>) => lazy(f as any) as any;

// Admin — operations
const Dashboard = p(() => import('./pages/admin/Dashboard'));
const Sessions = p(() => import('./pages/admin/Sessions'));
const SessionDetail = p(() => import('./pages/admin/SessionDetail'));
const LprReview = p(() => import('./pages/admin/LprReview'));
const GateMonitor = p(() => import('./pages/admin/GateMonitor'));
const Alerts = p(() => import('./pages/admin/Alerts'));
const Payments = p(() => import('./pages/admin/Payments'));
const Reports = p(() => import('./pages/admin/Reports'));
const AuditLog = p(() => import('./pages/admin/AuditLog'));
// Admin — configuration
const Rates = p(() => import('./pages/admin/Rates'));
const ValidationRules = p(() => import('./pages/admin/ValidationRules'));
const Members = p(() => import('./pages/admin/Members'));
const PlateLists = p(() => import('./pages/admin/PlateLists'));
const Reservations = p(() => import('./pages/admin/Reservations'));
const Sites = p(() => import('./pages/admin/Sites'));
const Devices = p(() => import('./pages/admin/Devices'));
const Users = p(() => import('./pages/admin/Users'));
const KioskContent = p(() => import('./pages/admin/KioskContent'));
const Settings = p(() => import('./pages/admin/Settings'));
const SystemPage = p(() => import('./pages/admin/System'));
// Merchants & appearance
const Merchants = p(() => import('./pages/admin/Merchants'));
const MerchantDetail = p(() => import('./pages/admin/MerchantDetail'));
const Appearance = p(() => import('./pages/admin/appearance/Appearance'));
// Front-line apps
const EntryKiosk = p(() => import('./pages/kiosk/EntryKiosk'));
const ExitKiosk = p(() => import('./pages/kiosk/ExitKiosk'));
const PaymentKiosk = p(() => import('./pages/kiosk/PaymentKiosk'));
const ParkingStatus = p(() => import('./pages/customer/ParkingStatus'));
const Counter = p(() => import('./pages/counter/Counter'));
const MerchantRegister = p(() => import('./pages/merchant/Register'));
const MerchantPortal = p(() => import('./pages/merchant/Portal'));
const Pos = p(() => import('./pages/pos/Pos'));
const CustomerDisplay = p(() => import('./pages/pos/CustomerDisplay'));

const Loading = () => <div className="page-loading">กำลังโหลด…</div>;

function Sys({ system, children }: { system: Parameters<typeof DesignProvider>[0]['system']; children: ReactNode }) {
  return <DesignProvider system={system}>{children}</DesignProvider>;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/setup" element={<DeviceSetup />} />

              <Route path="/p/:token" element={<Sys system="customer-web"><ParkingStatus /></Sys>} />
              <Route path="/kiosk/entry" element={<Sys system="entry-kiosk"><EntryKiosk /></Sys>} />
              <Route path="/kiosk/exit" element={<Sys system="exit-kiosk"><ExitKiosk /></Sys>} />
              <Route path="/kiosk/pay" element={<Sys system="payment-kiosk"><PaymentKiosk /></Sys>} />
              <Route path="/counter" element={<RequireAuth perms={['validation.apply']}><Sys system="info-counter"><Counter /></Sys></RequireAuth>} />
              <Route path="/merchant/register" element={<Sys system="merchant-portal"><MerchantRegister /></Sys>} />
              <Route path="/merchant/*" element={<RequireAuth perms={['merchant.portal', 'pos.reports']}><Sys system="merchant-portal"><MerchantPortal /></Sys></RequireAuth>} />
              <Route path="/pos" element={<RequireAuth perms={['pos.sell']}><Sys system="merchant-pos"><Pos /></Sys></RequireAuth>} />
              <Route path="/display" element={<Sys system="customer-display"><CustomerDisplay /></Sys>} />

              <Route path="/admin" element={<RequireAuth perms={['dashboard.view', 'sessions.view', 'reports.view', 'settings.manage', 'merchants.view', 'appearance.edit']}><Sys system="admin"><AdminLayout /></Sys></RequireAuth>}>
                <Route index element={<Dashboard />} />
                <Route path="sessions" element={<Sessions />} />
                <Route path="sessions/:id" element={<SessionDetail />} />
                <Route path="review" element={<LprReview />} />
                <Route path="gates" element={<GateMonitor />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="payments" element={<Payments />} />
                <Route path="reports" element={<Reports />} />
                <Route path="audit" element={<AuditLog />} />
                <Route path="rates" element={<Rates />} />
                <Route path="validation" element={<ValidationRules />} />
                <Route path="members" element={<Members />} />
                <Route path="plate-lists" element={<PlateLists />} />
                <Route path="reservations" element={<Reservations />} />
                <Route path="sites" element={<Sites />} />
                <Route path="devices" element={<Devices />} />
                <Route path="users" element={<Users />} />
                <Route path="kiosk-content" element={<KioskContent />} />
                <Route path="settings" element={<Settings />} />
                <Route path="system" element={<SystemPage />} />
                <Route path="merchants" element={<Merchants />} />
                <Route path="merchants/:id" element={<MerchantDetail />} />
                <Route path="appearance" element={<Appearance />} />
              </Route>
              <Route path="*" element={<div className="page-forbidden">ไม่พบหน้า</div>} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
