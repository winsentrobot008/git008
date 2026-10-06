/**
 * NpuInferenceDelegator: pick the fastest *local* accelerator for the 0.5B SLM.
 *
 * The delegator never runs inference itself. It probes the machine (ONNX Runtime execution
 * providers, llama.cpp GPU backend, platform hints) and produces a `DelegationPlan` that the
 * manager feeds into `@maotang/agent-client`: the chosen provider list, GPU layer offload and
 * thread count. Everything stays on-device, and CPU is always the safe fallback.
 *
 * Native modules are probed with a dynamic import so this file loads and tests fine on a machine
 * with no accelerator runtime installed.
 */
import os from "node:os";

export const ACCELERATORS = Object.freeze({ NPU: "npu", GPU: "gpu", CPU: "cpu" });
export const BACKENDS = Object.freeze({ ONNX: "onnx", LLAMA_CPP: "llama.cpp" });

const PROVIDER_ACCELERATOR = Object.freeze({
  qnn: ACCELERATORS.NPU,
  nnapi: ACCELERATORS.NPU,
  coreml: ACCELERATORS.NPU,
  xnnpack: ACCELERATORS.NPU,
  cann: ACCELERATORS.NPU,
  vitis: ACCELERATORS.NPU,
  openvino: ACCELERATORS.NPU,
  cuda: ACCELERATORS.GPU,
  tensorrt: ACCELERATORS.GPU,
  dml: ACCELERATORS.GPU,
  rocm: ACCELERATORS.GPU,
  migraphx: ACCELERATORS.GPU,
  webgpu: ACCELERATORS.GPU,
  cpu: ACCELERATORS.CPU,
});

const ACCELERATOR_RANK = { [ACCELERATORS.NPU]: 2, [ACCELERATORS.GPU]: 1, [ACCELERATORS.CPU]: 0 };

/** Maps an ONNX Runtime execution provider name to an accelerator class. */
export function classifyProvider(provider) {
  const key = String(provider).toLowerCase().replace(/executionprovider$/, "");
  return PROVIDER_ACCELERATOR[key] ?? ACCELERATORS.CPU;
}

async function tryImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

export class NpuInferenceDelegator {
  /**
   * @param options.modelFormat "onnx" | "gguf" - selects the primary backend
   * @param options.probes        deterministic probe input (tests / offline replay)
   */
  constructor(options = {}) {
    this.modelFormat = options.modelFormat ?? "gguf";
    this.threads = options.threads;
    this.probes = options.probes;
    this.lastProbe = undefined;
  }

  get backend() {
    return this.modelFormat === "onnx" ? BACKENDS.ONNX : BACKENDS.LLAMA_CPP;
  }

  /** Probes local accelerators. Falls back to CPU and records why. */
  async probe() {
    if (this.probes !== undefined) {
      const probe = {
        backend: this.backend,
        onnxProviders: [],
        llamaGpu: null,
        platformAccelerator: undefined,
        notes: [],
        ...this.probes,
      };
      this.lastProbe = probe;
      return probe;
    }

    const notes = [];
    const probe = { backend: this.backend, onnxProviders: [], llamaGpu: null, platformAccelerator: undefined, notes };

    const ort = await tryImport("onnxruntime-node");
    if (ort === null) {
      notes.push("onnxruntime-node not installed");
    } else {
      const holder = ort.InferenceSession ?? ort;
      const getProviders = holder?.getAvailableProviders ?? ort.getAvailableProviders;
      if (typeof getProviders === "function") {
        try {
          probe.onnxProviders = Array.from(getProviders.call(holder)).map(String);
        } catch (error) {
          notes.push(`ONNX provider probe failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        notes.push("ONNX runtime exposes no provider list");
      }
    }

    const llamaModule = await tryImport("node-llama-cpp");
    if (llamaModule === null || typeof llamaModule.getLlama !== "function") {
      notes.push("node-llama-cpp not installed");
    } else {
      try {
        const llama = await llamaModule.getLlama({ gpu: "auto" });
        probe.llamaGpu = llama?.gpu === false || llama?.gpu === undefined ? null : String(llama.gpu);
      } catch (error) {
        notes.push(`llama.cpp GPU probe failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (process.platform === "darwin" && process.arch === "arm64") {
      probe.platformAccelerator = ACCELERATORS.NPU;
      notes.push("Apple Silicon: Metal/CoreML acceleration available");
    } else if (process.platform === "android") {
      notes.push("Android: NPU delegation depends on the device's NNAPI/QNN driver");
    }

    this.lastProbe = probe;
    return probe;
  }

  /** Pure decision function: probe result in, delegation plan out. */
  planFor(probe) {
    const providers = [...(probe.onnxProviders ?? [])];
    const npuProviders = providers.filter((provider) => classifyProvider(provider) === ACCELERATORS.NPU);
    const gpuProviders = providers.filter((provider) => classifyProvider(provider) === ACCELERATORS.GPU);
    const reasons = [];

    let accelerator = ACCELERATORS.CPU;
    if (npuProviders.length > 0 || probe.platformAccelerator === ACCELERATORS.NPU) {
      accelerator = ACCELERATORS.NPU;
      reasons.push(
        npuProviders.length > 0
          ? `NPU providers reported: ${npuProviders.join(", ")}`
          : "platform NPU hint reported",
      );
    } else if (gpuProviders.length > 0 || probe.llamaGpu !== null) {
      accelerator = ACCELERATORS.GPU;
      reasons.push(gpuProviders.length > 0 ? `GPU providers reported: ${gpuProviders.join(", ")}` : `llama.cpp GPU: ${probe.llamaGpu}`);
    } else {
      reasons.push("no NPU or GPU reported; delegating to CPU");
    }

    const ordered = providers
      .map((provider, index) => ({ provider, index }))
      .sort((a, b) => {
        const byClass = ACCELERATOR_RANK[classifyProvider(b.provider)] - ACCELERATOR_RANK[classifyProvider(a.provider)];
        return byClass !== 0 ? byClass : a.index - b.index;
      })
      .map((entry) => entry.provider);

    const executionProviders = ordered.length > 0 ? ordered : ["CPUExecutionProvider"];
    const gpuLayers = probe.backend === BACKENDS.LLAMA_CPP && accelerator !== ACCELERATORS.CPU ? "auto" : 0;
    const threads = this.threads ?? Math.max(1, Math.min(4, (os.cpus()?.length ?? 2) - 1));

    return { backend: probe.backend ?? this.backend, accelerator, executionProviders, gpuLayers, threads, reasons };
  }

  /** One call for the common path: probe, then plan. */
  async analyze() {
    const probe = await this.probe();
    return { probe, plan: this.planFor(probe) };
  }

  /** Options the manager merges into the SLM runtime config. */
  runtimeOptions(plan) {
    return {
      backend: plan.backend,
      accelerator: plan.accelerator,
      executionProviders: [...plan.executionProviders],
      gpuLayers: plan.gpuLayers,
      threads: plan.threads,
    };
  }

  describe(plan) {
    const offload = plan.backend === BACKENDS.LLAMA_CPP ? `gpuLayers=${plan.gpuLayers}` : `providers=${plan.executionProviders.join(",")}`;
    return `${plan.backend}/${plan.accelerator} (${offload}, threads=${plan.threads})`;
  }
}
