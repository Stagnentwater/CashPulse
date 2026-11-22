CashPulse — Master Context & Engineering Specification
1. Project Overview
Product Name: CashPulse

Track: ACE Builders' Hackathon 2026 — Problem Statement 1: Small Business Operations ("The One-Person Back Office")

Target Niche: Solo / 1–5 person Indian service micro-business with zero accounting staff — specifically Dr. Ananya's PhysioCare Studio (an independent physiotherapy & rehab clinic in Hyderabad, India).

Development Strategy (Strict Two-Stage Rollout):

STAGE 1 (Foundation First): A complete, production-grade manual-entry financial back office with user authentication, customer/invoice/bill CRUD, messaging service, toast notifications, high-craft aesthetic dashboard with meaningful charts, and 100% deterministic 30–90 day cash-flow forecasting + "What-If" stress testing.

STAGE 2 (Agentic Upgrade): Layer on a voice-and-text Agentic AI Assistant powered by OpenRouter (openrouter/free with tool calling) featuring user-configurable assistant permissions, approval cards, and full undoable audit logs.

2. Architecture Principles (Non-Negotiable)
Deterministic Math Only for Money: All balances, overdue days, aging buckets, moving-average client delay habits, and 30–90 day cash-flow projections MUST be calculated in pure, unit-testable TypeScript (lib/financeEngine.ts). Never delegate arithmetic to an LLM.

Stage Isolation: Stage 1 must be 100% functional, visually polished, and bug-free with ZERO dependency on external AI APIs. Stage 2 plugs into the exact same state mutations (lib/actions.ts) that Stage 1's manual UI uses.

Permission-Gated Autonomy: In Stage 2, the AI assistant NEVER mutates state directly without passing through lib/permissionGate.ts. Every tool is governed by the user's permission settings (AUTO_ALLOW, ASK_APPROVAL, DENY) plus a configurable monetary auto-approve cap (e.g., max ₹5,000 without confirmation).

Synthetic Data Only: All clinic profiles, patients, phone numbers, and UPI handles are fictional (physiocare@okaxis, +91-98765-00001).

3. Tech Stack
Framework: Next.js 14+ (App Router) + TypeScript (strict mode).

Styling: Tailwind CSS + Lucide React icons + sonner for rich toast notifications.

Charts: Recharts (responsive, custom tooltips, tabular numbers).

State & Persistence:

Client-first Zustand store hydrated to localStorage (keyed per authenticated user) + optional Prisma/SQLite backend route sync, ensuring zero deployment crashes on serverless platforms (Vercel).

Authentication: Clean local/JWT session authentication (Login, Sign Up, Logout, protected dashboard routes) plus a visible "1-Click Demo Login (Dr. Ananya's Clinic)" button on the login screen so judges can test immediately without typing credentials.

AI & Voice (Stage 2):

Speech-to-Text: Browser Web Speech API (SpeechRecognition / webkitSpeechRecognition, en-IN default with hi-IN toggle) + text input fallback + preloaded sample voice transcripts for judges without a mic.

LLM & Tool Calling: OpenRouter Chat Completions API ([https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions), OpenAI-compatible SDK) defaulting to OPENROUTER_MODEL=openrouter/free with automatic tool-calling support and deterministic local fallback if rate-limited.

4. Visual Aesthetic & Design System
Theme: Refined modern fintech light mode (Stripe / Linear / RazorpayX clarity) with optional subtle dark sidebar or crisp white cards on soft slate canvas.

Color Tokens:

App Background: #F8FAFC

Card Surface: #FFFFFF with 1px solid #E2E8F0 and soft elevation

Primary Action / Trust Blue: #1A73E8 (hover #1557B0)

Safe / Paid Emerald: #0F9D58 (tint #E6F4EA)

Warning / Due Soon Amber: #F29900 (tint #FEF7E0)

Danger / Overdue / Cash Crunch Coral: #D93025 (tint #FCE8E6)

Typography: Clean sans-serif (Inter / Plus Jakarta Sans) with font-variant-numeric: tabular-nums on every ₹ figure.

Currency Formatting: Indian numbering system via Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }) (e.g., ₹1,25,000).

Dynamic Dates: All seeded presets compute dates relative to runtime TODAY so overdue counters and upcoming bills are always accurate on any date.

5. Core Data Models (types/domain.ts)ts
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
impactPreview: string;
status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNDONE';
createdAt: string;
snapshotBefore?: string; // JSON snapshot for 1-click Undo
}


---

## 6. STAGE 1 SPECIFICATION — Manual Core Platform

### 6.1 Authentication & Onboarding (`/login`, `/signup`)
- Clean split-screen login/signup page with form validation and error toasts.
- Supports creating a new clinic account (starts with optional quick-seed prompt) OR clicking **"Instant Demo: Dr. Ananya's PhysioCare"** to bypass typing and enter the seeded workspace.
- Top-right profile menu showing clinic name, opening cash settings, and Sign Out.

### 6.2 Aesthetic Dashboard & Meaningful Graphs (`/dashboard`)
1. **Actionable Priority Banner (Top):**
   - Computed by `lib/financeEngine.ts`. Shows exact liquidity danger (e.g., *"Rent of ₹35,000 in 6 days creates a ₹11,500 shortfall -> Chase Rajesh Verma (₹18,000, 14d late) today"*) with 1-click CTA button to open the Messaging Drawer pre-filled for that client.
2. **4 Executive KPI Cards:**
   - `Cash in Bank` (clickable to edit opening cash live)
   - `Total Owed to Me` (count of open invoices)
   - `Overdue Receivables` (highlighted coral when > ₹0)
   - `Cash Safe Until` (exact date cash stays above ₹0, or `"90+ Days Safe"` emerald badge)
3. **Meaningful Interactive Visualizations (3 Core Charts):**
   - **Chart 1 — 30 / 60 / 90-Day Cash Flow Crystal Ball (Area/Line Chart):**
     - Dual curves: `Baseline Cash` (solid blue) vs. `What-If Simulated Cash` (dashed coral).
     - Bold horizontal `₹0` reference line + shaded red zone below zero.
     - Rich hover tooltip listing exact Date, Projected Balance, Inflows on that day, and Bills hitting that day.
   - **Chart 2 — Receivables Aging Breakdown (Horizontal Bar Chart):**
     - Buckets unpaid invoices into: `Upcoming`, `1–7 Days Late`, `8–15 Days Late`, `15+ Days Late` so the owner sees stale money immediately.
   - **Chart 3 — Monthly Cash Inflows vs. Outflows (Grouped Bar Chart):**
     - Compares Expected Collections vs. Scheduled Bills across Month 1, Month 2, and Month 3.
4. **Demo Preset Switcher (Header Bar):**
   - 3 one-click presets for testing & evaluation: `Rent Crunch (Default)`, `Bad Day (5 Late Payers)`, and `Healthy Month`.

### 6.3 Complete Manual CRUD Flows
- **Customers (`/customers` + Slide-Over Profile Drawer):**
  - Add/Edit customer (minimum required: Name + Phone), assign Relationship Tier, view full invoice history, moving-average delay days, and message logs.
- **"Who Owes Me" & Invoices (`/invoices`):**
  - Filterable table (`All`, `Overdue`, `Partial`, `Due Soon`, `Paid`) displaying Client, Amount Due, Days Overdue ("since when"), Client Habit Badge, and quick actions (`Chase`, `Record Payment`, `View Receipt`).
  - Manual `+ New Invoice` modal (fast 3-field core: Customer, Amount, Due Date + optional description) that auto-generates an invoice number and `upi://pay` deep link + QR preview.
  - `Record Payment` modal supporting **Full** or **Partial** payments, plus a **"Simulate Patient Paid via UPI"** button that triggers an instant live payment toast and updates all graphs.
- **Bills & Fixed Expenses (`/bills`):**
  - Manual `+ Add Bill` modal (Title, Category, Amount, Due Date, Recurring Monthly toggle, Deferrable toggle).
  - 1-click `Mark Paid` and `Defer +7 Days` buttons that immediately re-compute the 30–90 day forecast.

### 6.4 Forecasting & "What-If" Stress Tester (`/forecast`)
- Switch horizon between `30 Days`, `60 Days`, `90 Days`.
- Toggle `Include Client Historical Delay Risk` (shifts expected pay dates by `movingAvgDelayDays` for clients with >= 2 past invoices; flags sparse clients transparently).
- Interactive sliders to delay top unpaid customers by `0 to +30 days`.
- 1-click **`Simulate Bad Day (5 Customers Late)`** button and **`Add Unexpected Expense Shock`** form.
- Real-time Crunch Summary panel: `First Crunch Date`, `Lowest Projected Balance`, `Cash Gap to Cover`, and a deterministic `Suggested Recovery Checklist`.

### 6.5 Messaging Service (`/messages` + Global Reminder Drawer)
- Dedicated messaging service layer (`lib/messagingService.ts`) supporting WhatsApp, SMS, and Email templates.
- Pre-built relationship-safe tones (`Gentle`, `Warm`, `Firm`) + toggle for **`Offer 50% Partial UPI Split`**.
- One-click actions:
  - **Send via CashPulse Dispatch (Simulated Live Delivery):** Queues message -> transitions `QUEUED` -> `SENT` -> `DELIVERED` with realistic timing, updates `invoice.lastRemindedAt`, logs into Outbound Message History, and fires toast notifications.
  - **Open in Real WhatsApp (`https://wa.me/...`):** Opens a pre-filled WhatsApp tab with the exact message and UPI payment link.

### 6.6 Toast Notification System (`sonner`)
- Rich, non-intrusive bottom-right toasts with icons & undo actions where appropriate for:
  - Login / Logout
  - Customer / Invoice / Bill created or edited
  - Partial / Full Payment recorded or Simulated UPI received
  - Message queued & delivered
  - Forecast scenario reset / Bad Day activated
  - (Stage 2) AI Tool auto-executed (with `Undo` button), Approval required, or Permission denied.

---

## 7. STAGE 2 SPECIFICATION — Permission-Controlled Agentic Chatbot

### 7.1 Voice & Text Assistant Dock (Floating Drawer / Split Panel)
- Accessible from every page via a sleek floating **"Ask Pulse AI (Voice / Chat)"** button.
- **Voice Input:** Hold or click mic -> live waveform indicator -> browser Web Speech API transcribes spoken English/Hinglish into the input box -> auto-submits or lets user review. Includes 4 clickable **Demo Voice Prompts** so judges without microphones can test agentic tool calling in one click:
  1. *"Finished Kavita's 6 knee sessions today, bill her ₹9,000 due next Tuesday, and add clinic electricity bill ₹4,200 due in 8 days."* (Multi-tool batch!)
  2. *"Rajesh just paid ₹9,000 via UPI as partial payment—update his invoice and check if rent is safe now."*
  3. *"Send a warm WhatsApp reminder to Meera Krishnan with a 50% partial payment option."*
  4. *"What happens to my cash if Rajesh pays 15 days late and my ultrasound machine needs a ₹12,000 repair?"*

### 7.2 OpenRouter Tool-Calling Engine (`app/api/agent/chat/route.ts`)
- Calls `https://openrouter.ai/api/v1/chat/completions` using `process.env.OPENROUTER_API_KEY` and `process.env.OPENROUTER_MODEL || 'openrouter/free'`.
- Passes concise live workspace summary (customers, unpaid invoices, upcoming bills, current cash) + strict OpenAI-compatible `tools` JSON schemas for all 8 assistant tools.
- Supports **multi-tool execution** from a single voice note (e.g., creating an invoice AND adding a bill in one turn).
- **Graceful Fallback:** If OpenRouter returns a `429` rate-limit error or no API key is configured, falls back seamlessly to a deterministic local intent-and-entity parser so the demo never crashes, while displaying a subtle badge (`Live OpenRouter` vs. `Local Fallback`).

### 7.3 Assistant Permissions Console (`/settings/ai-permissions`)
- Dedicated, intuitive control center where the clinic owner configures exactly what the AI assistant is allowed to touch:
  - **Master Kill Switch:** Enable / Pause AI Dashboard Mutations.
  - **Auto-Approve Financial Cap Slider:** e.g., `₹0` to `₹25,000` (default `₹5,000`). Any financial mutation exceeding this amount automatically drops from `AUTO_ALLOW` to `ASK_APPROVAL`.
  - **Per-Capability 3-State Selector (`Auto-Allow` | `Ask Approval` | `Block`):**
    - Create New Invoices (Default: `ASK_APPROVAL`)
    - Record / Mark Payments (Default: `ASK_APPROVAL`)
    - Add New Customers (Default: `AUTO_ALLOW`)
    - Add / Edit Bills (Default: `ASK_APPROVAL`)
    - Defer Supplier Bills (Default: `ASK_APPROVAL`)
    - Send WhatsApp/SMS Reminders to Patients (Default: `ASK_APPROVAL`)
    - Run "What-If" Cash Simulations (Default: `AUTO_ALLOW`)
    - Edit Opening Bank Balance (Default: `DENY`)
  - **1-Click Permission Presets:** `Strict Accountant (Ask Everything)`, `Smart Co-Pilot (Balanced)`, `Full Autopilot (Trusted)`.
- **In-Chat Approval Cards & Audit Log:**
  - When a tool hits `ASK_APPROVAL`, the chat renders a structured **Action Approval Card** showing exact parameters, ₹ impact, and `[Approve & Apply]` / `[Reject]` buttons.
  - When a tool hits `AUTO_ALLOW`, it executes immediately, updates dashboard charts live, triggers a toast with an **`[Undo]`** button, and logs an entry in the **AI Activity Audit Trail**.
  - When a tool hits `DENY`, the assistant politely explains that the owner disabled that permission and offers a quick link to `/settings/ai-permissions`.

---

## 8. Recommended Project Structure
```text
src/
├── app/
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   ├── (workspace)/
│   │   ├── layout.tsx              # Sidebar, Topbar, Preset Switcher, Toast + Stage 2 AI Dock
│   │   ├── dashboard/page.tsx      # Command Center + 3 Meaningful Charts
│   │   ├── invoices/page.tsx       # "Who Owes Me" + Invoice CRUD + Receipt Modal
│   │   ├── customers/page.tsx      # Customer Directory + Slide-Over Profile Drawer
│   │   ├── bills/page.tsx          # Recurring Bills + Deferral Controls
│   │   ├── forecast/page.tsx       # Dedicated 30-90d Crystal Ball & What-If Sandbox
│   │   ├── messages/page.tsx       # Outbound Messaging Service & History
│   │   └── settings/
│   │       └── ai-permissions/page.tsx  # Stage 2 Granular AI Permission Matrix & Audit Log
│   └── api/
│       └── agent/chat/route.ts     # Stage 2 OpenRouter Tool-Calling Orchestrator
├── components/
│   ├── charts/                     # CashForecastChart, AgingBarChart, InflowOutflowChart
│   ├── modals/                     # CreateInvoiceModal, RecordPaymentModal, AddBillModal, ReminderDrawer
│   ├── agent/                      # Stage 2: VoiceChatDock, ApprovalCard, WaveformMic
│   └── ui/                         # Reusable badges, KPI cards, empty states
├── lib/
│   ├── financeEngine.ts            # 100% Pure deterministic forecasting & alert math
│   ├── demoPresets.ts              # 3 dynamic-date clinic presets
│   ├── messagingService.ts         # Template generator + simulated delivery queue + wa.me builder
│   ├── permissionGate.ts           # Stage 2: Evaluates tool calls against user permissions
│   ├── agentTools.ts               # Stage 2: OpenRouter tool schemas + state dispatchers
│   └── format.ts                   # INR currency & relative date helpers
├── store/
│   └── useClinicStore.ts           # Zustand persisted store (Auth, Data, Toasts, AI Permissions, Audit)
└── types/
    └── domain.ts                   # Strict TypeScript domain contracts
9. Definition of Done & QA Gates
Stage 1 Gate (Must pass BEFORE starting Stage 2):

npm run build and tsc --noEmit succeed with 0 errors.

User can sign up / log in / use 1-Click Demo Login and refresh without losing state.

Creating an invoice, recording a partial payment, adding/deferring a bill, or dragging a What-If slider immediately and accurately updates all 3 charts and KPI cards.

Messaging drawer sends simulated WhatsApp/SMS with delivery status transitions, wa.me link works, and toast notifications fire cleanly on every action.

Stage 2 Gate:

Voice input transcribes accurately and triggers single and multi-tool OpenRouter calls.

Changing a tool's permission between AUTO_ALLOW, ASK_APPROVAL, and DENY visibly changes the chatbot's behavior on the very next prompt.

Clicking Undo on an AI action cleanly restores the prior dashboard balance and chart state.