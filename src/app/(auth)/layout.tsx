import type { ReactNode } from "react";
import { CashPulseLogo } from "@/components/ui/CashPulseLogo";
import { Toaster } from "sonner";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4 sm:p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-none border border-border bg-card shadow-xl md:grid-cols-2">
        <aside className="hidden flex-col justify-between bg-primary p-10 text-[var(--btn-primary-text)] md:flex">
          <CashPulseLogo size="lg" showTagline={true} themeInverted={true} />
          <p className="font-sans text-sm leading-relaxed opacity-90">
            Know exactly when your cash is safe, who owes you, and what to chase next.
          </p>
        </aside>
        <main className="flex items-center justify-center p-6 sm:p-10">{children}</main>
      </div>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
