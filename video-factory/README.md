# Video Factory v2 (`@maotang/video-factory`)

Local-first short-video renderer for the MAOTANG protocol. One call turns a creator token plus a
narration script into a 9:16 promotional short and its posting metadata - **nothing leaves the
machine**.

```
Edge-TTS voiceover  ->  ComfyUI/SVD b-roll  ->  concat + watermark  ->  metadata.json
   (zh-CN-YunxiNeural)     (127.0.0.1:8188)      (QR + $mHUMAN)      (Shorts / TikTok)
```

## Install

```bash
cd video-factory
npm install
npm run build          # tsc -> dist/
npm run typecheck      # tsc --noEmit
```

## Usage

```bash
# render from a request file; the result is one JSON object on stdout
node dist/cli.js --request request.json --out ./output

# or piped
cat request.json | node dist/cli.js
```

```ts
import { renderPromoVideo } from "@maotang/video-factory";

const result = await renderPromoVideo({
  token: { address: "0x…", symbol: "MAOTANG", name: "Mao Tang", curveAddress: "0x…" },
  hook: "The first meme-first DEX",
  script: "MAOTANG launches every token on its own bonding curve.",
  shots: [
    { id: "hook",  prompt: "neon cat mascot",       durationSeconds: 5 },
    { id: "curve", prompt: "bonding curve chart",   durationSeconds: 5 },
    { id: "cta",   prompt: "wallet call to action", durationSeconds: 5 },
  ],
  outputDir: "./output",
});
```

`renderPromoVideo` returns absolute paths to the video, thumbnail and metadata, the encoder that
actually won, the b-roll provider behind each shot, and one note per fallback rung that fired.

## Fallback ladder

A render always either produces a file or fails with a reason; it never emits a silent placeholder.

| Stage | Preferred | Fallback | Reported as |
| --- | --- | --- | --- |
| Voiceover | local `edge-tts` (`zh-CN-YunxiNeural`) | silent AAC/MP3 track | `voiceover.provider = "silence"` |
| B-roll | ComfyUI HTTP `/prompt` (`008/run_svd.py`'s `svd_img2vid.json`) | `008/run_svd.py` CLI, then a token-derived gradient | `shots[].provider` |
| Encoding | `h264_nvenc` | `libx264` | `result.encoder` |

NVENC presence is probed, not assumed: the encoder can be advertised and still refuse a session, so
hardware is always an attempt with a software retry.

## Outputs

| File | Notes |
| --- | --- |
| `<symbol>-promo-9x16.mp4` | 1080x1920, `yuv420p`, H.264 + AAC, `+faststart` |
| `thumbnail.jpg` | 1s cover frame |
| `metadata.json` | standardized YouTube Shorts / TikTok posting block |
| `watermark-qr.png` | QR resolving to the token's bonding curve |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `EDGE_TTS_BIN` / `EDGE_TTS_PATH` | `edge-tts` on PATH | voiceover binary (falls back to `python -m edge_tts`) |
| `FFMPEG_PATH` / `FFMPEG_BIN` | bundled runtime, then PATH | FFmpeg resolution (same contract as `src/core/ffmpeg.py`) |
| `FFPROBE_PATH` / `FFPROBE_BIN` | bundled runtime, then PATH | ffprobe resolution |
| `FFMPEG_DISABLE_NVENC` | unset | force the software encoder |
| `COMFYUI_SERVER_URL` | `http://127.0.0.1:8188` | ComfyUI / SVD endpoint |
| `MAOTANG_SVD_FRAMES` / `MAOTANG_SVD_STEPS` | `14` / `20` | SVD clip shape |
| `MAOTANG_SHARE_BASE_URL` | `https://maotang.example` | base for the watermark QR when `shareUrl` is omitted |
| `MAOTANG_WATERMARK_FONT` | auto-detected | TrueType font for the ticker/brand burn-in |
| `MAOTANG_QR_SIZE` | `320` | QR edge length in pixels |

SVD renders at a 576x1024-class canvas and is upscaled during normalization: generating at the
1080x1920 delivery size costs VRAM without improving the result.

## Visibility

Generated metadata can only carry `unlisted` / `private` visibility; `assertNonPublicPrivacy` throws
otherwise and the types make `public` unrepresentable. See `memory/ARCHITECTURE_DECISIONS.md`
(the anti-public ADR) for the constraint this extends.