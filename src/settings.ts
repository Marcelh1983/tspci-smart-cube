// The data- attributes of the interaction, as text, into checked settings.
import { Language, languageOf } from "./texts";

export type Settings = {
  prompt: string;
  /** The seed of the scrambles; empty: a seed of the candidate's own (kept in the state). */
  seed: string;
  scrambleLength: number;
  /** Seconds of inspection before the clock starts by itself; 0: the clock starts at Start. */
  inspection: number;
  attempts: number;
  /** Seconds: a solve this fast or faster scores 1; 0: any solve scores 1. */
  targetTime: number;
  allowVirtual: boolean;
  height: number;
  language: Language;
};

const isTrue = (v: unknown) => String(v).toLowerCase() === "true";
const intOr = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number.parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
const numberOr = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number.parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export const parseSettings = (p: Record<string, unknown>): Settings => ({
  prompt: String(p.prompt ?? ""),
  seed: String(p.seed ?? "").trim().slice(0, 40),
  scrambleLength: intOr(p.scrambleLength, 20, 5, 40),
  inspection: intOr(p.inspection, 15, 0, 60),
  attempts: intOr(p.attempts, 3, 1, 12),
  targetTime: numberOr(p.targetTime, 0, 0, 3600),
  allowVirtual: p.allowVirtual === undefined ? true : isTrue(p.allowVirtual),
  height: intOr(p.height, 380, 240, 800),
  language: languageOf(p.language),
});
