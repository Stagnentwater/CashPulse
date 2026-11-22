"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast, Toaster } from "sonner";
import {
  Activity,
  ChevronDown,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Receipt,
  Settings,
  ShieldCheck,
  Sun,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { PRESET_LABELS } from "../../lib/demoPresets";
import type { PresetId } from "../../types/domain";
import { ApiError, apiFetch, authApi, type SessionUser } from "../../lib/api";
import { useTheme } from "@/lib/useTheme";
import { VoiceChatDock } from "@/components/agent/VoiceChatDock";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Who Owes Me", icon: HandCoins },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/bills", label: "Bills", icon: Receipt },
  { href: "/forecast", label: "Forecast", icon: TrendingUp },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/settings/ai-permissions", label: "AI Governance", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const PRESET_IDS = Object.keys(PRESET_LABELS) as PresetId[];

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [activePresetId, setActivePresetId] = useState<PresetId>("RENT_CRUNCH");

  const [user, setUser] = useState<SessionUser | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  // Auth guard: ask the server who is signed in; send signed-out visitors to /login.
  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(({ user: me }) => {
        if (!cancelled) setUser(me);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setRedirecting(true);
          router.replace("/login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Close the mobile drawer and user menu when the route changes (adjusted during render, not in an effect).
  const [menuPathname, setMenuPathname] = useState(pathname);
  if (menuPathname !== pathname) {
    setMenuPathname(pathname);
    setMobileNavOpen(false);
    setUserMenuOpen(false);
  }

  // Presets reseed the server data and the pages load it once on mount, so reload to show it.
  const switchPreset = async (id: PresetId) => {
    try {
      await apiFetch<{ ok: boolean; preset: string }>(`/api/presets/${id}`, { method: "POST" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not switch preset.");
      return;
    }
    setActivePresetId(id);
    window.location.reload();
  };

  const handleSignOut = async () => {
    setUserMenuOpen(false);
    try {
      await authApi.logout();
    } catch {
      // Ignore: the session may already be gone; we still leave the workspace.
    }
    toast.success("Signed out");
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-canvas text-primary transition-colors duration-200">
      {/* Mobile overlay */}
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs md:hidden"
        />
      )}

      {/* Sidebar: fixed on desktop, slide-in drawer on mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-all duration-200 md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <Link href="/dashboard" className="flex items-center gap-2.5 font-bold tracking-tight text-primary">
            <span className="flex h-8 w-8 items-center justify-center rounded-none bg-gradient-to-tr from-primary to-soft text-white shadow-xs">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="text-base font-heading font-bold tracking-tight text-heading">CashPulse</span>
              <span className="text-[10px] font-sans font-medium tracking-wider uppercase text-muted -mt-1">Clinic Copilot</span>
            </div>
          </Link>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-none p-1 text-muted hover:bg-card-elevated md:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== "/settings" && pathname.startsWith(`${item.href}/`)) || (item.href === "/settings" && pathname === "/settings");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-none px-3 py-2 text-sm font-sans font-medium transition-all duration-150 ${
                  active
                    ? "bg-primary/10 text-primary font-semibold shadow-2xs border border-primary/20"
                    : "text-body hover:bg-card-elevated hover:text-heading"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted"}`} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main column, offset by the sidebar on desktop */}
      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-header backdrop-blur-md px-4 sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-none p-2 text-body hover:bg-card-elevated md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-heading font-semibold text-heading">{user?.clinicName}</p>
          </div>

          {/* Preset switcher: only shown on Dr. Ananya's demo account */}
          {user?.email === "ananya@physiocare.demo" && (
            <div
              role="group"
              aria-label="Demo preset"
              className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-none bg-card-elevated p-1 border border-border"
            >
              {PRESET_IDS.map((id) => {
                const active = id === activePresetId;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => void switchPreset(id)}
                    className={`whitespace-nowrap rounded-none px-3 py-1 text-xs font-sans font-medium transition-colors ${
                      active
                        ? "bg-card text-primary shadow-xs font-semibold"
                        : "text-muted hover:text-heading"
                    }`}
                  >
                    {PRESET_LABELS[id]}
                  </button>
                );
              })}
            </div>
          )}

          {/* Theme Quick-Switcher */}
          <div
            role="group"
            aria-label="Theme switcher"
            className="flex items-center rounded-none border border-border bg-card p-0.5 shadow-2xs"
          >
            <button
              type="button"
              title="White Theme (Light)"
              aria-label="White Theme (Light)"
              onClick={() => setTheme("white")}
              className={`rounded-none p-1.5 transition-all ${
                theme === "white"
                  ? "bg-card text-secondary shadow-xs ring-1 ring-border"
                  : "text-muted hover:text-heading"
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Dark Theme (Midnight)"
              aria-label="Dark Theme (Midnight)"
              onClick={() => setTheme("dark")}
              className={`rounded-none p-1.5 transition-all ${
                theme === "dark"
                  ? "bg-card text-primary shadow-xs ring-1 ring-primary/40"
                  : "text-muted hover:text-heading"
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Neon Theme (Bioluminescent)"
              aria-label="Neon Theme (Bioluminescent)"
              onClick={() => setTheme("neon")}
              className={`rounded-none p-1.5 transition-all ${
                theme === "neon"
                  ? "bg-card text-primary shadow-xs ring-1 ring-primary"
                  : "text-muted hover:text-heading"
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* User menu */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((open) => !open)}
              className="flex items-center gap-1.5 rounded-none px-2 py-1.5 text-sm text-body hover:bg-card-elevated transition-colors cursor-pointer"
            >
              <span className="sr-only">Open user menu for {user?.clinicName}</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-none bg-gradient-to-tr from-primary/10 to-primary/20 text-xs font-bold text-primary border border-primary/20">
                {user?.name.trim().charAt(0).toUpperCase() || "C"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            </button>
            {userMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 rounded-none border border-border bg-card py-1.5 shadow-xl z-50"
              >
                <div className="border-b border-border px-3.5 py-2.5">
                  <p className="truncate text-sm font-bold font-heading text-primary">{user?.clinicName}</p>
                  <p className="truncate text-xs font-mono text-muted">{user?.email}</p>
                </div>
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-body hover:bg-card-elevated hover:text-heading transition-colors"
                >
                  <Settings className="h-4 w-4 text-muted" aria-hidden="true" />
                  Settings & Appearance
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-coral hover:bg-coral-tint/30 transition-colors cursor-pointer"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="p-4 sm:p-6">
          {redirecting ? (
            <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted">Redirecting…</div>
          ) : (
            children
          )}
        </main>
      </div>

      <VoiceChatDock user={user} />
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
