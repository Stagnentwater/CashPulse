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
      label: "White (Light)",
      tagline: "Clean Nautical Warm Sand",
      description:
        "Pure White canvas with Warm Sand (#FFF1E7) cards, Sandstone dividers, and Marina Navy (#326080) CTA.",
      icon: Sun,
      badge: "Marina Light",
      preview: {
        bg: "bg-[#FFFFFF]",
        card: "bg-[#FFF1E7]",
        border: "border-[#E5D3C5]",
        accent: "bg-[#326080]",
        accentText: "text-[#326080]",
        text: "text-[#102433]",
      },
    },
    {
      id: "dark",
      label: "Dark (Midnight)",
      tagline: "Abyssal Navy & Deep Marine",
      description:
        "Deep Abyssal Navy (#0A131A) canvas with Deep Marine cards, Muted Steel dividers, and Ocean Blue (#4784AD) CTA.",
      icon: Moon,
      badge: "Marina Dark",
      preview: {
        bg: "bg-[#0A131A]",
        card: "bg-[#12222F]",
        border: "border-[#1E384D]",
        accent: "bg-[#4784AD]",
        accentText: "text-[#4784AD]",
        text: "text-[#FFF1E7]",
      },
    },
    {
      id: "neon",
      label: "Neon (Bioluminescent)",
      tagline: "Midnight Void & Dark Trench",
      description:
        "Midnight Void (#050A0F) with Dark Trench cards, glowing borders (rgba(0,229,255,0.25)), and Electric Cyan (#00E5FF).",
      icon: Zap,
      badge: "Marina Neon",
      preview: {
        bg: "bg-[#050A0F]",
        card: "bg-[#0D1924]",
        border: "border-[#183B54]",
        accent: "bg-[#00E5FF]",
        accentText: "text-[#00E5FF]",
        text: "text-[#FFFFFF]",
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
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight text-heading sm:text-3xl">
          Settings & Preferences
        </h1>
        <p className="mt-1.5 text-sm text-body">
          Personalize CashPulse styling, visual themes, and automated clinic governance controls.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border">
        <Link
          href="/settings"
          className="border-b-2 border-primary px-4 py-2.5 text-sm font-semibold text-primary"
        >
          Appearance & Themes
        </Link>
        <Link
          href="/settings/ai-permissions"
          className="flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted hover:border-border hover:text-heading transition-colors"
        >
          <ShieldCheck className="h-4 w-4" />
          AI Permissions & Governance
        </Link>
      </div>

      {/* Theme Selection Grid */}
      <section className="space-y-4">
        <div>
          <h2 className="font-heading text-base font-bold text-heading">Workspace Theme</h2>
          <p className="text-xs text-muted">
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
                className={`group relative flex flex-col rounded-2xl border p-5 text-left transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-lg ring-2 ring-primary/40"
                    : "border-border bg-card hover:border-primary/50 hover:bg-card-elevated hover:shadow-md"
                }`}
              >
                {/* Active Indicator Chip */}
                {isSelected && (
                  <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-[var(--btn-primary-text)] shadow-xs">
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
                          ? "border-primary/40 bg-primary/20 text-primary"
                          : "border-border bg-card-elevated text-muted group-hover:text-heading"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-heading font-bold text-heading text-sm leading-tight">
                        {t.label}
                      </h3>
                      <p className="text-[11px] text-muted">{t.tagline}</p>
                    </div>
                  </div>
                  <span className="rounded-md border border-border bg-card-elevated px-1.5 py-0.5 text-[10px] font-mono text-muted">
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
                      <div className="h-2 w-12 rounded bg-current opacity-20" />
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
                <p className="mt-3.5 text-xs text-body leading-relaxed">
                  {t.description}
                </p>

                {/* Selection Action Button */}
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted">
                    {isSelected ? "Currently Enabled" : "Tap to apply"}
                  </span>
                  <span
                    className={`text-xs font-bold ${
                      isSelected ? "text-primary" : "text-muted group-hover:text-primary"
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
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
            <User className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-heading text-base font-bold text-heading">Clinic Profile</h2>
            <p className="text-xs text-muted">
              Active clinic workspace identity and linked payment credentials.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card-elevated p-4 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Clinic Organization
            </span>
            <p className="mt-1.5 font-heading text-sm font-bold text-heading">
              {user?.clinicName || "Clinic"}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card-elevated p-4 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Owner / Practitioner
            </span>
            <p className="mt-1.5 font-heading text-sm font-bold text-heading">
              {user?.name || "Owner"}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card-elevated p-4 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Account Email
            </span>
            <p className="mt-1.5 font-mono text-sm font-medium text-body">
              {user?.email || "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Autonomous Governance Card */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald/10 text-emerald border border-emerald/20">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-heading text-base font-bold text-heading">AI Autonomy & Safety Caps</h2>
              <p className="text-xs text-muted">
                Configure auto-approve rupee limits, 3-state tool execution matrix, and rollback audit logs.
              </p>
            </div>
          </div>
          <Link
            href="/settings/ai-permissions"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-xs font-bold text-[var(--btn-primary-text)] shadow-xs hover:bg-primary-hover transition-colors whitespace-nowrap"
          >
            Manage AI Permissions →
          </Link>
        </div>
      </section>
    </div>
  );
}
