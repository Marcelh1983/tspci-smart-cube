import "preact/debug";
import { render } from "preact";
import * as ctx from "qtiCustomInteractionContext";
import Interaction, { Controls } from "./interaction";
import style from "./style.css";
import { TAOpci } from "@citolab/tspci-tao";
import { IMSpci, QtiVariableJSON, QtiInteractionChangedDetail, ConfigProperties, PciProperties, QtiRecordItem } from "@citolab/tspci";
import { IStore } from "@citolab/preact-store";

import configProps from "./config.json";
import { Actions, Result, StateModel, initStore, validState } from "./store";
import { Settings, parseSettings } from "./settings";
import { newSeed } from "./cube";
import { textsFor } from "./texts";
// config.json carries editor hints for authoring systems (AUTHORING.md); the build passes only the defaults, as strings
type PropTypes = PciProperties<typeof configProps>;
const defaults = configProps as unknown as PropTypes;

/** HTML attributes arrive in lower case in some delivery systems ("scramblelength"): back to the keys of config.json. */
const normalize = (properties: Record<string, string> = {}) =>
  Object.keys(defaults).reduce((acc, key) => {
    const match = Object.keys(properties).find((k) => k.toLowerCase() === key.toLowerCase());
    if (match !== undefined) acc[key] = properties[match];
    return acc;
  }, {} as Record<string, string>);

/** The best solve: the fastest; null without a solve. */
export const bestOf = (results: Result[]): Result | null =>
  results.filter((r) => r.time !== null).reduce<Result | null>((best, r) => (!best || r.time! < best.time! ? r : best), null);

/**
 * The response, a record: the score (1 for a solve, or with data-target-time for a solve that fast), the best time in
 * seconds and its moves, the number of attempts and solves, the seed, the device and every attempt as JSON.
 */
export const responseOf = (s: Settings, state: StateModel): QtiVariableJSON | undefined => {
  if (!state.results.length) return undefined;
  const best = bestOf(state.results);
  const score = best && (s.targetTime === 0 || best.time! <= s.targetTime * 1000) ? 1 : 0;
  const record: QtiRecordItem[] = [
    { name: "score", base: { integer: score } },
    { name: "maxscore", base: { integer: 1 } },
    ...(best ? [{ name: "time", base: { float: best.time! / 1000 } }, { name: "moves", base: { integer: best.moves } }] : []),
    { name: "solved", base: { integer: state.results.filter((r) => r.time !== null).length } },
    { name: "attempts", base: { integer: state.results.length } },
    { name: "seed", base: { string: state.seed } },
    { name: "device", base: { string: [...new Set(state.results.map((r) => r.device))].join(";") } },
    { name: "results", base: { string: JSON.stringify(state.results) } },
  ];
  return { record } as QtiVariableJSON;
};

class App implements IMSpci<PropTypes>, TAOpci {
  typeIdentifier = "smartCube";
  store: IStore<StateModel, Actions>;
  shadowdom: ShadowRoot; // implementation detail
  config: ConfigProperties<PropTypes>;
  settings: Settings;
  private controls: Controls | null = null;

  /** Only the module's own object registers; every interaction gets an object of its own (getInstance). */
  constructor(register = true) {
    if (register && ctx) {
      ctx.register(this);
    }
  }

  getInstance = (dom: HTMLElement, config: ConfigProperties<PropTypes>, stateString: string): App =>
    new App(false).setup(dom, config, stateString);

  private setup = (dom: HTMLElement, config: ConfigProperties<PropTypes>, stateString: string): App => {
    config.properties = { ...defaults, ...normalize(config.properties as Record<string, string>) }; // defaults, then the item's
    this.config = config;
    this.settings = parseSettings(this.config.properties as Record<string, unknown>);

    this.store = initStore({ seed: "", results: [] });
    if (stateString) {
      try {
        // getState() saves { state, log }
        const saved = JSON.parse(stateString);
        const state = validState(saved?.state);
        if (state) this.store.restoreState(state, saved.log ?? []);
      } catch {
        // not a state of this PCI: start empty
      }
    }

    this.shadowdom = dom.shadowRoot ?? dom.attachShadow({ mode: "open" });

    if (this.config.boundTo && Object.keys(this.config.boundTo).length > 0) {
      const response = this.config.boundTo[Object.keys(this.config.boundTo)[0]];
      if (!stateString && response && (response as any).record) this.setResponse(response);
    }
    // the item's seed, or one of the candidate's own, kept in the state so a reload gives the same scrambles
    const seed = this.settings.seed || this.store.getState().seed || newSeed();
    if (this.store.getState().seed !== seed) this.store.dispatch({ type: "SEED", payload: { seed } });

    this.render();

    // From here on, tell the Delivery System when the interaction changes (not for what it handed us above)
    this.store.subscribe(() => {
      const event: QtiInteractionChangedDetail = {
        interaction: this,
        responseIdentifier: this.config.responseIdentifier,
        valid: true,
        value: this.getResponse(),
      };
      dom.dispatchEvent(new CustomEvent("qti-interaction-changed", { detail: event }));
    }, { immediate: false });

    this.config.onready && this.config.onready(this);
    return this;
  };

  render = () => {
    this.settings = parseSettings(this.config.properties as Record<string, unknown>); // trigger() may have changed them
    const s = this.settings;
    const t = textsFor(s.language);
    render(null, this.shadowdom);
    const css = document.createElement("style");
    css.innerHTML = style;
    this.shadowdom.appendChild(css);
    const prompt = this.config.properties.prompt === defaults.prompt ? t.defaultPrompt : s.prompt;
    const readOnly = this.config.status === "review" || this.config.status === "solution";
    render(
      <Interaction prompt={prompt} settings={s} store={this.store} texts={t} readOnly={readOnly}
        seed={s.seed || this.store.getState().seed} controls={(c) => (this.controls = c)} />,
      this.shadowdom
    );
  };

  off = () => { }; // called when setting correct response in tao
  on = (val) => { };

  trigger = (event: string, value: any) => {
    const key = Object.keys(defaults).find((k) => k.toLowerCase() === event.toLowerCase()) ?? event;
    this.config.properties[key] = value;
    window.requestAnimationFrame(() => this.render());
  };

  /** Nothing until the first attempt ends; then a record (responseOf). */
  getResponse = (): QtiVariableJSON | undefined => responseOf(this.settings, this.store.getState());

  // the store tells the interaction (and the Delivery System) about the reset
  resetResponse = () => {
    this.store.reset();
  };

  /** A response back in the interaction: the attempts from its results field. */
  setResponse = (response: QtiVariableJSON) => {
    const fields = (response as any)?.record as QtiRecordItem[] | undefined;
    const text = fields?.find((f) => f?.name === "results")?.base?.string;
    try {
      const state = validState({ seed: fields?.find((f) => f?.name === "seed")?.base?.string ?? "", results: JSON.parse(String(text)) });
      if (state) this.store.dispatch({ type: "RESTORE", payload: state });
    } catch {
      console.error(`couldn't restore the response: ${JSON.stringify(response)}`);
    }
  };

  oncompleted = () => {
    this.store.unsubscribeAll();
    render(null, this.shadowdom); // disconnects the cube and frees the WebGL context
  };

  getState = () =>
    JSON.stringify({
      state: this.store.getState(),
      log: this.store.getActions(),
    });

  /** For tests: the on-screen cube's turns, the attempt and the cube now. Null before the first render. */
  cube = (): Controls | null => this.controls;

  /** The 3D view, for tests. Null without WebGL. */
  view = () => (this.shadowdom?.querySelector("[data-testid=viewport]") as any)?.cubeView ?? null;
}

export default new App();
