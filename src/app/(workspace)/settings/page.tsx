"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  Sun,
  User,
  Zap,
} from "lucide-react";
import { authApi, type SessionUser } from "@/lib/api";
import { useTheme, type ThemeMode } from "@/lib/useTheme";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(({ user: me }) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const THEMES: Array<{
    id: ThemeMode;
    label: string;
    tagline: string;
    description: string;
    icon: typeof Sun;
    badge: string;
    preview: {
      bg: string;
      card: string;
      border: string;
      accent: string;
      accentText: string;
      text: string;
    };
  }> = [
    {
      id: "white",
      label: "White",
      tagline: "Clean Clinical Light",
      description:
        "High-contrast, airy light mode designed for daytime consultations and bright clinical lighting.",
      icon: Sun,
      badge: "Standard",
      preview: {
        bg: "bg-slate-100",
        card: "bg-white",
        border: "border-slate-200",
        accent: "bg-[#1A73E8]",
        accentText: "text-[#1A73E8]",
        text: "text-slate-800",
      },
    },
    {
      id: "dark",
      label: "Dark",
      tagline: "Obsidian Slate & Charcoal",
      description:
        "Deep, distraction-free obsidian theme tailored for low-light evening reviews and reduced eye strain.",
      icon: Moon,
      badge: "Popular",
      preview: {
        bg: "bg-[#0B0F19]",
        card: "bg-[#141B2D]",
        border: "border-[#232E48]",
        accent: "bg-[#38BDF8]",
        accentText: "text-[#38BDF8]",
        text: "text-slate-200",
      },
    },
    {
      id: "neon",
      label: "Neon Dark",
      tagline: "Luminous Cyber & Telemetry Glow",
      description:
        "Ultra-dark space canvas accented with glowing cyan borders, electric emerald telemetry, and glassmorphic sheen.",
      icon: Zap,
      badge: "Aesthetic",
      preview: {
        bg: "bg-[#04060D]",
        card: "bg-[#090E1C]",
        border: "border-cyan-500/40",
        accent: "bg-[#00F0FF]",
        accentText: "text-[#00F0FF]",
        text: "text-cyan-100",
      },
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Palette className="h-3.5 w-3.5" />
          <span>Clinic Workspace Settings</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Settings & Preferences
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Personalize CashPulse styling, visual themes, and automated clinic governance controls.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200">
        <Link
          href="/settings"
          className="border-b-2 border-primary px-4 py-2.5 text-sm font-semibold text-primary"
        >
          Appearance & Themes
        </Link>
        <Link
          href="/settings/ai-permissions"
          className="flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800 transition-colors"
        >
          <ShieldCheck className="h-4 w-4" />
          AI Permissions & Governance
        </Link>
      </div>

      {/* Theme Selection Grid */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Workspace Theme</h2>
          <p className="text-xs text-slate-500">
            Select your preferred visual atmosphere. Changes apply immediately across all pages.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {THEMES.map((t) => {
            const isSelected = theme === t.id;
            const Icon = t.icon;

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={`group relative flex flex-col rounded-2xl border p-5 text-left transition-all duration-200 ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/30"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                }`}
              >
                {/* Active Indicator Chip */}
                {isSelected && (
                  <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-xs">
                    <Check className="h-3 w-3" />
                    Active Theme
                  </span>
                )}

                {/* Theme Title & Icon */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                        isSelected
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-slate-200 bg-slate-50 text-slate-600 group-hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm leading-tight">
                        {t.label}
                      </h3>
                      <p className="text-[11px] text-slate-500">{t.tagline}</p>
                    </div>
                  </div>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
                    {t.badge}
                  </span>
                </div>

                {/* Live Mockup Preview */}
                <div
                  className={`mt-4 rounded-xl border p-3 shadow-inner ${t.preview.bg} ${t.preview.border}`}
                >
                  <div
                    className={`rounded-lg border p-2.5 shadow-xs ${t.preview.card} ${t.preview.border}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="h-2 w-12 rounded bg-slate-300/40" />
                      <div className={`h-2 w-4 rounded-full ${t.preview.accent}`} />
                    </div>
                    <div className={`mt-2 font-mono text-xs font-bold ${t.preview.text}`}>
                      ₹1,48,000
                    </div>
                    <div className="mt-2.5 flex items-end gap-1">
                      <div className={`h-3 w-3 rounded-xs ${t.preview.accent} opacity-40`} />
                      <div className={`h-5 w-3 rounded-xs ${t.preview.accent} opacity-70`} />
                      <div className={`h-7 w-3 rounded-xs ${t.preview.accent}`} />
                      <div className={`h-4 w-3 rounded-xs ${t.preview.accent} opacity-60`} />
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="mt-3.5 text-xs text-slate-600 leading-relaxed">
                  {t.description}
                </p>

                {/* Selection Action Button */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-500">
                    {isSelected ? "Currently Enabled" : "Tap to apply"}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      isSelected ? "text-primary" : "text-slate-400 group-hover:text-primary"
                    }`}
                  >
                    {isSelected ? "✓ Applied" : "Switch →"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Clinic Account Profile */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <User className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Clinic Profile</h2>
            <p className="text-xs text-slate-500">
              Active clinic workspace identity and linked payment credentials.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
            <span className="text-[11px] font-medium text-slate-500">Clinic Organization</span>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {user?.clinicName || "Clinic"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
            <span className="text-[11px] font-medium text-slate-500">Owner / Practitioner</span>
            <p className="mt-1 text-sm font-semibold text-slate-900">{user?.name || "Owner"}</p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
            <span className="text-[11px] font-medium text-slate-500">Account Email</span>
            <p className="mt-1 text-sm font-mono text-slate-800">{user?.email || "—"}</p>
          </div>
        </div>
      </section>

      {/* Autonomous Governance Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald/10 text-emerald">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">AI Autonomy & Safety Caps</h2>
              <p className="text-xs text-slate-500">
                Configure auto-approve rupee limits, 3-state tool execution matrix, and rollback audit logs.
              </p>
            </div>
          </div>
          <Link
            href="/settings/ai-permissions"
            className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-hover transition-colors"
          >
            Manage AI Permissions →
          </Link>
        </div>
      </section>
    </div>
  );
}
