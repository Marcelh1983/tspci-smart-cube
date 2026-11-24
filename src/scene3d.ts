// The cube in 3D: 26 cubies with rounded stickers. A turn rotates its layer (a short animation with the colours of
// before), then the colours of after are painted on the cubies in their places; a new turn during an animation ends
// it first, so a fast solver never waits. Dragging a sticker turns its face (the on-screen cube, when onTurn is set);
// dragging next to the cube, touch and turn() move the camera. It renders on demand.
// Without WebGL the constructor throws and the net (viewport.tsx) shows the cube.
import {
  AmbientLight, BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Quaternion, Raycaster,
  Scene, Shape, ShapeGeometry, Spherical, Vector2, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Face, Facelets, Move, NORMAL, STICKERS, applyMove, layerOf } from "./cube";

/** The colours of the faces of a standard cube: white on top, green in front, red on the right. */
export const COLOURS: Record<Face, string> = { U: "#f8fafc", R: "#c8102e", F: "#009b48", D: "#ffd500", L: "#ff6a13", B: "#0046ad" };

const placeKey = (p: readonly number[]) => p.join(",");

const roundedSquare = (size: number, radius: number) => {
  const h = size / 2;
  const s = new Shape();
  s.moveTo(-h + radius, -h);
  s.lineTo(h - radius, -h);
  s.quadraticCurveTo(h, -h, h, -h + radius);
  s.lineTo(h, h - radius);
  s.quadraticCurveTo(h, h, h - radius, h);
  s.lineTo(-h + radius, h);
  s.quadraticCurveTo(-h, h, -h, h - radius);
  s.lineTo(-h, -h + radius);
  s.quadraticCurveTo(-h, -h, -h + radius, -h);
  return new ShapeGeometry(s, 4);
};

type Animation = { pivot: Group; cubies: Group[]; axis: Vector3; angle: number; start: number; duration: number; target: Facelets };

export class CubeView {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(32, 1, 0.1, 100);
  private controls: OrbitControls;
  private world = new Group();
  private cubies = new Map<string, Group>();
  private stickers: MeshStandardMaterial[] = [];
  private animation: Animation | null = null;
  private facelets: Facelets = "";
  private frame = 0;
  private observer: ResizeObserver;
  private disposed = false;
  private back = false;
  private meshes: Mesh[] = [];
  private raycaster = new Raycaster();
  private drag: { x: number; y: number; index: number; id: number } | null = null;
  reducedMotion = false;
  /** Set: dragging a sticker turns its face and tells this; null: dragging only moves the camera. */
  onTurn: ((move: Move) => void) | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true }); // throws without WebGL
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    Object.assign(this.canvas.style, { display: "block", width: "100%", height: "100%", touchAction: "none" });
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);

    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const key = new DirectionalLight(0xffffff, 1.8);
    key.position.set(4, 7, 6);
    const fill = new DirectionalLight(0xffffff, 0.7);
    fill.position.set(-6, -3, -4);
    this.scene.add(key, fill, this.world);

    const body = new BoxGeometry(0.97, 0.97, 0.97);
    const plastic = new MeshStandardMaterial({ color: 0x15171c, roughness: 0.55 });
    const sticker = roundedSquare(0.84, 0.13);
    const z = new Vector3(0, 0, 1);
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const zz of [-1, 0, 1]) {
      if (!x && !y && !zz) continue;
      const cubie = new Group();
      cubie.position.set(x, y, zz);
      cubie.add(new Mesh(body, plastic));
      this.cubies.set(placeKey([x, y, zz]), cubie);
      this.world.add(cubie);
    }
    STICKERS.forEach((s, i) => {
      const material = new MeshStandardMaterial({ color: COLOURS[s.face], roughness: 0.32 });
      const mesh = new Mesh(sticker, material);
      const normal = new Vector3(...s.normal);
      mesh.position.copy(normal).multiplyScalar(0.487);
      mesh.quaternion.copy(new Quaternion().setFromUnitVectors(z, normal));
      mesh.userData.index = i;
      this.cubies.get(placeKey(s.position))!.add(mesh);
      this.stickers[i] = material;
      this.meshes[i] = mesh;
    });

    // capture: before OrbitControls, which does nothing while it is disabled
    this.canvas.addEventListener("pointerdown", this.pointerDown, { capture: true });
    this.canvas.addEventListener("pointermove", this.pointerMove);
    this.canvas.addEventListener("pointerup", this.endDrag);
    this.canvas.addEventListener("pointercancel", this.endDrag);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 16;
    this.controls.addEventListener("change", () => this.requestRender());
    this.resetView();

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  /** The cube as it is now; with the turn that made it, animated (not with reduced motion). */
  show(facelets: Facelets, move: Move | null = null) {
    this.finish();
    // animate only a turn that explains the change (not after several turns at once, or a missed message)
    if (!move || this.reducedMotion || !this.facelets || applyMove(this.facelets, move) !== facelets) {
      this.paint(facelets);
      this.requestRender();
      return;
    }
    const pivot = new Group();
    this.world.add(pivot);
    const cubies = layerOf(move.face).map((p) => this.cubies.get(placeKey(p))!);
    for (const c of cubies) pivot.add(c);
    this.animation = {
      pivot, cubies,
      axis: new Vector3(...NORMAL[move.face]),
      angle: move.amount === 3 ? Math.PI / 2 : (-Math.PI / 2) * move.amount,
      start: performance.now(),
      duration: move.amount === 2 ? 170 : 110,
      target: facelets,
    };
    this.requestRender();
  }

  /** Ends a running animation: the cubies back in their places, the colours of after. */
  private finish() {
    const a = this.animation;
    if (!a) return;
    this.animation = null;
    a.pivot.quaternion.identity();
    for (const c of a.cubies) this.world.add(c);
    this.world.remove(a.pivot);
    this.paint(a.target);
  }

  private paint(facelets: Facelets) {
    this.facelets = facelets;
    for (let i = 0; i < 54; i++) this.stickers[i].color.set(COLOURS[facelets[i] as Face] ?? "#888888");
  }

  // ---- turning a face by dragging a sticker ------------------------------------------------------------------------

  private pointerDown = (e: PointerEvent) => {
    if (!this.onTurn || e.button !== 0) return;
    this.finish();
    const index = this.stickerUnder(e.clientX, e.clientY);
    if (index < 0) return; // next to the cube: the camera
    this.drag = { x: e.clientX, y: e.clientY, index, id: e.pointerId };
    this.controls.enabled = false;
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private pointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) < 12) return;
    const move = this.moveForDrag(d.index, dx, dy);
    this.endDrag();
    if (move) this.onTurn?.(move);
  };

  private endDrag = () => {
    if (this.drag) this.canvas.releasePointerCapture?.(this.drag.id);
    this.drag = null;
    this.controls.enabled = true;
  };

  /** The sticker at a point of the page that faces the camera; -1 for none. */
  private stickerUnder(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    // the matrices are only brought up to date by a render: not yet after the mount, or right after an animation
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return hit ? (hit.object.userData.index as number) : -1;
  }

  /** A point of the cube on the page, in px of the canvas. */
  private project(v: Vector3) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - p.y) / 2) * this.canvas.clientHeight };
  }

  /**
   * The turn a drag of a sticker makes: of the two axes in the plane of the sticker, the one about which the sticker
   * would move most along the drag, in that direction. A drag along a middle layer is no face turn: null.
   */
  private moveForDrag(index: number, dx: number, dy: number): Move | null {
    const s = STICKERS[index];
    const centre = new Vector3(...s.position).addScaledVector(new Vector3(...s.normal), 0.5);
    const from = this.project(centre);
    let best: { axis: Vector3; layer: number; align: number } | null = null;
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
      if (axis.dot(new Vector3(...s.normal)) !== 0) continue;
      // where the sticker goes when its layer turns a little about +axis
      const to = this.project(centre.clone().addScaledVector(new Vector3().crossVectors(axis, centre), 0.2));
      const sx = to.x - from.x;
      const sy = to.y - from.y;
      const length = Math.hypot(sx, sy);
      if (length < 1e-6) continue;
      const align = (sx * dx + sy * dy) / (length * Math.hypot(dx, dy));
      if (!best || Math.abs(align) > Math.abs(best.align)) best = { axis, layer: axis.dot(new Vector3(...s.position)), align };
    }
    if (!best || best.layer === 0 || Math.abs(best.align) < 0.5) return null;
    const normal = best.axis.clone().multiplyScalar(best.layer);
    const face = (Object.keys(NORMAL) as Face[]).find((f) => new Vector3(...NORMAL[f]).equals(normal))!;
    // a positive turn about +axis is counterclockwise for the face on +axis, clockwise for the face on −axis
    return { face, amount: best.layer * Math.sign(best.align) > 0 ? 3 : 1 };
  }

  /** Where a sticker is on the page (client px), for tests. */
  screenOf(index: number) {
    const s = STICKERS[index];
    const p = this.project(new Vector3(...s.position).addScaledVector(new Vector3(...s.normal), 0.5));
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  /** Turns the camera around the cube: degrees to the right and up. */
  turn(right: number, up: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new Spherical().setFromVector3(offset);
    s.theta += (right * Math.PI) / 180;
    s.phi = Math.min(Math.PI - 0.15, Math.max(0.15, s.phi - (up * Math.PI) / 180));
    this.camera.position.copy(new Vector3().setFromSpherical(s).add(this.controls.target));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.requestRender();
  }

  /** The start view: U, F and R; or, from the other side, D, B and L. */
  resetView(back = false) {
    this.back = back;
    const d = back ? -1 : 1;
    this.camera.position.set(5.1 * d, 4.6 * d, 7.6 * d);
    this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.requestRender();
  }

  get showingBack() {
    return this.back;
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender() {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw() {
    const a = this.animation;
    if (a) {
      const t = Math.min(1, (performance.now() - a.start) / a.duration);
      const eased = 1 - (1 - t) * (1 - t);
      a.pivot.quaternion.setFromAxisAngle(a.axis, a.angle * eased);
      if (t >= 1) this.finish();
      else this.requestRender();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** The colours as painted now (for tests). */
  get painted(): Facelets {
    return this.facelets;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown, { capture: true });
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.endDrag);
    this.canvas.removeEventListener("pointercancel", this.endDrag);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
