"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Building2, Lock, Mail, UserRound } from "lucide-react";
import { ApiError, authApi } from "../../../lib/api";

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD_LENGTH = 6;

const inputClass =
  "w-full rounded-lg border bg-canvas px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

type SignupField = "name" | "clinicName" | "email" | "password";
type SignupErrors = Partial<Record<SignupField, string>>;

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<SignupErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function validate(): SignupErrors {
    const next: SignupErrors = {};
    if (!name.trim()) next.name = "Your name is required.";
    if (!clinicName.trim()) next.clinicName = "Clinic name is required.";
    const cleanEmail = email.trim();
    if (!cleanEmail) next.email = "Email is required.";
    else if (!EMAIL_RE.test(cleanEmail)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Password is required.";
    else if (password.length < MIN_PASSWORD_LENGTH)
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    return next;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setFormError(null);
    const cleanName = name.trim();
    try {
      await authApi.signup({
        name: cleanName,
        clinicName: clinicName.trim(),
        email: email.trim(),
        password,
      });
      toast.success(`Welcome to CashPulse, ${cleanName}!`);
      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not reach the server. Try again.";
      setFormError(message);
      toast.error(message);
    }
  }

  function fieldClass(field: SignupField) {
    return `${inputClass} ${errors[field] ? "border-coral" : "border-border"}`;
  }

  function renderError(field: SignupField) {
    const message = errors[field];
    if (!message) return null;
    return (
      <p id={`signup-${field}-error`} className="mt-1 text-xs text-coral">
        {message}
      </p>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Create your clinic account</h1>
      <p className="mt-1 text-sm text-slate-500">Set up your back office in under a minute.</p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label htmlFor="signup-name" className="mb-1 block text-sm font-medium text-slate-700">
            Your name
          </label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "signup-name-error" : undefined}
              className={`${fieldClass("name")} pl-9`}
            />
          </div>
          {renderError("name")}
        </div>

        <div>
          <label htmlFor="signup-clinic" className="mb-1 block text-sm font-medium text-slate-700">
            Clinic name
          </label>
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="signup-clinic"
              type="text"
              autoComplete="organization"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              aria-invalid={Boolean(errors.clinicName)}
              aria-describedby={errors.clinicName ? "signup-clinicName-error" : undefined}
              className={`${fieldClass("clinicName")} pl-9`}
            />
          </div>
          {renderError("clinicName")}
        </div>

        <div>
          <label htmlFor="signup-email" className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "signup-email-error" : undefined}
              className={`${fieldClass("email")} pl-9`}
            />
          </div>
          {renderError("email")}
        </div>

        <div>
          <label htmlFor="signup-password" className="mb-1 block text-sm font-medium text-slate-700">
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "signup-password-error" : undefined}
              className={`${fieldClass("password")} pl-9`}
            />
          </div>
          {renderError("password")}
        </div>

        {formError && (
          <p role="alert" className="text-xs text-coral">
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover"
        >
          Create account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:text-primary-hover">
          Sign in
        </Link>
      </p>
    </div>
  );
}
