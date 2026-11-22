export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'OVERDUE' | 'PAID';
export type RelationshipTier = 'VIP_LOYAL' | 'REGULAR' | 'NEW' | 'CHRONIC_LATE';
export type ReminderTone = 'GENTLE' | 'WARM' | 'FIRM';
export type MessageChannel = 'WHATSAPP' | 'SMS' | 'EMAIL';
export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  clinicName: string;
  upiId: string;
  safetyBufferINR: number; // Default ₹10,000
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  relationshipTier: RelationshipTier;
  pastInvoiceCount: number;
  pastLateCount: number;
  movingAvgDelayDays: number;
  notes?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string; // e.g., INV-2026-104
  customerId: string;
  serviceDescription: string;
  amount: number;
  amountPaid: number;
  issueDate: string; // YYYY-MM-DD
  dueDate: string;   // YYYY-MM-DD
  status: InvoiceStatus;
  upiLink: string;
  lastRemindedAt?: string;
  createdBy: 'USER' | 'AI_ASSISTANT';
}

export interface UpcomingBill {
  id: string;
  title: string;
  category: 'RENT' | 'SALARY' | 'UTILITY' | 'SUPPLIER' | 'EMI' | 'SHOCK';
  amount: number;
  dueDate: string; // YYYY-MM-DD
  isRecurringMonthly: boolean;
  isDeferrable: boolean;
  deferredDays: number; // 0 by default; updated when user/AI defers
  isPaid: boolean;
}

export interface OutboundMessage {
  id: string;
  invoiceId?: string;
  customerId: string;
  customerName: string;
  channel: MessageChannel;
  tone: ReminderTone;
  includedPartialOption: boolean;
  body: string;
  status: MessageStatus;
  sentAt: string;
  triggeredBy: 'USER' | 'AI_ASSISTANT';
}

export interface WhatIfScenario {
  horizonDays: 30 | 60 | 90;
  invoiceDelayOverrides: Record<string, number>; // invoiceId -> extra days late
  globalLateDaysShift: number;
  extraExpenseShock: { title: string; amount: number; dayOffset: number } | null;
  includeMovingAvgRisk: boolean;
}

// --- STAGE 2: AGENTIC PERMISSIONS & AUDIT ---
export type PermissionMode = 'AUTO_ALLOW' | 'ASK_APPROVAL' | 'DENY';

export type AssistantToolName =
  | 'create_invoice'
  | 'record_payment'
  | 'add_customer'
  | 'add_or_update_bill'
  | 'defer_bill'
  | 'send_payment_reminder'
  | 'run_what_if_simulation'
  | 'update_opening_cash';

export interface AssistantPermissions {
  globalEnabled: boolean;
  maxAutoApproveAmountINR: number; // Above this amount, AUTO_ALLOW downgrades to ASK_APPROVAL
  toolPolicies: Record<AssistantToolName, PermissionMode>;
}

export interface PendingToolProposal {
  id: string;
  toolName: AssistantToolName;
  args: Record<string, unknown>;
  humanSummary: string;
  impactPreview: string | number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNDONE';
  createdAt: string;
  snapshotBefore?: string; // JSON snapshot for 1-click Undo
}

export type AuditStatus = 'AUTO_EXECUTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DENIED' | 'UNDONE';

export interface AiAuditEntry {
  id: string;
  toolName: AssistantToolName;
  humanSummary: string;
  impactInr: number | null;
  status: AuditStatus;
  undoable: boolean;
  createdAt: string;
  undoneAt: string | null;
}

export type AIPermissionPresetName = 'strict_accountant' | 'smart_copilot' | 'full_autopilot';

// --- Stage 1 shared identifiers (needed by presets, engine and store) ---
export type PresetId = 'RENT_CRUNCH' | 'BAD_DAY_5_LATE' | 'HEALTHY_CLINIC';
export type RiskLevel = 'Low' | 'Medium' | 'High';
