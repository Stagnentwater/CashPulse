export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      const data: unknown = await response.json();
      if (data && typeof data === "object" && "detail" in data) {
        detail = (data as { detail: unknown }).detail;
      }
    } catch {
      detail = undefined;
    }
    throw new ApiError(
      response.status,
      typeof detail === "string" && detail.length > 0 ? detail : "Request failed.",
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export type SessionUser = {
  id: string;
  name: string;
  clinicName: string;
  email: string;
  upiId: string;
  bankBalance: number;
};

export const authApi = {
  login(email: string, password: string): Promise<{ user: SessionUser }> {
    return apiFetch<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  signup({
    name,
    clinicName,
    email,
    password,
  }: {
    name: string;
    clinicName: string;
    email: string;
    password: string;
  }): Promise<{ user: SessionUser }> {
    return apiFetch<{ user: SessionUser }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, clinicName, email, password }),
    });
  },

  logout(): Promise<void> {
    return apiFetch<void>("/api/auth/logout", { method: "POST" });
  },

  me(): Promise<{ user: SessionUser }> {
    return apiFetch<{ user: SessionUser }>("/api/auth/me");
  },
};

export const aiApi = {
  getPermissions(): Promise<import("../types/domain").AssistantPermissions> {
    return apiFetch<import("../types/domain").AssistantPermissions>("/api/ai/permissions");
  },

  updatePermissions(
    permissions: import("../types/domain").AssistantPermissions,
  ): Promise<import("../types/domain").AssistantPermissions> {
    return apiFetch<import("../types/domain").AssistantPermissions>("/api/ai/permissions", {
      method: "PUT",
      body: JSON.stringify(permissions),
    });
  },

  applyPreset(
    presetName: import("../types/domain").AIPermissionPresetName,
  ): Promise<import("../types/domain").AssistantPermissions> {
    return apiFetch<import("../types/domain").AssistantPermissions>(`/api/ai/permissions/preset/${presetName}`, {
      method: "POST",
    });
  },

  runTool(
    toolName: import("../types/domain").AssistantToolName,
    args: Record<string, unknown>,
  ): Promise<
    | { status: "EXECUTED"; auditId: string; summary: string; undoable: boolean }
    | { status: "PENDING_APPROVAL"; proposal: import("../types/domain").PendingToolProposal }
    | { status: "DENIED"; settingsUrl: string }
  > {
    return apiFetch(`/api/ai/tools/${toolName}/run`, {
      method: "POST",
      body: JSON.stringify({ args }),
    });
  },

  approveProposal(
    auditId: string,
  ): Promise<{ status: "EXECUTED"; auditId: string; summary: string; undoable: boolean }> {
    return apiFetch(`/api/ai/proposals/${auditId}/approve`, {
      method: "POST",
    });
  },

  rejectProposal(auditId: string): Promise<{ status: "REJECTED"; auditId: string }> {
    return apiFetch(`/api/ai/proposals/${auditId}/reject`, {
      method: "POST",
    });
  },

  getAuditLog(): Promise<import("../types/domain").AiAuditEntry[]> {
    return apiFetch<import("../types/domain").AiAuditEntry[]>("/api/ai/audit");
  },

  undoAction(auditId: string): Promise<{ status: "UNDONE"; auditId: string }> {
    return apiFetch(`/api/ai/audit/${auditId}/undo`, {
      method: "POST",
    });
  },

  chat(
    message: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<{
    message: string;
    providerMode: "live" | "local_fallback";
    proposals?: import("../types/domain").PendingToolProposal[];
    executedActions?: Array<{
      toolName: import("../types/domain").AssistantToolName;
      summary: string;
      auditId: string;
      undoable: boolean;
    }>;
    deniedTools?: Array<{
      toolName: import("../types/domain").AssistantToolName;
      settingsUrl: string;
    }>;
  }> {
    return apiFetch("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    });
  },
};
