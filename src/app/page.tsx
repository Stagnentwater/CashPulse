"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "../lib/api";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(() => {
        if (!cancelled) router.replace("/dashboard");
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Render nothing while the server check runs; the redirect above handles the rest.
  return null;
}

