'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  authApi,
  setToken,
  type UserDto,
  type WalletDto,
  walletApi,
} from '@/lib/api';
import { connectSockets, disconnectSockets } from '@/lib/socket';

interface AuthContextValue {
  user: UserDto | null;
  wallet: WalletDto | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
    referralCode?: string;
  }) => Promise<void>;
  /** Sesión demo por nickname (sin registro) */
  startDemo: (nickname: string) => Promise<void>;
  logout: () => void;
  refreshWallet: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser({
        ...data.user,
        isPremium: !!data.user.isPremium,
        isDemoGuest: !!data.user.isDemoGuest,
      });
      setWallet(data.wallet);
      connectSockets();
    } catch {
      setUser(null);
      setWallet(null);
      setToken(null);
      disconnectSockets();
    }
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const w = await walletApi.get();
      setWallet(w);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('td_token') : null;
    if (!token) {
      // Sin sesión: UI pública lista al instante (no bloquea ni redirige)
      setLoading(false);
      return;
    }
    refreshMe().finally(() => setLoading(false));
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    setToken(res.accessToken);
    setUser({
      ...res.user,
      isPremium: !!res.user.isPremium,
      isDemoGuest: !!res.user.isDemoGuest,
    });
    connectSockets();
    try {
      const w = await walletApi.get();
      setWallet(w);
    } catch {
      setWallet(null);
    }
  }, []);

  const register = useCallback(
    async (data: {
      email: string;
      username: string;
      password: string;
      displayName?: string;
      referralCode?: string;
    }) => {
      const res = await authApi.register(data);
      setToken(res.accessToken);
      setUser({
        ...res.user,
        isPremium: !!res.user.isPremium,
        isDemoGuest: !!res.user.isDemoGuest,
      });
      connectSockets();
      setWallet({ balance: 0, lockedBalance: 0, availableBalance: 0 });
    },
    [],
  );

  const startDemo = useCallback(async (nickname: string) => {
    const res = await authApi.demo(nickname);
    setToken(res.accessToken);
    setUser({
      ...res.user,
      isPremium: false,
      isDemoGuest: true,
    });
    connectSockets();
    setWallet({ balance: 0, lockedBalance: 0, availableBalance: 0 });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setWallet(null);
    disconnectSockets();
  }, []);

  const value = useMemo(
    () => ({
      user,
      wallet,
      loading,
      login,
      register,
      startDemo,
      logout,
      refreshWallet,
      refreshMe,
    }),
    [
      user,
      wallet,
      loading,
      login,
      register,
      startDemo,
      logout,
      refreshWallet,
      refreshMe,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
