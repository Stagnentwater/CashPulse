"use client";

import React from "react";

interface CashPulseLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showTagline?: boolean;
  iconOnly?: boolean;
  className?: string;
  themeInverted?: boolean; // When on primary background (like auth sidebar)
}

/**
 * CashPulse Brand Logo
 * Engineered with 100% sharp geometric rectangles and dynamic financial telemetry ECG rhythm.
 * Flawlessly adapts across White (Marina), Dark (Midnight), and Neon (Bioluminescent) themes.
 */
export function CashPulseLogo({
  size = "md",
  showTagline = true,
  iconOnly = false,
  className = "",
  themeInverted = false,
}: CashPulseLogoProps) {
  const dimensions = {
    sm: { icon: "h-7 w-7", svg: 28, text: "text-base", sub: "text-[8px]", pip: "h-1 w-1" },
    md: { icon: "h-9 w-9", svg: 36, text: "text-lg", sub: "text-[9px]", pip: "h-1.5 w-1.5" },
    lg: { icon: "h-11 w-11", svg: 44, text: "text-xl", sub: "text-[10px]", pip: "h-2 w-2" },
    xl: { icon: "h-14 w-14", svg: 56, text: "text-2xl", sub: "text-xs", pip: "h-2.5 w-2.5" },
  }[size];

  const primaryColor = themeInverted ? "var(--btn-primary-text)" : "var(--accent-primary)";
  const softColor = themeInverted ? "rgba(255, 255, 255, 0.7)" : "var(--accent-soft)";
  const frameBg = themeInverted ? "rgba(0, 0, 0, 0.2)" : "var(--card-elevated)";
  const frameBorder = themeInverted ? "rgba(255, 255, 255, 0.25)" : "var(--border-color)";

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Sharp Rectangular Telemetry Icon Mark */}
      <div
        className={`relative flex shrink-0 items-center justify-center rounded-none border shadow-2xs transition-all cashpulse-logo-mark ${dimensions.icon}`}
        style={{
          backgroundColor: frameBg,
          borderColor: frameBorder,
        }}
      >
        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-[75%] w-[75%]"
          aria-hidden="true"
        >
          {/* Subtle Grid Baseline */}
          <line
            x1="3"
            y1="18"
            x2="33"
            y2="18"
            stroke="currentColor"
            strokeOpacity={themeInverted ? "0.3" : "0.2"}
            strokeWidth="1"
            strokeDasharray="2 2"
          />

          {/* Stepped Vault Geometry (Corner Anchors) */}
          <rect
            x="3"
            y="6"
            width="4"
            height="1.5"
            fill={primaryColor}
            fillOpacity={themeInverted ? "0.9" : "0.7"}
          />
          <rect
            x="3"
            y="6"
            width="1.5"
            height="4"
            fill={primaryColor}
            fillOpacity={themeInverted ? "0.9" : "0.7"}
          />
          <rect
            x="29"
            y="28.5"
            width="4"
            height="1.5"
            fill={primaryColor}
            fillOpacity={themeInverted ? "0.9" : "0.7"}
          />
          <rect
            x="31.5"
            y="26"
            width="1.5"
            height="4"
            fill={primaryColor}
            fillOpacity={themeInverted ? "0.9" : "0.7"}
          />

          {/* Dynamic Financial ECG Telemetry Pulse Waveform */}
          <path
            d="M3 18H9L12 12L15 24L19 6L23 27L26 18H33"
            stroke={primaryColor}
            strokeWidth="2.25"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />

          {/* Peak Telemetry Live Pip (Sharp Square) */}
          <rect
            x="18"
            y="5"
            width="2.5"
            height="2.5"
            fill={softColor}
          />
        </svg>
      </div>

      {/* Brand Logotype */}
      {!iconOnly && (
        <div className="flex flex-col">
          <div className={`flex items-baseline font-heading font-extrabold tracking-tight leading-none ${dimensions.text}`}>
            <span className={themeInverted ? "text-[var(--btn-primary-text)]" : "text-heading"}>
              Cash
            </span>
            <span className={themeInverted ? "text-[var(--btn-primary-text)] font-black opacity-95 ml-0.5" : "text-primary ml-0.5"}>
              Pulse
            </span>
            <span
              className={`inline-block ${dimensions.pip} ml-1`}
              style={{ backgroundColor: primaryColor }}
            />
          </div>

          {showTagline && (
            <span
              className={`font-mono font-semibold uppercase tracking-widest mt-1 leading-none ${dimensions.sub} ${
                themeInverted ? "text-[var(--btn-primary-text)] opacity-75" : "text-muted"
              }`}
            >
              Clinic Telemetry
            </span>
          )}
        </div>
      )}
    </div>
  );
}
