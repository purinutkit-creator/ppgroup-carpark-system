import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { get, getToken, post, setToken } from './api';

export interface Me {
  id: number;
  username: string;
  displayName: string;
  role: string;
  siteIds: number[] | null;
  merchantId: number | null;
  branchId: number | null;
  merchant: { id: number; code: string; name: string; status: string; logo_url: string | null } | null;
  permissions: string[];
}

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  can: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const r = await get<{ user: Me }>('/api/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onLogout = () => setUser(null);
    window.addEventListener('pp:logout', onLogout);
    return () => window.removeEventListener('pp:logout', onLogout);
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const r = await post<{ token: string; user: Me }>('/api/auth/login', { username, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };
  const logout = async () => {
    try {
      await post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  };
  const can = (...perms: string[]) => !!user && perms.some((p) => user.permissions.includes(p));
  return <Ctx.Provider value={{ user, loading, login, logout, can, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Route guard: requires login and (optionally) any of the given permissions. */
export function RequireAuth({ children, perms }: { children: ReactNode; perms?: string[] }) {
  const { user, loading, can } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page-loading">กำลังโหลด…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (perms?.length && !can(...perms)) return <div className="page-forbidden">ไม่มีสิทธิ์เข้าถึงหน้านี้</div>;
  return <>{children}</>;
}
