"use client";

/**
 * use-voice-engine - the hand-free voice dialogue engine.
 *
 * One hook owns the full duplex loop, cloned from CalorieAI's "one hardened
 * client layer, no duplicated browser logic" pattern:
 *
 *   listen (SpeechRecognition + MediaRecorder + analyser)
 *     -> silence/stop -> transcript + recorded clip + per-frame RMS levels
 *     -> stream the LLM reply, speaking it sentence-by-sentence as it arrives
 *     -> auto-restart listening when hands-free is on
 *
 * Every browser capability is feature-detected: without SpeechRecognition the
 * caller can still type a turn, and without SpeechSynthesis the reply is only
 * rendered as text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_TURN_MS,
  MIN_TURN_MS,
  SILENCE_END_MS,
  SPEECH_RMS_THRESHOLD,
  type LanguageOption,
} from "@/lib/savage-fit/config";
import type { Persona } from "@/lib/savage-fit/personas";
import type { VoiceUtterance } from "@/lib/savage-fit/types";

// ── Minimal Web Speech typings (lib.dom does not ship SpeechRecognition) ──

interface SpeechAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternativeLike;
}

interface SpeechResultListLike {
  readonly length: number;
  [index: number]: SpeechResultLike;
}

interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}

interface SpeechErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickRecorderType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of RECORDER_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

const SENTENCE_ENDERS = new Set([".", "!", "?", "\u3002", "\uff01", "\uff1f", "\u2026"]);

/** Hard cap for one spoken reply; the poll below resolves early when the queue drains. */
const SPEECH_QUEUE_TIMEOUT_MS = 45_000;

/** Pull finished sentences out of a streaming buffer (for sentence-level TTS). */
function drainSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (!SENTENCE_ENDERS.has(buffer[i])) continue;
    const candidate = buffer.slice(start, i + 1).trim();
    if (candidate.length >= 2) {
      sentences.push(candidate);
      start = i + 1;
    }
  }
  return { sentences, rest: buffer.slice(start) };
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  persona: Persona,
  lang: string
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const short = lang.slice(0, 2).toLowerCase();
  const localized = voices.filter((voice) => (voice.lang || "").toLowerCase().startsWith(short));
  const pool = localized.length > 0 ? localized : voices;
  for (const hint of persona.voice.hints) {
    const found = pool.find((voice) => voice.name.toLowerCase().includes(hint.toLowerCase()));
    if (found) return found;
  }
  return pool[0] ?? null;
}

/**
 * The one AudioContext the whole voice surface shares.
 *
 * iOS Safari hands back a fresh AudioContext in the "suspended" state and only
 * lets a genuine user gesture resume it. The metering analyser and the reply
 * playback both need that same object, so the unlock has to run on this exact
 * instance, inside the tap - by the time the async getUserMedia round trip
 * settles we are out of the user-activation window and resume() is ignored.
 * VoiceStage calls this from the record button's onClick; startTurn reuses it.
 */
let sharedAudioContext: AudioContext | null = null;

export function unlockAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioCtor();
  }
  if (sharedAudioContext.state === "suspended") {
    void sharedAudioContext.resume().catch(() => undefined);
  }
  return sharedAudioContext;
}

export type VoiceStatus = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceEngineOptions {
  persona: Persona;
  language: LanguageOption;
  /** false while the paywall is locked - the engine tears everything down. */
  enabled: boolean;
  handsFree: boolean;
  /** Send the turn upstream. `emit` is called for every streamed chunk so the
   * engine can speak sentences before the model finishes. */
  onUtterance: (utterance: VoiceUtterance, emit: (chunk: string) => void) => Promise<string>;
  onCoachReply: (text: string) => void;
  onError: (message: string) => void;
  onPaywall: () => void;
}

export interface VoiceEngine {
  status: VoiceStatus;
  recognitionSupported: boolean;
  ttsSupported: boolean;
  recorderSupported: boolean;
  interim: string;
  error: string | null;
  level: number;
  beginTurn: () => void;
  endTurn: () => void;
  abortAll: () => void;
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  lastUtterance: VoiceUtterance | null;
  clearLastUtterance: () => void;
}

export function useVoiceEngine(options: VoiceEngineOptions): VoiceEngine {
  const {
    persona,
    language,
    enabled,
    handsFree,
    onUtterance,
    onCoachReply,
    onError,
    onPaywall,
  } = options;

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [lastUtterance, setLastUtterance] = useState<VoiceUtterance | null>(null);

  const recognitionSupported = useMemo(() => getRecognitionCtor() !== null, []);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const recorderSupported = typeof MediaRecorder !== "undefined";

  const statusRef = useRef<VoiceStatus>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const levelsRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);
  const speechSeenRef = useRef(false);
  const silentSinceRef = useRef(0);
  const emptyTurnsRef = useRef(0);
  const voiceCacheRef = useRef<SpeechSynthesisVoice[]>([]);
  const pendingSentenceRef = useRef("");
  const speakQueueRef = useRef(0);
  const speakDoneRef = useRef<(() => void) | null>(null);
  const serverAudioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const handsFreeRef = useRef(handsFree);
  const enabledRef = useRef(enabled);
  const personaRef = useRef(persona);
  const languageRef = useRef(language);
  const onUtteranceRef = useRef(onUtterance);
  const onCoachReplyRef = useRef(onCoachReply);
  const onErrorRef = useRef(onError);
  const onPaywallRef = useRef(onPaywall);

  handsFreeRef.current = handsFree;
  enabledRef.current = enabled;
  personaRef.current = persona;
  languageRef.current = language;
  onUtteranceRef.current = onUtterance;
  onCoachReplyRef.current = onCoachReply;
  onErrorRef.current = onError;
  onPaywallRef.current = onPaywall;

  const transition = useCallback((next: VoiceStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  // ── Speech synthesis ───────────────────────────────────────────────────

  const loadVoices = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) voiceCacheRef.current = voices;
  }, []);

  useEffect(() => {
    if (!ttsSupported) return;
    loadVoices();
    const synth = window.speechSynthesis;
    const handler = () => loadVoices();
    synth.addEventListener?.("voiceschanged", handler);
    return () => synth.removeEventListener?.("voiceschanged", handler);
  }, [loadVoices, ttsSupported]);

  const speakQueueDone = useCallback(() => {
    if (speakQueueRef.current > 0) return;
    const resolve = speakDoneRef.current;
    speakDoneRef.current = null;
    resolve?.();
  }, []);

  /** Queue one utterance; the persona voice/rate/pitch shape the delivery. */
  /**
   * Server TTS tier (route: /api/savage-fit/tts). Used when the platform has no
   * browser speech engine, so every device still gets a voice.
   */
  const queueSpeakServer = useCallback(
    async (text: string) => {
      speakQueueRef.current += 1;
      try {
        const response = await fetch("/api/savage-fit/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            personaId: personaRef.current.id,
            language: languageRef.current.id,
          }),
        });
        if (!response.ok) throw new Error(`tts ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        serverAudioRef.current = audio;
        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          audio.onended = finish;
          audio.onerror = finish;
          window.setTimeout(finish, 30_000);
          void audio.play().catch(finish);
        });
        URL.revokeObjectURL(url);
      } catch (error) {
        console.warn("[savage-fit] server TTS unavailable:", error);
      } finally {
        serverAudioRef.current = null;
        speakQueueRef.current = Math.max(0, speakQueueRef.current - 1);
        speakQueueDone();
      }
    },
    [speakQueueDone]
  );

  const queueSpeak = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (!ttsSupported) {
        void queueSpeakServer(clean);
        return;
      }
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(clean);
      const active = personaRef.current;
      const voice = pickVoice(voiceCacheRef.current, active, languageRef.current.speech);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || languageRef.current.speech;
      utterance.rate = active.voice.rate;
      utterance.pitch = active.voice.pitch;
      speakQueueRef.current += 1;
      const finish = () => {
        speakQueueRef.current = Math.max(0, speakQueueRef.current - 1);
        speakQueueDone();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      synth.speak(utterance);
    },
    [queueSpeakServer, speakQueueDone, ttsSupported]
  );

  /** Speak a complete text and resolve when the queue drains. */
  const speakText = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        speakDoneRef.current = resolve;
        const sentences = drainSentences(text.replace(/\s+/g, " ").trim());
        for (const sentence of sentences.sentences) queueSpeak(sentence);
        if (sentences.rest.trim()) queueSpeak(sentences.rest.trim());
        if (speakQueueRef.current === 0) speakQueueDone();

        // Poll until the queue drains, with a hard cap. A short timeout would
        // cut long replies off and let the loop restart the mic mid-sentence.
        const deadline = Date.now() + SPEECH_QUEUE_TIMEOUT_MS;
        const poll = () => {
          if (speakQueueRef.current === 0) {
            speakQueueDone();
            return;
          }
          if (Date.now() > deadline) {
            speakQueueRef.current = 0;
            speakQueueDone();
            return;
          }
          window.setTimeout(poll, 200);
        };
        window.setTimeout(poll, 200);
      }),
    [queueSpeak, speakQueueDone, ttsSupported]
  );

  const stopSpeaking = useCallback(() => {
    const serverAudio = serverAudioRef.current;
    if (serverAudio) {
      try {
        serverAudio.pause();
      } catch {
        /* already stopped */
      }
      serverAudioRef.current = null;
    }
    speakQueueRef.current = 0;
    if (ttsSupported) window.speechSynthesis.cancel();
    speakQueueDone();
  }, [speakQueueDone, ttsSupported]);

  // ── Audio input plumbing ───────────────────────────────────────────────

  const ensureStream = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current && streamRef.current.active) return streamRef.current;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      return stream;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Microphone unavailable (${message})`);
      onErrorRef.current(`Microphone unavailable: ${message}`);
      return null;
    }
  }, []);

  const stopMetering = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    if (mountedRef.current) setLevel(0);
  }, []);

  const finishTurn = useCallback(async () => {
    const recorder = recorderRef.current;
    const text = transcriptRef.current.trim();
    const levels = levelsRef.current;
    const startedAt = startedAtRef.current;
    const durationMs = Math.max(0, Date.now() - startedAt);
    const mimeType = recorder?.mimeType || "audio/webm";

    const blob: Blob | null = await new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: mimeType }) : null);
        return;
      }
      recorder.onstop = () => {
        resolve(chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: mimeType }) : null);
      };
      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
    recorderRef.current = null;
    chunksRef.current = [];

    if (!text || durationMs < MIN_TURN_MS) {
      emptyTurnsRef.current += 1;
      if (emptyTurnsRef.current >= 2) {
        onErrorRef.current("I could not hear anything - tap the mic and speak, or type your line.");
        transition("idle");
        return;
      }
      if (handsFreeRef.current && enabledRef.current) {
        transition("idle");
        window.setTimeout(() => startTurnRef.current?.(), 400);
      } else {
        transition("idle");
      }
      return;
    }
    emptyTurnsRef.current = 0;

    const audioUrl = blob ? URL.createObjectURL(blob) : "";
    const utterance: VoiceUtterance = {
      id: `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      audioUrl,
      mimeType: blob?.type || mimeType,
      durationMs,
      levels,
      personaId: personaRef.current.id,
      at: Date.now(),
    };
    if (mountedRef.current) setLastUtterance(utterance);

    transition("thinking");
    pendingSentenceRef.current = "";
    let fillerTimer: number | null = null;
    if (handsFreeRef.current && ttsSupported) {
      const fillers = personaRef.current.fillers;
      const filler = fillers[Math.floor(Math.random() * fillers.length)];
      fillerTimer = window.setTimeout(() => {
        if (statusRef.current === "thinking") queueSpeak(filler);
      }, 900);
    }

    let full = "";
    try {
      full = await onUtteranceRef.current(utterance, (chunk: string) => {
        full += chunk;
        pendingSentenceRef.current += chunk;
        const { sentences, rest } = drainSentences(pendingSentenceRef.current);
        pendingSentenceRef.current = rest;
        for (const sentence of sentences) queueSpeak(sentence);
        // Paywall engaged mid-turn: halt playback immediately (spec: the third
        // free turn stops speaking and hands over to the bundle modal).
        if (!enabledRef.current) stopSpeaking();
      });
    } catch (cause) {
      if (fillerTimer !== null) window.clearTimeout(fillerTimer);
      const name = (cause as { name?: string })?.name;
      const code = (cause as { code?: string })?.code;
      if (code === "PAYWALL_REACHED") {
        stopSpeaking();
        transition("idle");
        onPaywallRef.current();
        return;
      }
      if (name !== "AbortError") {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        onErrorRef.current(message);
      }
      transition("idle");
      return;
    }

    if (fillerTimer !== null) window.clearTimeout(fillerTimer);
    const reply = (full || "").trim();
    if (!reply) {
      transition("idle");
      return;
    }
    onCoachReplyRef.current(reply);

    if (!enabledRef.current) {
      stopSpeaking();
      pendingSentenceRef.current = "";
      transition("idle");
      return;
    }

    const tail = pendingSentenceRef.current.trim();
    pendingSentenceRef.current = "";
    if (tail) queueSpeak(tail);

    transition("speaking");
    await speakText("");
    if (!enabledRef.current) {
      transition("idle");
      return;
    }
    transition("idle");
    if (handsFreeRef.current) {
      window.setTimeout(() => startTurnRef.current?.(), 350);
    }
  }, [queueSpeak, speakText, stopSpeaking, transition, ttsSupported]);

  const startTurn = useCallback(async () => {
    if (!enabledRef.current || statusRef.current !== "idle") return;
    setError(null);
    const stream = await ensureStream();
    if (!stream) {
      transition("error");
      return;
    }
    transcriptRef.current = "";
    levelsRef.current = [];
    speechSeenRef.current = false;
    silentSinceRef.current = 0;
    setInterim("");
    startedAtRef.current = Date.now();

    // Recorder -> one clip per turn for the 9:16 studio.
    if (recorderSupported) {
      const mimeType = pickRecorderType();
      try {
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.start(250);
        recorderRef.current = recorder;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.warn("[savage-fit] recorder unavailable:", message);
      }
    }

    // Metering + VAD drive the waveform and the hands-free auto-stop.
    try {
      const ctx = unlockAudioContext();
      if (ctx) {
        if (!analyserRef.current) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaStreamSource(stream).connect(analyser);
          analyserRef.current = analyser;
        }
        const analyser = analyserRef.current;
        const data = new Uint8Array(analyser.fftSize);
        let lastSample = 0;
        let lastPaint = 0;
        const loop = () => {
          if (!analyserRef.current) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const centered = (data[i] - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / data.length);
          const amplitude = Math.min(1, rms * 3.4);
          const now = Date.now();
          // Throttle React updates: the meter only needs ~18fps, the RMS track
          // below still samples at ~30fps for the snippet renderer.
          if (mountedRef.current && now - lastPaint > 55) {
            lastPaint = now;
            setLevel(amplitude);
          }
          if (now - lastSample > 32) {
            lastSample = now;
            levelsRef.current.push(Number(amplitude.toFixed(3)));
          }
          if (statusRef.current === "listening") {
            if (amplitude > SPEECH_RMS_THRESHOLD) {
              speechSeenRef.current = true;
              silentSinceRef.current = 0;
            } else if (speechSeenRef.current) {
              if (silentSinceRef.current === 0) silentSinceRef.current = now;
              else if (now - silentSinceRef.current > SILENCE_END_MS) {
                endTurnRef.current?.();
                return;
              }
            }
            if (now - startedAtRef.current > MAX_TURN_MS) {
              endTurnRef.current?.();
              return;
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      }
    } catch (cause) {
      console.warn("[savage-fit] metering unavailable:", cause);
    }

    // Speech recognition supplies the transcript.
    const Ctor = getRecognitionCtor();
    if (Ctor) {
      try {
        const recognition = new Ctor();
        recognition.lang = languageRef.current.speech;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event) => {
          let finalText = "";
          let pending = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const alternative = result[0];
            if (!alternative) continue;
            if (result.isFinal) finalText += `${alternative.transcript} `;
            else pending += alternative.transcript;
          }
          if (finalText) transcriptRef.current = `${transcriptRef.current} ${finalText}`.trim();
          if (mountedRef.current) setInterim(pending.trim());
        };
        recognition.onerror = (event) => {
          if (event.error === "no-speech" || event.error === "aborted") return;
          setError(`Speech recognition: ${event.error}`);
        };
        recognition.onend = () => {
          // A recognition that ended while we are still listening means the
          // engine cut us off (network idle) - restart to keep the loop alive.
          if (statusRef.current === "listening" && recognitionRef.current === recognition) {
            try {
              recognition.start();
            } catch {
              /* already restarting */
            }
          }
        };
        recognition.start();
        recognitionRef.current = recognition;
      } catch (cause) {
        console.warn("[savage-fit] recognition unavailable:", cause);
      }
    }

    stopSpeaking();
    transition("listening");
  }, [ensureStream, recorderSupported, stopSpeaking, transition]);

  const endTurn = useCallback(() => {
    if (statusRef.current !== "listening") return;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    }
    stopMetering();
    void finishTurn();
  }, [finishTurn, stopMetering]);

  const startTurnRef = useRef<(() => void) | null>(null);
  const endTurnRef = useRef<(() => void) | null>(null);
  startTurnRef.current = () => {
    void startTurn();
  };
  endTurnRef.current = endTurn;

  const abortAll = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    }
    stopMetering();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    chunksRef.current = [];
    stopSpeaking();
    transition("idle");
  }, [stopMetering, stopSpeaking, transition]);

  const clearLastUtterance = useCallback(() => {
    setLastUtterance((current) => {
      if (current?.audioUrl) URL.revokeObjectURL(current.audioUrl);
      return null;
    });
  }, []);

  // Paywall lock: stop accepting NEW turns right away, but let an in-flight
  // reply finish speaking before the engine is torn down (otherwise the third
  // free turn would be cut off mid-sentence by its own paywall).
  useEffect(() => {
    if (enabled) return;
    if (status !== "idle") return;
    abortAll();
  }, [abortAll, enabled, status]);

  // Entering hands-free with an idle engine starts listening right away.
  useEffect(() => {
    if (!enabled || !handsFree) return;
    if (statusRef.current === "idle") void startTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, handsFree]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      serverAudioRef.current?.pause();
      // The AudioContext is the module-level shared one (unlockAudioContext), so
      // it is deliberately left open across mounts: closing it here would tear
      // down the very instance VoiceStage just unlocked with a user gesture.
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    status,
    recognitionSupported,
    ttsSupported,
    recorderSupported,
    interim,
    error,
    level,
    beginTurn: () => {
      void startTurn();
    },
    endTurn,
    abortAll,
    speakText,
    stopSpeaking,
    lastUtterance,
    clearLastUtterance,
  };
}
