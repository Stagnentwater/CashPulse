"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { aiApi, ApiError, type SessionUser } from "@/lib/api";
import { formatINR } from "@/lib/format";
import type { AssistantToolName, PendingToolProposal } from "@/types/domain";

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}

let msgSeq = 0;
function nextMsgId(prefix: string): string {
  msgSeq += 1;
  return `${prefix}_${msgSeq}`;
}

interface ExecutedAction {
  toolName: AssistantToolName;
  summary: string;
  auditId: string;
  undoable: boolean;
  impactInr?: number | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposals?: PendingToolProposal[];
  executedActions?: ExecutedAction[];
  deniedTools?: Array<{ toolName: AssistantToolName; settingsUrl: string }>;
  providerMode?: "live" | "local_fallback";
  timestamp: string;
}

const DEMO_PROMPTS = [
  {
    title: "1. Multi-Tool Batch (Invoice + Bill)",
    label: "Bill Kavita ₹9,000 & Add Electricity Bill",
    text: "Finished Kavita's 6 knee sessions today, bill her ₹9,000 due next Tuesday, and add clinic electricity bill ₹4,200 due in 8 days.",
  },
  {
    title: "2. Payment + Rent Check",
    label: "Rajesh Paid ₹9,000 & Check Rent",
    text: "Rajesh just paid ₹9,000 via UPI as partial payment—update his invoice and check if rent is safe now.",
  },
  {
    title: "3. Patient Reminder",
    label: "Warm WhatsApp Reminder to Meera",
    text: "Send a warm WhatsApp reminder to Meera Krishnan with a 50% partial payment option.",
  },
  {
    title: "4. What-If Stress Test",
    label: "What-If: Rajesh Late + Repair Shock",
    text: "What happens to my cash if Rajesh pays 15 days late and my ultrasound machine needs a ₹12,000 repair?",
  },
];

export function VoiceChatDock({ user }: { user?: SessionUser | null } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [providerMode, setProviderMode] = useState<"live" | "local_fallback">("live");
  const [promptsOpen, setPromptsOpen] = useState(true);
  const [actingProposalId, setActingProposalId] = useState<string | null>(null);
  const [undoingAuditId, setUndoingAuditId] = useState<string | null>(null);

  const welcomeGreeting = `Hello ${user?.name || "there"}! I am Pulse AI, your financial operations copilot. I can bill patients, record UPI payments, defer bills, send WhatsApp reminders, or stress-test your cash flow. Tap a demo prompt above or use the mic to speak.`;

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "",
      providerMode: "live",
      timestamp: "Today",
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // Speech Recognition setup
  useEffect(() => {
    if (typeof window === "undefined") return;
    const windowWithSpeech = window as unknown as {
      SpeechRecognition?: new () => ISpeechRecognition;
      webkitSpeechRecognition?: new () => ISpeechRecognition;
    };
    const SpeechClass =
      windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;

    if (SpeechClass) {
      const recognition = new SpeechClass();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-IN";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        setIsListening(false);
        if (event.error !== "no-speech") {
          toast.error("Microphone input error: " + event.error);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      toast.info("Web Speech API is not supported in this browser. Please type your command.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        recognitionRef.current.stop();
        setIsListening(false);
      }
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userMsg: ChatMessage = {
      id: nextMsgId("user"),
      role: "user",
      content: text,
      timestamp: "Today",
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const historyPayload = messages
        .filter((m) => m.id !== "welcome")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await aiApi.chat(text, historyPayload);
      setProviderMode(res.providerMode);

      const assistantMsg: ChatMessage = {
        id: nextMsgId("assistant"),
        role: "assistant",
        content: res.message,
        proposals: res.proposals,
        executedActions: res.executedActions,
        deniedTools: res.deniedTools,
        providerMode: res.providerMode,
        timestamp: "Today",
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If any actions auto-executed, fire toast with undo and trigger refresh
      if (res.executedActions && res.executedActions.length > 0) {
        window.dispatchEvent(new Event("cashpulse:refresh"));
        res.executedActions.forEach((action) => {
          if (action.undoable) {
            toast.success(action.summary, {
              action: {
                label: "Undo",
                onClick: () => void handleUndo(action.auditId),
              },
            });
          } else {
            toast.success(action.summary);
          }
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to get response from Pulse AI.");
      setMessages((prev) => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: "assistant",
          content: "Sorry, I encountered an error while processing that request. Please try again.",
          providerMode: "local_fallback",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (proposalId: string) => {
    setActingProposalId(proposalId);
    try {
      const res = await aiApi.approveProposal(proposalId);
      toast.success(res.summary, {
        action: res.undoable
          ? {
              label: "Undo",
              onClick: () => void handleUndo(res.auditId),
            }
          : undefined,
      });

      // Update proposal state in chat message
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.proposals) return msg;
          return {
            ...msg,
            proposals: msg.proposals.map((p) =>
              p.id === proposalId ? { ...p, status: "APPROVED" as const } : p,
            ),
          };
        }),
      );

      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to approve proposal.");
      }
    } finally {
      setActingProposalId(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    setActingProposalId(proposalId);
    try {
      await aiApi.rejectProposal(proposalId);
      toast.info("Proposal rejected.");

      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.proposals) return msg;
          return {
            ...msg,
            proposals: msg.proposals.map((p) =>
              p.id === proposalId ? { ...p, status: "REJECTED" as const } : p,
            ),
          };
        }),
      );

      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject proposal.");
    } finally {
      setActingProposalId(null);
    }
  };

  const handleUndo = async (auditId: string) => {
    setUndoingAuditId(auditId);
    try {
      await aiApi.undoAction(auditId);
      toast.success("Action undone. State restored.");

      // Mark action as undone in UI
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.executedActions) return msg;
          return {
            ...msg,
            executedActions: msg.executedActions.map((a) =>
              a.auditId === auditId ? { ...a, undoable: false, summary: `${a.summary} (Undone)` } : a,
            ),
          };
        }),
      );

      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to undo action.");
      }
    } finally {
      setUndoingAuditId(null);
    }
  };

  return (
    <>
      {/* Floating Action Dock Trigger */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open Pulse AI Copilot"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-none bg-primary px-4 py-2.5 shadow-xl hover:shadow-2xl transition-all hover:scale-105 active:scale-95 focus:outline-none cursor-pointer border border-border/30"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-none bg-black/15 text-[var(--btn-primary-text)]">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-[var(--btn-primary-text)]" />
          </span>
          <span className="font-heading text-sm font-bold tracking-wide text-[var(--btn-primary-text)]">
            Ask Pulse AI
          </span>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-none bg-emerald opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-none bg-emerald ring-2 ring-[var(--btn-primary-bg)]" />
          </span>
        </button>
      )}

      {/* Floating Chat Drawer */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[620px] max-h-[88vh] w-[95vw] sm:w-[460px] flex-col rounded-none border border-border bg-card shadow-2xl overflow-hidden backdrop-blur-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-card-elevated/80 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-[var(--btn-primary-text)] shadow-xs">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-heading text-sm font-bold text-heading">Pulse AI Copilot</h3>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      providerMode === "live"
                        ? "bg-emerald-tint text-emerald"
                        : "bg-amber-tint text-amber"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        providerMode === "live" ? "bg-emerald" : "bg-amber"
                      }`}
                    />
                    {providerMode === "live" ? "Live OpenRouter" : "Local Fallback"}
                  </span>
                </div>
                <p className="text-[11px] text-muted">
                  {user?.clinicName ? `${user.clinicName} Governance` : "Clinic Governance"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <a
                href="/settings/ai-permissions"
                title="AI Permissions"
                className="rounded-lg p-1.5 text-muted hover:bg-card-elevated hover:text-heading transition-colors"
              >
                <ShieldCheck className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-card-elevated hover:text-heading transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Collapsible Demo Prompts */}
          <div className="border-b border-border bg-card-elevated/50">
            <button
              type="button"
              onClick={() => setPromptsOpen(!promptsOpen)}
              className="flex w-full items-center justify-between px-4 py-1.5 text-[11px] font-semibold text-muted hover:text-heading hover:bg-card-elevated transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                Demo Voice & Batch Prompts (Click to test)
              </span>
              {promptsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {promptsOpen && (
              <div className="grid grid-cols-1 gap-1.5 px-3 py-2 sm:grid-cols-2">
                {DEMO_PROMPTS.map((dp, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => void handleSendMessage(dp.text)}
                    disabled={loading}
                    className="flex flex-col rounded-xl border border-border bg-card p-2 text-left text-xs transition-all hover:border-primary hover:bg-card-elevated hover:shadow-xs group"
                  >
                    <span className="font-heading font-semibold text-primary group-hover:text-primary">{dp.label}</span>
                    <span className="line-clamp-1 font-sans text-[10px] text-muted">{dp.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-[var(--btn-primary-text)] font-sans font-medium rounded-br-xs shadow-xs"
                      : "bg-card-elevated text-body border border-border/80 rounded-bl-xs shadow-xs"
                  }`}
                >
                  <p className="whitespace-pre-wrap">
                    {msg.id === "welcome" ? welcomeGreeting : msg.content}
                  </p>
                </div>
                <span className="mt-1 px-1 text-[10px] text-muted">{msg.timestamp}</span>

                {/* In-Chat Auto-Executed Notification Cards */}
                {msg.executedActions && msg.executedActions.length > 0 && (
                  <div className="mt-2 w-full space-y-2">
                    {msg.executedActions.map((action, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-emerald/30 bg-emerald-tint p-3 text-xs text-body shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald">
                            <Check className="h-3.5 w-3.5" />
                            Auto-Executed
                          </span>
                          <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted border border-border">
                            {action.toolName}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs font-medium text-heading">{action.summary}</p>
                        {action.undoable && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => void handleUndo(action.auditId)}
                              disabled={undoingAuditId === action.auditId}
                              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-0.5 text-[11px] font-semibold text-body hover:bg-card-elevated hover:text-coral transition-colors"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {undoingAuditId === action.auditId ? "Undoing…" : "Undo Action"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* In-Chat Action Approval Cards */}
                {msg.proposals && msg.proposals.length > 0 && (
                  <div className="mt-2 w-full space-y-2">
                    {msg.proposals.map((proposal) => {
                      const isPending = proposal.status === "PENDING";
                      const isApproved = proposal.status === "APPROVED";
                      const isRejected = proposal.status === "REJECTED";

                      return (
                        <div
                          key={proposal.id}
                          className="rounded-xl border border-amber/35 bg-amber-tint p-3.5 text-xs text-body shadow-2xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1 font-semibold text-amber">
                              <AlertCircle className="h-3.5 w-3.5" />
                              Action Requires Approval
                            </span>
                            <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted border border-border">
                              {proposal.toolName}
                            </span>
                          </div>

                          <p className="mt-2 text-xs font-semibold text-heading leading-snug">
                            {proposal.humanSummary}
                          </p>

                          {proposal.impactPreview !== null && proposal.impactPreview !== undefined && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span className="text-[11px] text-muted">Rupee Impact:</span>
                              <span className="tabular-nums font-mono font-bold text-primary">
                                {typeof proposal.impactPreview === "number"
                                  ? formatINR(proposal.impactPreview)
                                  : proposal.impactPreview}
                              </span>
                            </div>
                          )}

                          {isPending && (
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void handleApprove(proposal.id)}
                                disabled={actingProposalId === proposal.id}
                                className="flex-1 rounded-lg bg-primary py-1.5 text-center text-xs font-semibold text-[var(--btn-primary-text)] shadow-xs hover:bg-primary-hover transition-colors"
                              >
                                {actingProposalId === proposal.id ? "Applying…" : "Approve & Apply"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleReject(proposal.id)}
                                disabled={actingProposalId === proposal.id}
                                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-body hover:bg-card-elevated transition-colors"
                              >
                                Reject
                              </button>
                            </div>
                          )}

                          {isApproved && (
                            <div className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-emerald">
                              <Check className="h-3.5 w-3.5" />
                              Approved & Applied to clinic records.
                            </div>
                          )}

                          {isRejected && (
                            <div className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-muted">
                              <XCircle className="h-3.5 w-3.5" />
                              Proposal rejected.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* In-Chat Denied Notices */}
                {msg.deniedTools && msg.deniedTools.length > 0 && (
                  <div className="mt-2 w-full space-y-2">
                    {msg.deniedTools.map((denied, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-coral/30 bg-coral-tint p-3 text-xs text-coral"
                      >
                        <div className="flex items-center gap-1.5 font-semibold">
                          <XCircle className="h-3.5 w-3.5" />
                          Tool Execution Blocked
                        </div>
                        <p className="mt-1 text-[11px] text-body">
                          Execution of <code className="font-mono text-heading">{denied.toolName}</code> was blocked per your AI permission policies.
                        </p>
                        <a
                          href={denied.settingsUrl}
                          className="mt-1.5 inline-block text-[11px] font-semibold text-primary hover:underline"
                        >
                          Modify Permissions in Console →
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 rounded-2xl bg-card-elevated px-4 py-2 text-xs text-muted border border-border">
                <span className="flex h-2 w-2 animate-ping rounded-full bg-primary" />
                Pulse AI is analyzing and preparing clinic actions…
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div className="border-t border-border bg-card p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              {/* Mic Button */}
              <button
                type="button"
                onClick={toggleListening}
                title={isListening ? "Stop listening" : "Click to speak (Web Speech API)"}
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-none transition-all ${
                  isListening
                    ? "bg-coral text-white animate-pulse shadow-md"
                    : "bg-card-elevated text-body border border-border hover:bg-card"
                }`}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isListening && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-coral opacity-75" />
                    <span className="relative inline-flex rounded-none h-3 w-3 bg-coral" />
                  </span>
                )}
              </button>

              {/* Text Input */}
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening to your voice note…" : "Ask Pulse AI or tap mic…"}
                disabled={loading}
                className="flex-1 rounded-none border border-border bg-card-elevated px-4 py-2 text-xs sm:text-sm text-body placeholder:text-[var(--input-placeholder)] focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-sans"
              />

              {/* Send Button */}
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-primary text-[var(--btn-primary-text)] shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
