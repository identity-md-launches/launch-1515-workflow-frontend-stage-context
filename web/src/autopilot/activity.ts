import type { Activity } from "./engine";
export function mergeActivity(current: Activity[], entry: Activity) {
  return [...current.filter((item) => item.id !== entry.id), entry].slice(-200);
}
export function readActivity(key: string): Activity[] {
  const raw = localStorage.getItem(key + ":activity");
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw Error("Invalid activity history.");
  return parsed
    .filter(
      (e): e is Activity =>
        e &&
        typeof e.id === "string" &&
        typeof e.reason === "string" &&
        e.reason.length <= 600 &&
        typeof e.decision === "string" &&
        typeof e.time === "number" &&
        Number.isFinite(e.time) &&
        Number.isFinite(new Date(e.time).getTime()) &&
        e.time > 0 &&
        ["rules", "ai"].includes(e.brain),
    )
    .slice(-200);
}
export function appendActivity(key: string, entry: Activity) {
  const next = mergeActivity(readActivity(key), entry);
  localStorage.setItem(key + ":activity", JSON.stringify(next));
  return next;
}
