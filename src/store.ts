import { Store } from "@citolab/preact-store";
import { parseMoves } from "./cube";

/** A finished attempt: solved (time in ms) or not (time null, DNF). */
export type Result = {
  seed: string;
  scramble: string;
  time: number | null;
  moves: number;
  /** ms of inspection used before the first turn. */
  inspection: number;
  solution: string;
  device: "giiker" | "virtual";
};

/** The actions, as { type: payload }: dispatch and addReducer only accept these. */
export type Actions = {
  /** The candidate's own seed, when the item has none. */
  SEED: { seed: string };
  RESULT: { result: Result };
  RESTORE: StateModel;
};

export type StateModel = {
  seed: string;
  results: Result[];
};

export const initStore = (initialState: StateModel) => {
  const store = new Store<StateModel, Actions>(initialState);
  store.addReducer("SEED", (state, { seed }) => ({ ...state, seed }));
  store.addReducer("RESULT", (state, { result }) => ({ ...state, results: [...state.results, result] }));
  store.addReducer("RESTORE", (_state, next) => next);
  return store;
};

const MAX_RESULTS = 12;

const validResult = (r: any): Result | null => {
  if (!r || typeof r !== "object" || typeof r.scramble !== "string" || !parseMoves(r.scramble)) return null;
  const time = typeof r.time === "number" && Number.isFinite(r.time) && r.time >= 0 ? r.time : null;
  const solution = typeof r.solution === "string" && parseMoves(r.solution) ? r.solution : "";
  return {
    seed: typeof r.seed === "string" ? r.seed.slice(0, 50) : "",
    scramble: r.scramble,
    time,
    moves: Number.isInteger(r.moves) && r.moves >= 0 ? r.moves : 0,
    inspection: typeof r.inspection === "number" && r.inspection >= 0 ? r.inspection : 0,
    solution,
    device: r.device === "giiker" ? "giiker" : "virtual",
  };
};

/** A state from getState() or a response, checked. */
export const validState = (value: any): StateModel | null => {
  if (!value || typeof value !== "object") return null;
  const results = Array.isArray(value.results) ? value.results.map(validResult).filter(Boolean).slice(0, MAX_RESULTS) : [];
  return { seed: typeof value.seed === "string" ? value.seed.slice(0, 40) : "", results };
};
