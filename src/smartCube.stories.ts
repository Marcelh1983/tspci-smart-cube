import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, userEvent, waitFor } from "storybook/test";
import { afterPaint, lastChange, mountPci, openPci, type MountedPci, type PciArgs } from "../.storybook/tspci";
import { SOLVED, applyMoves, formatMoves, inverseOf, parseMoves, scrambleFor } from "./cube";
import pci from "./index";

const meta = {
  title: "Smart cube",
  render: (args) => mountPci(pci, args),
} satisfies Meta<PciArgs>;
export default meta;
type Story = StoryObj<PciArgs>;

// There is no Bluetooth cube in a test: the stories use the on-screen cube, which goes through the same attempt
// (scramble guide, inspection, clock) as a GiiKER. The decoding of GiiKER messages has node tests (npm test).

/** The record of a response as { name: value }. */
const fields = (response: any) =>
  Object.fromEntries((response?.record ?? []).map((f: any) => [f.name, Object.values(f.base ?? {})[0]]));

const turns = async (mounted: MountedPci, text: string) => {
  for (const m of parseMoves(text)!) mounted.pci.cube().turn(m);
  await afterPaint();
};

const chips = (mounted: MountedPci) => mounted.canvas.getByTestId("scramble").querySelectorAll("li");

export const Default: Story = {
  play: async ({ canvasElement, step }) => {
    const mounted = await openPci(canvasElement);
    const { canvas, pci } = mounted;
    await step("the instruction, connecting, the cube, no results", async () => {
      expect(canvas.getByText(/Connect your smart cube/)).toBeInTheDocument();
      expect(canvas.getByRole("button", { name: "Connect smart cube" })).toBeEnabled();
      expect(canvas.getByTestId("device")).toHaveTextContent("On-screen cube");
      expect(canvas.queryByRole("application", { name: /^The cube/ }) ?? canvas.getByTestId("no-webgl")).toBeInTheDocument();
      expect(canvas.getByText("No attempts yet.")).toBeInTheDocument();
      expect(pci.getResponse()).toBeUndefined();
    });
    await step("a seed of the candidate's own, kept in the state; the first scramble shows", async () => {
      const seed = JSON.parse(pci.getState()).state.seed;
      expect(seed).toMatch(/^[a-z2-9]{6}$/);
      expect([...chips(mounted)].map((li) => li.textContent).join(" ")).toBe(formatMoves(scrambleFor(seed, 20)));
      expect(canvas.getByText(`seed ${seed}`)).toBeInTheDocument();
      expect(canvas.getByRole("img", { name: "The scrambled cube, unfolded" })).toBeInTheDocument();
    });
  },
};

/** Drags with the mouse in the 3D view: from a sticker, by dx and dy pixels. */
const drag = (view: any, index: number, dx: number, dy: number) => {
  const from = view.screenOf(index);
  const canvas = view.canvas as HTMLCanvasElement;
  const at = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, isPrimary: true, pointerType: "mouse" }));
  at("pointerdown", from.x, from.y);
  for (let i = 1; i <= 4; i++) at("pointermove", from.x + (dx * i) / 4, from.y + (dy * i) / 4);
  at("pointerup", from.x + dx, from.y + dy);
};

export const DragAFace: Story = {
  args: { properties: { seed: "drag" } },
  play: async ({ canvasElement, step }) => {
    const mounted = await openPci(canvasElement);
    const { pci } = mounted;
    const view = pci.view();
    if (!view) return; // no WebGL in this browser: the buttons and keys turn the cube (other stories)
    const after = (text: string) => applyMoves(SOLVED, parseMoves(text)!);

    await step("dragging the right column of the front face up turns R", async () => {
      drag(view, 18 + 5, 0, -60); // F, middle row, right
      await afterPaint();
      expect(pci.cube().facelets()).toBe(after("R"));
    });
    await step("down again turns it back", async () => {
      drag(view, 18 + 5, 0, 60);
      await afterPaint();
      expect(pci.cube().facelets()).toBe(SOLVED);
    });
    await step("dragging the top row of the front face to the left turns U", async () => {
      drag(view, 18 + 1, -60, 0); // F, top row, middle
      await afterPaint();
      expect(pci.cube().facelets()).toBe(after("U"));
    });
    await step("a drag along a middle layer turns nothing; next to the cube the view turns", async () => {
      drag(view, 18 + 4, -60, 0); // F centre, sideways: the middle layer
      await afterPaint();
      expect(pci.cube().facelets()).toBe(after("U"));
    });
  },
};

export const SolveWithTheOnScreenCube: Story = {
  args: { properties: { seed: "cito", attempts: "2" } },
  play: async ({ canvasElement, step }) => {
    const mounted = await openPci(canvasElement);
    const { canvas, pci } = mounted;
    const scramble = scrambleFor("cito", 20);

    await step("the on-screen cube: the scramble of the seed, the first turn to make", async () => {
      // without a smart cube, the on-screen cube is there straight away
      expect(canvas.getByTestId("device")).toHaveTextContent("On-screen cube: drag a face to turn it");
      expect(canvas.getByText("Attempt 1 of 2")).toBeInTheDocument();
      expect(canvas.getByTestId("seed")).toHaveTextContent("seed cito");
      expect([...chips(mounted)].map((li) => li.textContent).join(" ")).toBe(formatMoves(scramble));
      expect(canvas.getByTestId("hint")).toHaveTextContent(`Next: ${formatMoves([scramble[0]])}`);
      expect(canvas.getByRole("img", { name: "The scrambled cube, unfolded" })).toBeInTheDocument();
    });

    await step("turning with the buttons follows the scramble", async () => {
      const first = scramble[0];
      const name = { U: "Up", R: "Right", F: "Front", D: "Down", L: "Left", B: "Back" }[first.face];
      await userEvent.click(canvas.getByRole("button", { name: `${name} ${first.amount === 3 ? "counterclockwise" : first.amount === 2 ? "half turn" : "clockwise"}` }));
      expect(chips(mounted)[0]).toHaveClass("line-through");
      expect(chips(mounted)[1]).toHaveAttribute("aria-current", "step");
    });

    await step("scrambled: Start; the inspection counts down from 15", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Scramble it for me" }));
      expect(pci.cube().facelets()).toBe(applyMoves(SOLVED, scramble));
      expect(canvas.getByText("Scrambled! Press Start when you are ready.")).toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "Start" }));
      expect(pci.cube().attempt().phase).toBe("inspection");
      expect(canvas.getByText("Inspection")).toBeInTheDocument();
      expect(canvas.getByTestId("clock").textContent).toMatch(/^1[45]$/);
    });

    await step("the first turn starts the clock; the solved cube stops it", async () => {
      const solution = inverseOf(scramble);
      await turns(mounted, formatMoves(solution.slice(0, 3)));
      expect(pci.cube().attempt().phase).toBe("solving");
      expect(canvas.getByTestId("moves")).toHaveTextContent("3 moves");
      expect(pci.getResponse()).toBeUndefined();
      await turns(mounted, formatMoves(solution.slice(3)));
      expect(canvas.getByText("Solved!")).toBeInTheDocument();
      expect(canvas.getByTestId("moves")).toHaveTextContent(`${solution.length} moves`);
      expect(canvas.getByRole("status")).toHaveTextContent(/^Solved in \d+\.\d\d seconds, 20 moves\.$/);
    });

    await step("the response: a record with the score, the time, the turns, every attempt", async () => {
      const r = fields(pci.getResponse());
      expect(r.score).toBe(1);
      expect(r.maxscore).toBe(1);
      expect(r.solved).toBe(1);
      expect(r.attempts).toBe(1);
      expect(r.moves).toBe(20);
      expect(r.time).toBeGreaterThanOrEqual(0);
      expect(r.seed).toBe("cito");
      expect(r.device).toBe("virtual");
      const results = JSON.parse(r.results as string);
      expect(results[0]).toMatchObject({ seed: "cito", scramble: formatMoves(scramble), moves: 20, solution: formatMoves(inverseOf(scramble)), device: "virtual" });
      expect(fields(await lastChange(mounted)).solved).toBe(1);
      expect(canvas.getByTestId("results").querySelectorAll("tbody tr")).toHaveLength(1);
      expect(canvas.getByTestId("best")).toHaveTextContent(/^Best: \d+\.\d\d$/);
    });

    await step("the next scramble comes from seed-2; after it, no more attempts", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Next scramble" }));
      expect(canvas.getByText("Attempt 2 of 2")).toBeInTheDocument();
      expect(canvas.getByTestId("seed")).toHaveTextContent("seed cito-2");
      const second = scrambleFor("cito-2", 20);
      await turns(mounted, formatMoves(second));
      await userEvent.click(canvas.getByRole("button", { name: "Start" }));
      await turns(mounted, formatMoves(inverseOf(second)));
      expect(canvas.getByText("All attempts done.")).toBeInTheDocument();
      expect(canvas.queryByRole("button", { name: "Next scramble" })).toBeNull();
      expect(fields(pci.getResponse()).attempts).toBe(2);
    });
  },
};

export const WrongTurnsAreUndone: Story = {
  args: { properties: { seed: "guide" } },
  play: async ({ canvasElement, step }) => {
    const mounted = await openPci(canvasElement);
    const { canvas } = mounted;
    const scramble = scrambleFor("guide", 20);
    // a face that is not the next one, nor on its axis
    const wrong = "URFDLB".split("").find((f) => f !== scramble[1].face && f !== scramble[0].face && !["UD", "RL", "FB"].some((a) => a.includes(f) && a.includes(scramble[1].face)))!;

    await step("a wrong turn: undo it first", async () => {
      await turns(mounted, `${formatMoves([scramble[0]])} ${wrong}`);
      expect(canvas.getByTestId("hint")).toHaveTextContent(`Undo: ${wrong}'`);
    });
    await step("undone: the scramble goes on", async () => {
      await turns(mounted, `${wrong}'`);
      expect(canvas.getByTestId("hint")).toHaveTextContent(`Next: ${formatMoves([scramble[1]])}`);
    });
    await step("keys turn the on-screen cube: Shift for counterclockwise", async () => {
      canvas.getByRole("button", { name: "Connect smart cube" }).focus();
      await userEvent.keyboard(wrong.toLowerCase());
      expect(canvas.getByTestId("hint")).toHaveTextContent(`Undo: ${wrong}'`);
      await userEvent.keyboard(`{Shift>}${wrong}{/Shift}`);
      expect(canvas.getByTestId("hint")).toHaveTextContent(`Next: ${formatMoves([scramble[1]])}`);
    });
  },
};

export const GiveUp: Story = {
  args: { properties: { seed: "dnf", inspection: "0" } },
  play: async ({ canvasElement, step }) => {
    const mounted = await openPci(canvasElement);
    const { canvas, pci } = mounted;
    await userEvent.click(canvas.getByRole("button", { name: "Scramble it for me" }));

    await step("without inspection, Start starts the clock", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Start" }));
      expect(pci.cube().attempt().phase).toBe("solving");
      expect(canvas.getByText("Solving")).toBeInTheDocument();
    });
    await step("giving up: a DNF, score 0, no time", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Give up" }));
      expect(canvas.getByTestId("results")).toHaveTextContent("DNF");
      const r = fields(pci.getResponse());
      expect(r).toMatchObject({ score: 0, solved: 0, attempts: 1 });
      expect(r.time).toBeUndefined();
    });
    await step("the next scramble needs a solved cube first", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Next scramble" }));
      expect(canvas.getByTestId("lost")).toHaveTextContent("Solve it first");
      await userEvent.click(canvas.getByRole("button", { name: "Reset the cube" }));
      expect(canvas.queryByTestId("lost")).toBeNull();
      expect(canvas.getByTestId("hint")).toHaveTextContent(`Next: ${formatMoves([scrambleFor("dnf-2", 20)[0]])}`);
    });
  },
};

export const TargetTime: Story = {
  args: { properties: { seed: "fast", targetTime: "0.001", attempts: "1", scrambleLength: "6" } },
  play: async ({ canvasElement, step }) => {
    const mounted = await openPci(canvasElement);
    const { canvas, pci } = mounted;
    const scramble = scrambleFor("fast", 6);
    await step("a short scramble of 6 turns", async () => {
        expect(chips(mounted)).toHaveLength(6);
    });
    await step("solved, but slower than the target: score 0", async () => {
      await turns(mounted, formatMoves(scramble));
      await userEvent.click(canvas.getByRole("button", { name: "Start" }));
      // the clock starts at the first turn
      await turns(mounted, formatMoves(inverseOf(scramble).slice(0, 1)));
      await new Promise((r) => setTimeout(r, 30));
      await turns(mounted, formatMoves(inverseOf(scramble).slice(1)));
      expect(fields(pci.getResponse())).toMatchObject({ score: 0, solved: 1, moves: 6 });
      expect(canvas.getByTestId("best")).toHaveTextContent("Target: 0.001 s or faster");
    });
  },
};

const finished = JSON.stringify({
  state: {
    seed: "saved",
    results: [
      { seed: "saved", scramble: "R U F'", time: 42310, moves: 57, inspection: 8000, solution: "F U' R'", device: "giiker" },
      { seed: "saved-2", scramble: "L D2 B", time: null, moves: 12, inspection: 15000, solution: "", device: "giiker" },
      { seed: "saved-3", scramble: "U2 R' F", time: 38050, moves: 49, inspection: 6400, solution: "F' R U2", device: "giiker" },
    ],
  },
  log: [],
});

export const RestoredState: Story = {
  args: { state: finished },
  play: async ({ canvasElement, step }) => {
    const { canvas, pci } = await openPci(canvasElement);
    await step("the attempts are back, the best time, no more attempts", async () => {
      const rows = canvas.getByTestId("results").querySelectorAll("tbody tr");
      expect(rows).toHaveLength(3);
      expect(rows[1]).toHaveTextContent("DNF");
      expect(canvas.getByTestId("best")).toHaveTextContent("Best: 38.05");
      expect(canvas.getByText("All attempts done.")).toBeInTheDocument();
      expect(fields(pci.getResponse())).toMatchObject({ score: 1, time: 38.05, moves: 49, solved: 2, attempts: 3, seed: "saved", device: "giiker" });
    });
  },
};

export const Review: Story = {
  args: { state: finished, status: "review", properties: { language: "nl" } },
  play: async ({ canvasElement, step }) => {
    const { canvas } = await openPci(canvasElement);
    await step("in review: the results, in Dutch, nothing to connect", async () => {
      expect(canvas.queryByRole("button", { name: "Slimme kubus verbinden" })).toBeNull();
      expect(canvas.getByText(/Verbind je slimme kubus/)).toBeInTheDocument();
      expect(canvas.getByTestId("best")).toHaveTextContent("Beste: 38,05");
      expect(canvas.getByRole("columnheader", { name: "Draaiingen" })).toBeInTheDocument();
    });
  },
};

export const ResponseBack: Story = {
  args: {
    boundTo: {
      RESPONSE: {
        record: [
          { name: "seed", base: { string: "back" } },
          { name: "results", base: { string: JSON.stringify([{ seed: "back", scramble: "R U", time: 12000, moves: 2, inspection: 0, solution: "U' R'", device: "virtual" }]) } },
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const { canvas, pci } = await openPci(canvasElement);
    expect(canvas.getByTestId("results").querySelectorAll("tbody tr")).toHaveLength(1);
    expect(fields(pci.getResponse())).toMatchObject({ time: 12, moves: 2, seed: "back" });
  },
};

export const NoBluetooth: Story = {
  args: { properties: { allowVirtual: "false" } },
  play: async ({ canvasElement, step }) => {
    const { canvas } = await openPci(canvasElement);
    await step("without the on-screen cube there is only the smart cube", async () => {
      expect(canvas.queryByTestId("device")).toBeNull();
      expect(canvas.queryByRole("group", { name: "Turn the on-screen cube" })).toBeNull();
    });
    await step("a browser without Web Bluetooth says so", async () => {
      const had = Object.getOwnPropertyDescriptor(Navigator.prototype, "bluetooth");
      Object.defineProperty(navigator, "bluetooth", { value: undefined, configurable: true });
      try {
        await userEvent.click(canvas.getByRole("button", { name: "Connect smart cube" }));
        await waitFor(() => expect(canvas.getByTestId("message")).toHaveTextContent(/cannot connect to a Bluetooth cube|secure page/));
      } finally {
        delete (navigator as any).bluetooth;
        if (had && !("bluetooth" in navigator)) Object.defineProperty(Navigator.prototype, "bluetooth", had);
      }
    });
  },
};
