"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface Stats {
  total_sales: number;
  paid_orders: number;
  active_passes: number;
}

interface Order {
  orderId: string;
  email: string;
  source: string;
  amount: number;
  date: string;
  has_lifetime_access: boolean;
}

interface Entitlement {
  email: string;
  has_lifetime_access: boolean;
  source: string;
  updated_at: string;
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);

  useEffect(() => {
    const saved = sessionStorage.getItem("008ai_admin_token");
    if (saved) setToken(saved);
  }, []);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    const headers = { "x-admin-token": t };
    try {
      const [statsRes, ordersRes, entRes] = await Promise.all([
        fetch("/api/admin/stats", { headers }),
        fetch("/api/admin/orders", { headers }),
        fetch("/api/admin/entitlements", { headers }),
      ]);
      if (statsRes.status === 401 || ordersRes.status === 401 || entRes.status === 401) {
        sessionStorage.removeItem("008ai_admin_token");
        setToken(null);
        return;
      }
      const stats = await statsRes.json();
      const ordersData = await ordersRes.json();
      const entData = await entRes.json();
      setStats(stats);
      setOrders(ordersData.orders || []);
      setEntitlements(entData.entitlements || []);
    } catch (err: any) {
      console.error("[008AI Admin] 数据加载失败:", err?.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      sessionStorage.setItem("008ai_admin_token", data.token);
      setToken(data.token);
    } catch (err: any) {
      setAuthError(err?.message || "Login failed");
    }
    setLoading(false);
  };

  const toggleEntitlement = async (email: string, next: boolean) => {
    if (!token) return;
    const res = await fetch("/api/admin/entitlements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ email, has_lifetime_access: next }),
    });
    if (res.ok) await load(token);
  };

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff5f7] px-5">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-3xl border border-pink-200/60 bg-white/80 p-8 shadow-pink-100/50 backdrop-blur-xl"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-white">
              <Lock className="h-4 w-4" />
            </span>
            <h1 className="text-lg font-extrabold text-ink">008AI Admin</h1>
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            Enter your admin key to open the control panel.
          </p>
          <label className="mt-6 block text-xs font-semibold text-ink-soft">
            Admin Key
          </label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-pink-200/70 bg-white px-4 text-sm text-ink outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-200"
            placeholder="••••••••"
            required
          />
          {authError && <p className="mt-3 text-xs text-rose-500">{authError}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-5 h-11 w-full rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 text-sm font-bold text-white transition hover:brightness-105 disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Sign In"}
          </button>
          <Link href="/" className="mt-5 block text-center text-xs text-ink-faint hover:text-pink-500">
            ← Back to site
          </Link>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff5f7] px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-white">
                <LayoutDashboard className="h-4 w-4" />
              </span>
              <h1 className="text-xl font-extrabold text-ink">008AI Control Panel</h1>
            </div>
            <p className="mt-1 text-sm text-ink-soft">Early Bird Pass · Orders & Entitlements</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => token && load(token)}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-pink-200/70 bg-white px-4 text-sm font-semibold text-ink-soft transition hover:border-pink-400"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              onClick={() => {
                sessionStorage.removeItem("008ai_admin_token");
                setToken(null);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-pink-200/70 bg-white px-4 text-sm font-semibold text-ink-soft transition hover:border-rose-300 hover:text-rose-500"
            >
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard label="Total Sales Amount" value={`$${(stats?.total_sales || 0).toFixed(2)}`} />
          <StatCard label="Paid Orders Count" value={String(stats?.paid_orders || 0)} />
          <StatCard label="Active Early Bird Passes" value={String(stats?.active_passes || 0)} />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <Panel title="Order Management">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead>
                  <tr className="border-b border-pink-100 text-xs uppercase tracking-wider text-ink-faint">
                    <th className="py-3 pr-3 font-semibold">Order ID</th>
                    <th className="py-3 pr-3 font-semibold">Email</th>
                    <th className="py-3 pr-3 font-semibold">Source</th>
                    <th className="py-3 pr-3 font-semibold">Date</th>
                    <th className="py-3 font-semibold">Entitlement</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.orderId} className="border-b border-pink-100/60">
                      <td className="max-w-[160px] truncate py-3 pr-3 font-mono text-xs text-ink-soft">
                        {o.orderId}
                      </td>
                      <td className="py-3 pr-3 text-ink">{o.email || "—"}</td>
                      <td className="py-3 pr-3 text-ink-soft">{o.source}</td>
                      <td className="py-3 pr-3 text-xs text-ink-soft">
                        {new Date(o.date).toLocaleString()}
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                            o.has_lifetime_access
                              ? "bg-pink-100 text-pink-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {o.has_lifetime_access ? "Lifetime" : "None"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!orders.length && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-ink-faint">
                        No orders yet — capture PayPal payments to populate this table.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Active Early Bird Pass List">
            <div className="space-y-3">
              {entitlements.map((e) => (
                <div
                  key={e.email}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-pink-100 bg-white/70 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{e.email}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      via {e.source} · {new Date(e.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleEntitlement(e.email, !e.has_lifetime_access)}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-pink-200/70 px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:border-pink-400"
                  >
                    {e.has_lifetime_access ? (
                      <ToggleRight className="h-4 w-4 text-pink-500" />
                    ) : (
                      <ToggleLeft className="h-4 w-4 text-slate-400" />
                    )}
                    {e.has_lifetime_access ? "Active" : "Inactive"}
                  </button>
                </div>
              ))}
              {!entitlements.length && (
                <p className="py-8 text-center text-sm text-ink-faint">
                  No lifetime passes yet.
                </p>
              )}
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-pink-200/60 bg-white/80 p-6 shadow-pink-100/50 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-pink-500" />
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-ink">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-pink-200/60 bg-white/80 p-6 shadow-pink-100/50 backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-pink-500" />
        <h2 className="text-sm font-extrabold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}
