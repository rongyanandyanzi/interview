import type { InterviewHistoryItem } from "@/lib/types";

export const HISTORY_KEY = "voice-mock-interview-history-v1";
const MAX_HISTORY = 12;

export function loadHistory(storage: Pick<Storage, "getItem">): InterviewHistoryItem[] {
  const raw = storage.getItem(HISTORY_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryItem(
  storage: Pick<Storage, "getItem" | "setItem">,
  item: InterviewHistoryItem
) {
  const current = loadHistory(storage).filter((historyItem) => historyItem.id !== item.id);
  const next = [item, ...current].slice(0, MAX_HISTORY);
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}
