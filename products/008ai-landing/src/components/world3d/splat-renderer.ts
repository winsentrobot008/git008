/**
 * splat-renderer - the splat viewport engine behind the world3d canvas.
 *
 * Framework-free on purpose: it owns one canvas, its input listeners and its
 * animation frame, while React only mounts it and pushes clouds into it. Nothing
 * here allocates per frame, and nothing touches the DOM outside the given canvas.
 *
 * Every sample is drawn as a single `gl_PointSize` sphere impostor shaded from
 * `gl_PointCoord`. That means one draw call, real depth-buffer occlusion and no
 * per-frame sorting: the cloud reads as a lit surface while the CPU work per
 * frame stays constant regardless of how many samples the reconstruction has.
 *
 * A 2D canvas fallback covers the rare browser without WebGL2. It shares the same
 * camera and input handling and only differs in how a frame is painted.
 */

import type { SplatCloud } from "@/lib/world3d/types";
import {
  createMat4,
  lookAt,
  multiply,
  perspective,
  toRadians,
  transformPoint,
  type Mat4,
} from "@/lib/world3d/mat4";
import { traceCounter, traceFrame, traceMark, traceMeasure } from "@/lib/world3d/telemetry";


const FOV_DEGREES = 45;
const NEAR_PLANE = 0.05;
const FAR_PLANE = 460;
const MIN_DISTANCE = 1.1;
const MAX_DISTANCE = 320;
/** Degrees of orbit per pixel of drag. */
const ORBIT_SENSITIVITY = 0.28;
const INERTIA_DECAY = 0.9;
const AUTO_ROTATE_DEGREES_PER_SECOND = 5.5;
const IDLE_SECONDS_BEFORE_ROTATE = 4;
const MAX_PITCH = 84;
/**
 * Share of the bounding sphere used for the initial framing. The demo carriage is
 * 20 m long and under 3 m tall, so framing the true bounding sphere leaves it a
 * thin sliver: 0.67 puts the whole car across the frame while staying close enough
 * to read the interior.
 */
const FIT_FRACTION = 0.67;
/** How far the pan target may drift from the model centre, in bounding radii. */
const TARGET_CLAMP = 2.2;
/** Ceiling for the 2D fallback: it paints on the CPU, unlike the GPU path. */
const FALLBACK_MAX_DOTS = 6000;

/**
 * Bytes of vertex data copied to the GPU per frame. The whole cloud in one
 * `bufferData` is a visible stall - a 420k-point cloud is 11.8 MB across the three
 * buffers - so the upload is sliced and the pass draws what has landed.
 */
const UPLOAD_SLICE_BYTES = 2 * 1024 * 1024;



const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aScale;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uPointScale;
out vec3 vColor;
out float vFade;
void main() {
  vec4 viewPosition = uView * vec4(aPosition, 1.0);
  gl_Position = uProjection * viewPosition;
  float distance = max(-viewPosition.z, 0.05);
  gl_PointSize = clamp(aScale * uPointScale / distance, 1.7, 64.0);
  // Slight distance fade so the far end of a long car recedes instead of
  // competing with the near surfaces.
  vFade = clamp(1.0 - (distance - 10.0) / 46.0, 0.62, 1.0);
  vColor = aColor;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFade;
out vec4 fragColor;
void main() {
  vec2 offset = gl_PointCoord * 2.0 - 1.0;
  float radius2 = dot(offset, offset);
  if (radius2 > 1.0) discard;
  // Sphere impostor: the sample gets a normal, so it is shaded like a surface
  // instead of being a flat dot.
  vec3 normal = normalize(vec3(offset.x, -offset.y, sqrt(max(1.0 - radius2, 0.0))));
  float lambert = max(dot(normal, normalize(vec3(0.42, 0.6, 0.68))), 0.0);
  float rim = pow(1.0 - sqrt(max(1.0 - radius2, 0.0)), 2.0);
  vec3 lit = vColor * (0.44 + 0.56 * lambert) * vFade + vec3(0.09 * rim);
  fragColor = vec4(lit, 1.0);
}`;

interface Camera {
  /** Degrees around the world Y axis. */
  yaw: number;
  /** Degrees above the horizon, clamped to +/- MAX_PITCH. */
  pitch: number;
  distance: number;
  target: [number, number, number];
  yawVelocity: number;
  pitchVelocity: number;
  idleSeconds: number;
  dragging: boolean;
  damping: boolean;
  autoRotate: boolean;
  centre: [number, number, number];
  radius: number;
}

export interface SplatRendererHandle {
  readonly backend: "webgl" | "canvas2d";
  setCloud: (cloud: SplatCloud) => void;
  resetView: () => void;
  dispose: () => void;
}

/** True when a WebGL2 context can actually be created on this device. */
export function supportsWebgl2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    return probe.getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

function createCamera(): Camera {
  return {
    yaw: 32,
    pitch: 21,
    distance: 18,
    target: [0, 0, 0],
    yawVelocity: 0,
    pitchVelocity: 0,
    idleSeconds: 0,
    dragging: false,
    damping: true,
    autoRotate: true,
    centre: [0, 0, 0],
    radius: 10,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function fitCamera(camera: Camera, cloud: SplatCloud): void {
  const min = cloud.boundsMin;
  const max = cloud.boundsMax;
  camera.centre = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  camera.radius = Math.max(
    1,
    Math.hypot(
      max[0] - camera.centre[0],
      max[1] - camera.centre[1],
      max[2] - camera.centre[2]
    )
  );
  camera.target = [camera.centre[0], camera.centre[1] + camera.radius * 0.04, camera.centre[2]];
  const framing = camera.radius * FIT_FRACTION;
  camera.distance = clamp(
    framing / Math.sin(toRadians(FOV_DEGREES) / 2),
    MIN_DISTANCE,
    MAX_DISTANCE
  );
  camera.yaw = 32;
  camera.pitch = 21;
  camera.yawVelocity = 0;
  camera.pitchVelocity = 0;
  camera.idleSeconds = 0;
}

interface InputState {
  pointers: Map<number, { x: number; y: number }>;
  mode: "none" | "orbit" | "pan";
  lastX: number;
  lastY: number;
  pinch: number;
}

/**
 * Creates the viewport engine. Returns null when neither backend is usable, in
 * which case the caller shows its unsupported notice instead of a blank canvas.
 */
export function createSplatRenderer(
  canvas: HTMLCanvasElement
): SplatRendererHandle | null {
  const camera = createCamera();
  const input: InputState = {
    pointers: new Map(),
    mode: "none",
    lastX: 0,
    lastY: 0,
    pinch: 0,
  };

  const viewMatrix = createMat4();
  const projectionMatrix = createMat4();
  const viewProjection = createMat4();
  const eye: [number, number, number] = [0, 0, 0];
  const projected: [number, number, number, number] = [0, 0, 0, 0];

  let cloud: SplatCloud | null = null;
  let pending: SplatCloud | null = null;
  /** The cloud being copied to the GPU, and how many of its points are there. */
  let upload: { cloud: SplatCloud; done: number } | null = null;

  let frameHandle = 0;
  let disposed = false;
  let visible = true;
  let lastTime = 0;
  let previousFrameTime = 0;


  const gl = supportsWebgl2() ? canvas.getContext("webgl2", {
    antialias: true,
    alpha: true,
    depth: true,
    premultipliedAlpha: false,
  }) : null;

  // ---- WebGL2 backend -------------------------------------------------------

  interface GlState {
    program: WebGLProgram;
    vao: WebGLVertexArrayObject;
    position: WebGLBuffer;
    color: WebGLBuffer;
    scale: WebGLBuffer;
    uView: WebGLUniformLocation | null;
    uProjection: WebGLUniformLocation | null;
    uPointScale: WebGLUniformLocation | null;
    /** Points the buffers have room for, and how many of them are uploaded. */
    capacity: number;
    live: number;  }

  let glState: GlState | null = null;

  if (gl) {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (vertex && fragment && program) {
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const position = gl.createBuffer();
        const color = gl.createBuffer();
        const scale = gl.createBuffer();
        const vao = gl.createVertexArray();
        if (position && color && scale && vao) {
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, position);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, color);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, scale);
          gl.enableVertexAttribArray(2);
          gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
          gl.bindVertexArray(null);

          glState = {
            program,
            vao,
            position,
            color,
            scale,
            uView: gl.getUniformLocation(program, "uView"),
            uProjection: gl.getUniformLocation(program, "uProjection"),
            uPointScale: gl.getUniformLocation(program, "uPointScale"),
            capacity: 0,
            live: 0,
          };
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.disable(gl.BLEND);
          gl.clearColor(0, 0, 0, 0);
        }
      }
    }
    if (!glState) {
      // A context exists but the program did not link: fall back rather than
      // presenting a canvas that silently draws nothing.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return null;
    }
  }

  const ctx2d = glState ? null : canvas.getContext("2d");
  if (!glState && !ctx2d) return null;

  // ---- shared camera / input ------------------------------------------------

  const updateCameraFacing = (): void => {
    const yaw = toRadians(camera.yaw);
    const pitch = toRadians(camera.pitch);
    const cosPitch = Math.cos(pitch);
    eye[0] = camera.target[0] + camera.distance * cosPitch * Math.sin(yaw);
    eye[1] = camera.target[1] + camera.distance * Math.sin(pitch);
    eye[2] = camera.target[2] + camera.distance * cosPitch * Math.cos(yaw);
  };

  const panByPixels = (dx: number, dy: number): void => {
    const height = Math.max(1, canvas.clientHeight);
    const perPixel =
      (2 * camera.distance * Math.tan(toRadians(FOV_DEGREES) / 2)) / height;
    const yaw = toRadians(camera.yaw);
    const pitch = toRadians(camera.pitch);
    // Camera basis: forward is towards the target, right is horizontal.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const upX = -Math.sin(pitch) * Math.sin(yaw);
    const upY = Math.cos(pitch);
    const upZ = -Math.sin(pitch) * Math.cos(yaw);

    const moveX = -dx * perPixel;
    const moveY = dy * perPixel;

    camera.target[0] = clampTarget(
      camera.target[0] + rightX * moveX + upX * moveY,
      camera.centre[0],
      camera.radius
    );
    camera.target[1] = clampTarget(
      camera.target[1] + upY * moveY,
      camera.centre[1],
      camera.radius
    );
    camera.target[2] = clampTarget(
      camera.target[2] + rightZ * moveX + upZ * moveY,
      camera.centre[2],
      camera.radius
    );
  };

  const clampTarget = (value: number, origin: number, radius: number): number =>
    clamp(value, origin - radius * TARGET_CLAMP, origin + radius * TARGET_CLAMP);

  const markInteraction = (): void => {
    camera.idleSeconds = 0;
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture?.(event.pointerId);
    input.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    markInteraction();
    if (input.pointers.size === 1) {
      input.mode = event.button === 2 || event.shiftKey ? "pan" : "orbit";
      input.lastX = event.clientX;
      input.lastY = event.clientY;
    } else if (input.pointers.size === 2) {
      input.mode = "pan";
      input.pinch = pinchDistance();
    }
    camera.dragging = true;
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!input.pointers.has(event.pointerId)) return;
    input.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    markInteraction();

    if (input.pointers.size >= 2) {
      const distance = pinchDistance();
      if (input.pinch > 0) {
        camera.distance = clamp(
          camera.distance * (input.pinch / Math.max(distance, 1)),
          MIN_DISTANCE,
          MAX_DISTANCE
        );
      }
      input.pinch = distance;
      return;
    }

    const dx = event.clientX - input.lastX;
    const dy = event.clientY - input.lastY;
    input.lastX = event.clientX;
    input.lastY = event.clientY;

    if (input.mode === "pan") {
      panByPixels(dx, dy);
      return;
    }

    camera.yaw -= dx * ORBIT_SENSITIVITY;
    camera.pitch = clamp(camera.pitch + dy * ORBIT_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    if (camera.damping) {
      camera.yawVelocity = -dx * ORBIT_SENSITIVITY * 0.4;
      camera.pitchVelocity = dy * ORBIT_SENSITIVITY * 0.4;
    }
  };

  const endPointer = (event: PointerEvent): void => {
    input.pointers.delete(event.pointerId);
    canvas.releasePointerCapture?.(event.pointerId);
    if (input.pointers.size === 1) {
      const remaining = input.pointers.values().next().value;
      if (remaining) {
        input.lastX = remaining.x;
        input.lastY = remaining.y;
      }
      input.pinch = 0;
      input.mode = "orbit";
    } else if (input.pointers.size === 0) {
      input.mode = "none";
      input.pinch = 0;
      camera.dragging = false;
    }
  };

  const pinchDistance = (): number => {
    const points = Array.from(input.pointers.values());
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    markInteraction();
    const factor = Math.exp(clamp(event.deltaY, -120, 120) * 0.0016);
    camera.distance = clamp(camera.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
  };

  const onContextMenu = (event: MouseEvent): void => event.preventDefault();

  // ---- frame ----------------------------------------------------------------

  const resize = (): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const advanceCamera = (dt: number): void => {
    if (!camera.dragging) {
      camera.yaw += camera.yawVelocity;
      camera.pitch = clamp(camera.pitch + camera.pitchVelocity, -MAX_PITCH, MAX_PITCH);
      camera.yawVelocity *= INERTIA_DECAY;
      camera.pitchVelocity *= INERTIA_DECAY;
      camera.idleSeconds += dt;
      if (
        camera.autoRotate &&
        camera.idleSeconds > IDLE_SECONDS_BEFORE_ROTATE
      ) {
        camera.yaw += AUTO_ROTATE_DEGREES_PER_SECOND * dt;
      }
    } else {
      camera.idleSeconds = 0;
    }
  };


  /**
   * Copies one slice of the pending cloud to the GPU.
   *
   * The alternative - the whole thing in one `bufferData` - is a stall the visitor
   * feels on any large reconstruction, and the engine's own frame budget is spent
   * before a single frame is drawn. A slice per frame turns that into a few frames
   * of growing detail, and the pass draws only the points that have landed.
   */
  const advanceUpload = (): void => {
    if (!gl || !glState || !upload) return;
    const target = upload.cloud;

    if (glState.capacity < target.count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, glState.position);
      gl.bufferData(gl.ARRAY_BUFFER, target.positions.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, glState.color);
      gl.bufferData(gl.ARRAY_BUFFER, target.colors.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, glState.scale);
      gl.bufferData(gl.ARRAY_BUFFER, target.scales.byteLength, gl.DYNAMIC_DRAW);
      glState.capacity = target.count;
      glState.live = 0;
    }

    // 28 bytes per point: 3 + 3 floats and one float.
    const step = Math.max(1, Math.floor(UPLOAD_SLICE_BYTES / 28));
    const first = upload.done;
    const last = Math.min(target.count, first + step);
    if (last <= first) return;

    const started = performance.now();
    gl.bindBuffer(gl.ARRAY_BUFFER, glState.position);
    gl.bufferSubData(gl.ARRAY_BUFFER, first * 12, target.positions, first * 3, (last - first) * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, glState.color);
    gl.bufferSubData(gl.ARRAY_BUFFER, first * 12, target.colors, first * 3, (last - first) * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, glState.scale);
    gl.bufferSubData(gl.ARRAY_BUFFER, first * 4, target.scales, first, last - first);

    // The camera has been following the new cloud since `setCloud`; only the points
    // that are really on the GPU are drawn, so a half-copied cloud never shows.
    glState.live = last;
    upload.done = last;
    cloud = target;
    traceMeasure("render", "upload-slice", performance.now() - started, { points: last - first });

    if (last >= target.count) {
      traceMark("render", "cloud-uploaded", { points: target.count });
      traceCounter("render.clouds");
      upload = null;
    }
  };
  const drawWebgl = (): void => {
    if (!gl || !glState) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!cloud || glState.live === 0) return;

    updateCameraFacing();
    const aspect = canvas.width / Math.max(canvas.height, 1);
    perspective(projectionMatrix, toRadians(FOV_DEGREES), aspect, NEAR_PLANE, FAR_PLANE);
    lookAt(viewMatrix, eye, camera.target, [0, 1, 0]);

    gl.useProgram(glState.program);
    gl.bindVertexArray(glState.vao);
    if (glState.uView) gl.uniformMatrix4fv(glState.uView, false, viewMatrix);
    if (glState.uProjection) {
      gl.uniformMatrix4fv(glState.uProjection, false, projectionMatrix);
    }
    if (glState.uPointScale) {
      // Matches the projected diameter of a sphere of `aScale` metres.
      gl.uniform1f(
        glState.uPointScale,
        canvas.height / Math.tan(toRadians(FOV_DEGREES) / 2)
      );
    }
    gl.drawArrays(gl.POINTS, 0, glState.live);
    gl.bindVertexArray(null);
  };

  const drawCanvas2d = (): void => {
    if (!ctx2d) return;
    resize();
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    if (!cloud || cloud.count === 0) return;

    updateCameraFacing();
    const aspect = canvas.width / Math.max(canvas.height, 1);
    perspective(projectionMatrix, toRadians(FOV_DEGREES), aspect, NEAR_PLANE, FAR_PLANE);
    lookAt(viewMatrix, eye, camera.target, [0, 1, 0]);
    multiply(viewProjection, projectionMatrix, viewMatrix);

    const positions = cloud.positions;
    const colors = cloud.colors;
    const step = Math.max(1, Math.ceil(cloud.count / FALLBACK_MAX_DOTS));
    const halfWidth = canvas.width / 2;
    const halfHeight = canvas.height / 2;
    const scale = canvas.height / Math.tan(toRadians(FOV_DEGREES) / 2);
    const dots: Array<{ depth: number; x: number; y: number; size: number; css: string }> = [];

    for (let i = 0; i < cloud.count; i += step) {
      const index = i * 3;
      transformPoint(
        projected,
        viewProjection,
        positions[index],
        positions[index + 1],
        positions[index + 2]
      );
      const w = projected[3];
      if (w <= 0.0001) continue;
      const ndcX = projected[0] / w;
      const ndcY = projected[1] / w;
      if (ndcX < -1.1 || ndcX > 1.1 || ndcY < -1.1 || ndcY > 1.1) continue;

      const depth = -projected[2] / w;
      const size = clamp((cloud.scales[i] * scale) / Math.max(depth, 0.05), 1, 8);
      const shade = clamp(1 - (depth - 8) / 40, 0.45, 1);
      dots.push({
        depth,
        x: halfWidth + ndcX * halfWidth,
        y: halfHeight - ndcY * halfHeight,
        size,
        css: `rgb(${Math.round(colors[index] * 255 * shade)},${Math.round(
          colors[index + 1] * 255 * shade
        )},${Math.round(colors[index + 2] * 255 * shade)})`,
      });
    }

    // Far to near, so nearer samples overdraw the ones behind them without
    // needing a depth buffer that a 2D context does not have.
    dots.sort((a, b) => b.depth - a.depth);
    ctx2d.globalAlpha = 0.92;
    for (let i = 0; i < dots.length; i += 1) {
      const dot = dots[i];
      ctx2d.fillStyle = dot.css;
      ctx2d.fillRect(dot.x - dot.size / 2, dot.y - dot.size / 2, dot.size, dot.size);
    }
  };

  const frame = (time: number): void => {
    if (disposed) return;
    frameHandle = window.requestAnimationFrame(frame);
    const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0;
    const frameMs = previousFrameTime ? time - previousFrameTime : 0;
    lastTime = time;
    previousFrameTime = time;

    if (pending) {
      if (glState) upload = { cloud: pending, done: 0 };
      else cloud = pending;
      pending = null;
    }

    // Skip, don't stall: a cloud that is still being copied keeps its frames, and
    // the camera keeps answering, instead of blocking on the transfer.
    if (upload) advanceUpload();

    if (visible && !document.hidden) {
      advanceCamera(dt);
      draw();
    }

    traceFrame(frameMs);
  };
  const draw = (): void => {
    if (glState) drawWebgl();
    else drawCanvas2d();
  };



  // ---- wiring ---------------------------------------------------------------

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);

  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  });
  observer.observe(canvas);

  // Respect the OS "reduce motion" setting: no idle spin, no inertia.
  if (typeof window.matchMedia === "function") {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    camera.damping = !reduced.matches;
    camera.autoRotate = !reduced.matches;
  }

  traceMark("render", "renderer-ready", { backend: glState ? "webgl" : "canvas2d" });
  frameHandle = window.requestAnimationFrame(frame);

  return {
    backend: glState ? "webgl" : "canvas2d",
    setCloud: (next: SplatCloud) => {
      pending = next;
      fitCamera(camera, next);
    },
    resetView: () => {
      if (cloud) fitCamera(camera, cloud);
    },
    dispose: () => {
      disposed = true;
      window.cancelAnimationFrame(frameHandle);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      if (gl && glState) {
        gl.deleteBuffer(glState.position);
        gl.deleteBuffer(glState.color);
        gl.deleteBuffer(glState.scale);
        gl.deleteVertexArray(glState.vao);
        gl.deleteProgram(glState.program);
      }
    },
  };
}