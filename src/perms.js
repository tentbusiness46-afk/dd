/** Sections the super admin can show or hide for each admin (admins are view-only). */
export const PERMS = [
  { key: "leads", label: "Leads list", help: "See their leads, the caller and status" },
  { key: "phones", label: "Customer phone numbers", help: "When off, numbers are partly hidden, like 98XXXXX210" },
  { key: "notes", label: "Call notes", help: "Callers' remarks and each lead's call history" },
  { key: "followUps", label: "Follow-ups due", help: "Their leads waiting for a call-back" },
  { key: "calls", label: "Call stats", help: "Calls made, pick-up rate and the calling funnel" },
  { key: "callerPerformance", label: "Caller performance", help: "Calls, pick-ups and sales per caller, on their leads" },
  { key: "sources", label: "Lead sources", help: "Their leads broken down by source" },
  { key: "export", label: "Export to Excel", help: "Download the leads they can see" },
];
const DEFAULT_ON = ["leads", "followUps", "calls"];

/** Super admin sees everything, including real money figures. */
export const allPerms = () => ({ ...Object.fromEntries(PERMS.map((p) => [p.key, true])), revenue: true, expenses: true, roi: true });
export const defaultPerms = () => ({ ...Object.fromEntries(PERMS.map((p) => [p.key, DEFAULT_ON.includes(p.key)])), revenue: false });

export function parsePerms(json) {
  let saved = {};
  try { saved = JSON.parse(json || "{}"); } catch {}
  const out = defaultPerms();
  for (const k of Object.keys(out)) if (k in saved) out[k] = !!saved[k];
  return out;
}
export function cleanPerms(input, base = defaultPerms()) {
  const out = { ...base };
  for (const k of Object.keys(out)) if (input && k in input) out[k] = !!input[k];
  return out;
}
