import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { Toaster } from "sonner";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4 sm:p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-2">
        <aside className="hidden flex-col justify-between bg-primary p-10 text-white md:flex">
          <div className="flex items-center gap-2">
            <Wallet className="h-6 w-6" aria-hidden="true" />
            <span className="text-xl font-semibold">CashPulse</span>
          </div>
          <p className="text-sm leading-relaxed text-white/90">
            Know exactly when your cash is safe, who owes you, and what to chase next.
          </p>
        </aside>
        <main className="flex items-center justify-center p-6 sm:p-10">{children}</main>
      </div>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
