import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract the transaction type from a system journal entry description.
 * System-posted entries are written as "<Mapping Label> — <reference/notes>",
 * e.g. "Loan Repayment — Repayment #12 for Loan #8". Manual entries do not
 * follow this pattern and are labelled as "Manual / Other".
 */
export function getTransactionType(description: string): string {
  if (!description) return "—";
  const idx = description.indexOf(" — ");
  if (idx === -1) return "Manual / Other";
  return description.slice(0, idx);
}
