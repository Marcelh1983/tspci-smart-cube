// The connection with a GiiKER smart cube over Web Bluetooth (Chrome and Edge on desktop and Android; not Safari or
// Firefox). The page must be https or localhost, and an iframe needs allow="bluetooth". requestDevice must run in the
// click handler of the candidate (the browser shows its own list of devices).
import { Facelets, GIIKER, Move, giikerDecode, moveBetween } from "./cube";

export type CubeChange = { move: Move | null; facelets: Facelets; time: number };

/** Why Bluetooth cannot work here, or null when it may. */
export const bluetoothProblem = (): "unsupported" | "insecure" | null => {
  if (typeof navigator === "undefined" || !(navigator as any).bluetooth) return typeof window !== "undefined" && !window.isSecureContext ? "insecure" : "unsupported";
  return null;
};

export class GiikerCube {
  private device: any;
  private characteristic: any;
  private facelets: Facelets | null = null;

  private constructor(private onChange: (change: CubeChange) => void, private onDisconnect: () => void) {}

  get name(): string {
    return this.device?.name ?? "GiiKER";
  }

  /**
   * Asks the browser for a cube (its own dialog), connects and reads the cube as it is. Rejects with "cancelled" when
   * the candidate closes the dialog, and with the browser's error otherwise.
   */
  static async connect(onChange: (change: CubeChange) => void, onDisconnect: () => void): Promise<{ cube: GiikerCube; facelets: Facelets }> {
    const bluetooth = (navigator as any).bluetooth;
    const cube = new GiikerCube(onChange, onDisconnect);
    let device: any;
    try {
      device = await bluetooth.requestDevice({
        // GiC… and GiS… (GiiKER i3, i3s), Mi Smart Magic Cube, Hi-…
        filters: [{ namePrefix: "Gi" }, { namePrefix: "Mi Smart" }, { namePrefix: "Hi-" }, { services: [GIIKER.service] }],
        optionalServices: [GIIKER.service, GIIKER.systemService],
      });
    } catch (error) {
      if ((error as Error)?.name === "NotFoundError") throw new Error("cancelled");
      throw error;
    }
    cube.device = device;
    device.addEventListener("gattserverdisconnected", () => cube.onDisconnect());
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(GIIKER.service);
    cube.characteristic = await service.getCharacteristic(GIIKER.characteristic);
    const first = giikerDecode(new Uint8Array((await cube.characteristic.readValue()).buffer));
    if (!first) {
      device.gatt.disconnect();
      throw new Error("not a cube");
    }
    cube.facelets = first.facelets;
    cube.characteristic.addEventListener("characteristicvaluechanged", (event: any) => cube.receive(event.target.value));
    await cube.characteristic.startNotifications();
    return { cube, facelets: first.facelets };
  }

  /**
   * A message: the stickers count. The turn is the one between the cube before and now (null when a message was
   * missed and more than one turn makes the difference). A repeat of the same cube is no change.
   */
  private receive(value: DataView) {
    const decoded = giikerDecode(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
    if (!decoded || decoded.facelets === this.facelets) return;
    const before = this.facelets;
    this.facelets = decoded.facelets;
    this.onChange({ move: before ? moveBetween(before, decoded.facelets) : null, facelets: decoded.facelets, time: performance.now() });
  }

  disconnect() {
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // gone already
    }
  }
}
