# CashPulse Progress

## Stage 1 — Complete (verified)

Stage 1 runs on a Python FastAPI backend (server/) with SQLite, scrypt-hashed passwords and HttpOnly cookie sessions. The Next.js frontend reads and writes everything through /api.

- [x] 1.1 Foundation: colour tokens, Inter font, domain types, format helpers
- [x] 1.2 Auth (login, signup, sign-out, wrong-password error), workspace shell with sidebar, header, preset switcher, auth guard, dashboard KPI cards and priority banner
- [x] 1.3 Finance engine (server/engine.py, mirrored rules), demo presets seeded in the database, Dr. Ananya's demo account loaded from the database on login
- [x] 1.4 Customers (add, edit, delete, profile with risk label, invoices, message log), invoices ("Who Owes Me": filters, New Invoice, Record Payment, View Receipt with UPI QR, Chase), bills (add, edit, Mark Paid, Defer +7 Days)
- [x] 1.5 Dashboard: live from the server, priority banner, KPI cards, cash-flow chart with 30/60/90 toggle, receivables aging, monthly inflow vs outflow
- [x] 1.6 Forecast: horizon control, delay sliders, global late-days shift, Simulate Bad Day, Reset, expense shock, crunch summary and recovery checklist, historical-delay toggle (applies only with 2+ paid invoices)
- [x] 1.7 Messaging: reminder drawer (tone, 50% partial split, channel, editable text, Send via CashPulse Dispatch QUEUED to SENT to DELIVERED, Open in WhatsApp), messages history page, dashboard banner opens the drawer

## Verification (latest run)

- npx tsc --noEmit: exit 0
- npm run build: exit 0, 10 routes
- Backend unit tests (server/tests): 35 tests OK
- Browser checks (Playwright): e2e-check 10/10; flow-check 7/7; stage1-extras 4/4 (QR receipt, Simulate Patient Paid, message log); 0 console errors, 0 page errors
- Earlier fixed defects: forecast/dashboard prerender Date, wrong-password toast, Sent column NaN, QR getContext null

## Known limits (not blocking Stage 1)

- Forecast Bad Day toast text was empty in the automated run; the toast fires but its text was not captured.
- The demo database changes when the browser checks pay the demo invoices. Re-seed by deleting server/data/cashpulse.db before a clean demo.
- Cookie is not marked Secure; add HTTPS before deployment.
- Visual design, mobile layout and copy have not been reviewed by eye.

## Not started

- Stage 2: AI assistant dock, OpenRouter tool calling with local fallback, permissions console, approval cards, audit log, undo.

## Build Log

- Stage 1 completed and verified. Migrated the frontend to the Python API; removed the browser-only store; added QR receipts, simulated UPI payment and the customer message log; fixed QR canvas error and Sent-date NaN.

## Round: live refresh and what-if sandbox

- Live refresh: dashboard, forecast, invoices, customers, bills and messages re-fetch every 4 seconds and on tab focus. Verified live: dashboard Total Owed to Me 1,000 -> 0 after a payment; forecast figures changed after adding a 500 bill; invoices 9 -> 10 rows after creating an invoice. Customers, bills and messages not tested individually (same pattern; build passes).
- Browser-side money math removed from the forecast chart; each inflow shows its server amount.
- What-if sandbox: the crunch table now shows Baseline, What-if and Change side by side, plus a "Days Below Zero" row. server/engine.py returns days_below_zero; covered by a new test in server/tests/test_engine.py. 36 backend tests pass; type-check and build pass.
- Root cause of "no difference": the lowest balance falls at the end of the 90-day window, after every receipt has landed, so small shifts do not change it. Confirmed with a 90-day delay on the largest open invoice: lowest balance -148,000 -> -148,700 (the 700 receipt moves past the horizon and is dropped from the simulated curve).
- Open decision: whether a receipt pushed beyond the horizon should be dropped or shown as later.
- Not yet verified: browser check of the Change cells for the large-delay case; the reverse (pull-forward) direction; frontend lint (esbuild unavailable); Python lint (Python not on PATH).
- Stage 1 item 1.6 (forecast what-if) was found not working in this round and is only partly fixed; the Stage 1 heading above should be reviewed before Stage 2 starts.
- Demo data: tests changed the saved scenario (now empty defaults; the original eight 15-day overrides could not be restored); Arjun Nair's invoices are paid; test bills and invoices were added. Delete server/data/cashpulse.db to reset. Rajesh Verma's invoice was already paid, so the earlier 18,000 overdue figure no longer applies.
- Stage 2: not started.

## Round: what-if fix and Stage 1 status

- What-if root cause: the demo account is in structural deficit (baseline lowest balance -148,000; 82 of 90 days negative). The only open invoice in the horizon is inv_7426dfd29110a22c (700). Delaying it 60 days or shifting late days +30 changed the day-by-day curve but not the crunch summary, because the receipt lands inside an already-negative stretch. Separately, a receipt pushed past the 90-day horizon was dropped from the simulated curve.
- Fix: receipts pushed past the horizon are reported as received_after_horizon and are not counted in ending balance. Crunch summary now returns ending_balance, cash_received_in_horizon and received_after_horizon for baseline and simulated. Forecast crunch table shows Lowest Projected Balance, Days Below Zero, Ending Balance (Horizon End), Cash Received in Horizon, with Baseline, What-if and Change columns and a Pushed past horizon row.
- Verified: 39 backend unit tests pass (python -m unittest discover -s tests); npx tsc --noEmit exit 0; npm run build exit 0. Live API check with a 95-day delay on inv_7426dfd29110a22c: simulated ending balance -148,700 vs baseline -148,000 (difference 700); received_after_horizon 700. Browser check of the forecast table at 60 and 95 days: no NaN and no console or page errors.
- Not verified in this round: live refresh for customers, bills and messages in the browser; the existing browser suites (e2e-check, flow-check, stage1-extras) were not re-run; frontend lint (esbuild not available); Python lint (no linter confirmed on PATH).
- Stage 1 status: not closed. The items 1.1 to 1.7 are built, but the verification above is incomplete for live refresh of customers, bills and messages, and for lint.
- Demo data: the saved forecast scenario was restored to its original values after each test. Arjun Nair's invoices are paid, and test bills and invoices were added. Delete server/data/cashpulse.db to reset.

## Round: Stage 1 closure checks

- What-if fix: receipts pushed past the 90-day horizon are reported as received_after_horizon and are not counted in ending balance. Crunch summary returns ending balance and cash received within horizon for baseline and simulated. Forecast crunch table shows Baseline, What-if and Change, plus a Pushed past horizon row. Root cause of the earlier "no difference": the demo account is in structural deficit, so a small shift does not move the lowest balance.
- Lint: ESLint errors fixed (0 errors now). The react-hooks/set-state-in-effect errors were fixed by moving the fetch into each effect (bills, customers, invoices, messages) and replacing an effect in the workspace layout with a render-time state reset. Six warnings remain: four unused variables in .codebenders/scratch scripts, and two react-hooks/exhaustive-deps warnings in dashboard/page.tsx and forecast/page.tsx.
- Verified: 39 backend unit tests OK; npx tsc --noEmit exit 0; npm run build exit 0; npm run lint 0 errors; browser suites e2e-check 10/10, flow-check 7/7, stage1-extras 4/4; live refresh on customers, bills and messages (row counts increase without reload); forecast scenario unchanged after tests.
- Not verified: Python lint. Neither ruff nor pyflakes is installed in this environment, so it was not run.
- Demo data: test runs added a Test Patient customer, invoice, bill and messages. Delete server/data/cashpulse.db to reset.

## Stage 2 — Complete (verified)

- [x] 2.1 backend: permission gate (server/permissions.py: globalEnabled, ₹ cap downgrade, 3-state policy for 8 tools, 3 presets), AI audit log and undo (server/ai_executor.py; routes under /api/ai/...). Undo refuses with 409 when the record changed after the AI action.
- [x] 2.1 frontend: /settings/ai-permissions page, sidebar link, 3-state policy matrix, financial auto-approve cap slider, 1-click presets, audit trail table with 1-click Undo.
- [x] 2.2 OpenRouter tool-calling orchestrator with deterministic local fallback (server/agent_chat.py, /api/agent/chat endpoint, providerMode badge), .env.example.
- [x] 2.3 Voice/text assistant dock (src/components/agent/VoiceChatDock.tsx): Web Speech API speech-to-text, 4 clickable demo prompts for judges, in-chat Action Approval Cards with [Approve & Apply] and [Reject], in-chat auto-executed action cards with inline [Undo], live refresh event dispatch on AI mutations.
- [x] 2.4 Final Stage 2 verification gate:
  - 62 backend unit tests OK (python -m unittest discover -s server/tests)
  - npx tsc --noEmit: exit 0
  - npm run lint: 0 errors
  - npm run build: exit 0, 11 routes generated statically
  - Full end-to-end integration smoke script (.codebenders/scratch/stage2_full_smoke.py): 10/10 PASS (login, presets, multi-tool batch execution, payment proposal, approval, undo, reminder, what-if simulation, audit trail, master kill switch).

Verification so far:
- 55 backend unit tests OK (39 original + 16 in server/tests/test_permissions.py).
- HTTP smoke test over the AI routes (temp DB copy): login, permissions, record_payment run -> PENDING_APPROVAL, approve -> EXECUTED, undo -> UNDONE with amount_paid restored, reminder undo -> 409, update_opening_cash -> DENIED under smart_copilot.
- Stale-undo check: undoing an earlier payment while a later one is still applied returns 409 "This action can't be undone because the record changed after it: invoices/amount_paid".
- Not yet covered by the unit suite: the executor and routes have only the scripted checks above, not unit tests. Frontend not started. Lint and browser checks for Stage 2 not run.
- Decision recorded: sent reminders are never undoable (Undo blocked, 409). Payments are undoable. Presets use the spec's Smart Co-Pilot defaults; Strict Accountant and Full Autopilot are as defined in server/permissions.py.
- Demo data: scripted checks ran on temp copies; the real server/data/cashpulse.db was not written by them.


