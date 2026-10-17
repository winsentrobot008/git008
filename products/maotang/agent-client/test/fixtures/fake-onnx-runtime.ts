/**
 * A stand-in for `onnxruntime-node`, used by the ONNX backend tests.
 *
 * It records every execution-provider list it is asked for and refuses anything that is not exactly
 * `["cpu"]`, so a test can prove the engine walks its provider ladder (NPU -> GPU -> CPU) instead of
 * failing on a device with no accelerator runtime. `run()` returns scripted logits so the greedy
 * decode loop is fully deterministic.
 */
export const attempts: string[][] = [];
export const createOptions: Record<string, unknown>[] = [];
export let released = 0;
export let runs = 0;

/** Token ids the session "generates": two content tokens, then the EOS id. */
export const SCRIPTED_TOKENS = [2, 3, 1];
export const VOCAB_SIZE = 4;

export function resetFixture(): void {
  attempts.length = 0;
  createOptions.length = 0;
  released = 0;
  runs = 0;
}

class FakeTensor {
  readonly data: BigInt64Array | Float32Array;
  readonly dims: readonly number[];

  constructor(_type: string, data: BigInt64Array | Float32Array, dims: readonly number[]) {
    this.data = data;
    this.dims = dims;
  }
}

let step = 0;

export class InferenceSession {
  readonly inputNames = ["input_ids", "attention_mask"];
  readonly outputNames = ["logits"];

  static async create(path: string, options: Record<string, unknown> = {}): Promise<InferenceSession> {
    const providers = ((options.executionProviders as string[] | undefined) ?? []).map(String);
    attempts.push(providers);
    createOptions.push({ path, ...options });
    if (providers.length !== 1 || providers[0] !== "cpu") {
      throw new Error(`no session for providers ${providers.join("+") || "none"}`);
    }
    step = 0;
    return new InferenceSession();
  }

  async run(feeds: Record<string, FakeTensor>): Promise<Record<string, FakeTensor>> {
    runs += 1;
    const ids = feeds.input_ids;
    const sequence = ids === undefined ? 1 : Number(ids.dims[1]);
    const logits = new Float32Array(sequence * VOCAB_SIZE);
    const winner = SCRIPTED_TOKENS[Math.min(step, SCRIPTED_TOKENS.length - 1)] ?? 0;
    step += 1;
    for (let position = 0; position < sequence; position++) {
      logits[position * VOCAB_SIZE + winner] = 1;
    }
    return { logits: new FakeTensor("float32", logits, [1, sequence, VOCAB_SIZE]) };
  }

  async release(): Promise<void> {
    released += 1;
  }
}

export const Tensor = FakeTensor;
