import type { MessageStatus, ReminderTone } from "../types/domain";
import { formatINR } from "./format";

export interface ReminderBodyInput {
  customerName: string;
  clinicName: string;
  amountDueINR: number;
  upiLink: string;
  tone: ReminderTone;
  includePartialOption: boolean;
  invoiceNumber: string;
}

function openingLine(
  tone: ReminderTone,
  customerName: string,
  clinicName: string,
  invoiceNumber: string,
  amountText: string,
): string {
  switch (tone) {
    case "GENTLE":
      return `Hi ${customerName}, this is a gentle reminder from ${clinicName}. Invoice ${invoiceNumber} for ${amountText} is still open.`;
    case "WARM":
      return `Hello ${customerName}! Hope you're doing well. A quick note from ${clinicName}: invoice ${invoiceNumber} for ${amountText} is still pending. Thank you so much!`;
    case "FIRM":
      return `Dear ${customerName}, invoice ${invoiceNumber} from ${clinicName} for ${amountText} is now overdue. Please clear it at the earliest.`;
  }
}

/** WhatsApp-style reminder body. The UPI link is always the final line. */
export function buildReminderBody({
  customerName,
  clinicName,
  amountDueINR,
  upiLink,
  tone,
  includePartialOption,
  invoiceNumber,
}: ReminderBodyInput): string {
  const amountText = formatINR(amountDueINR);
  const parts = [openingLine(tone, customerName, clinicName, invoiceNumber, amountText)];

  if (includePartialOption) {
    const half = Math.round(amountDueINR / 2);
    parts.push(
      `Need a little time? You can pay 50% now (${formatINR(half)}) using the same link below.`,
    );
  }

  parts.push(`Pay via UPI: ${upiLink}`);
  return parts.join("\n\n");
}

/** Builds a wa.me link. Ten-digit numbers get the India country code 91. */
export function buildWhatsAppLink(phone: string, body: string): string {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(body)}`;
}

export const STATUS_STEPS: MessageStatus[] = ["QUEUED", "SENT", "DELIVERED"];

/** Advances a message along QUEUED -> SENT -> DELIVERED. DELIVERED and FAILED are terminal. */
export function nextStatus(current: MessageStatus): MessageStatus {
  switch (current) {
    case "QUEUED":
      return "SENT";
    case "SENT":
      return "DELIVERED";
    case "DELIVERED":
    case "FAILED":
      return current;
  }
}
