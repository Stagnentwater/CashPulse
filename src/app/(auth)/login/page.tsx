"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowRight, Lock, Mail, Stethoscope } from "lucide-react";
import { ApiError, authApi } from "../../../lib/api";

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const DEMO_EMAIL = "ananya@physiocare.demo";
const DEMO_PASSWORD = "demo1234";

const inputClass =
  "w-full rounded-xl border bg-card-elevated px-3 py-2.5 text-sm text-body placeholder:text-[var(--input-placeholder)] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 font-sans";

type LoginErrors = { email?: string; password?: string };

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function validate(): LoginErrors {
    const next: LoginErrors = {};
    const cleanEmail = email.trim();
    if (!cleanEmail) next.email = "Email is required.";
    else if (!EMAIL_RE.test(cleanEmail)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Password is required.";
    return next;
  }

  async function signIn(address: string, pw: string) {
    setFormError(null);
    try {
      await authApi.login(address, pw);
      toast.success("Welcome back!");
      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not reach the server. Try again.";
      setFormError(message);
      toast.error(message);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    void signIn(email.trim(), password);
  }

  function handleDemo() {
    void signIn(DEMO_EMAIL, DEMO_PASSWORD);
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-heading text-2xl font-bold text-heading">Sign in to CashPulse</h1>
      <p className="mt-1 font-sans text-sm text-muted">Welcome back. Pick up where you left off.</p>

      <button
        type="button"
        onClick={handleDemo}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-[var(--btn-primary-text)] shadow-sm transition hover:bg-primary-hover"
      >
        <Stethoscope className="h-4 w-4" aria-hidden="true" />
        {"Instant Demo: Dr. Ananya's PhysioCare"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="my-6 flex items-center gap-3 text-xs text-muted font-sans">
        <span className="h-px flex-1 bg-border" />
        or sign in with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-heading font-sans">
            Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "login-email-error" : undefined}
              className={`${inputClass} pl-9 ${errors.email ? "border-coral" : "border-border"}`}
            />
          </div>
          {errors.email && (
            <p id="login-email-error" className="mt-1 text-xs text-coral">
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-heading font-sans">
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "login-password-error" : undefined}
              className={`${inputClass} pl-9 ${errors.password ? "border-coral" : "border-border"}`}
            />
          </div>
          {errors.password && (
            <p id="login-password-error" className="mt-1 text-xs text-coral">
              {errors.password}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-xs text-coral">
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] shadow-sm transition hover:bg-primary-hover font-sans"
        >
          Sign in
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted font-sans">
        New to CashPulse?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:text-primary-hover">
          Create an account
        </Link>
      </p>
    </div>
  );
}
