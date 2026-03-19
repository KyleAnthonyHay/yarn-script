"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  DEFAULT_FORWARD_SEARCH_WINDOW,
  buildSpokenWindow,
  resolveCandidateJump,
  sanitizeSpokenWindow,
  shouldAttemptSemanticRecovery,
} from "@/lib/semantic/matcher";
import {
  matchSemanticWindow,
  prepareSemanticScript,
} from "@/lib/semantic/client";
import {
  getConfirmedIndexForLine,
  getLineIndexForConfirmedToken,
  type TeleprompterLine,
} from "@/lib/teleprompter/teleprompterLines";
import {
  TranscriptManager,
  type TranscriptManagerSnapshot,
} from "@/lib/transcription/TranscriptManager";
import type { SemanticMatchResult } from "@/types/semantic";
import type { TranscriptionSessionState } from "@/types/transcription";

const STREAM_SAMPLE_RATE = 16_000;
const TOKEN_ENDPOINT = "/api/assemblyai/token";
const WEBSOCKET_ENDPOINT = "wss://streaming.assemblyai.com/v3/ws";
const SEMANTIC_DEBUG_PREFIX = "[semantic-teleprompter]";
const SEMANTIC_JUMP_COOLDOWN_MS = 1200;

interface AssemblyAiWord {
  text: string;
  word_is_final?: boolean;
}

interface AssemblyAiTurnMessage {
  type: "Turn";
  transcript?: string;
  utterance?: string;
  words?: AssemblyAiWord[];
  end_of_turn?: boolean;
}

interface AssemblyAiBeginMessage {
  type: "Begin";
  id: string;
}

interface AssemblyAiTerminationMessage {
  type: "Termination";
  audio_duration_seconds?: number;
  session_duration_seconds?: number;
}

type AssemblyAiMessage =
  | AssemblyAiBeginMessage
  | AssemblyAiTurnMessage
  | AssemblyAiTerminationMessage;

interface UseAssemblyAiStreamingResult {
  state: TranscriptionSessionState;
  error: string | null;
  transcript: TranscriptManagerSnapshot;
  currentLineIndex: number;
  semanticMatch: SemanticMatchResult | null;
  startSession: () => Promise<void>;
  stopSession: () => void;
  resetSession: () => void;
  seekToIndex: (index: number) => void;
  setScript: (script: string) => void;
}

const EMPTY_SNAPSHOT: TranscriptManagerSnapshot = {
  scriptTokens: [],
  stableTranscript: "",
  partialTranscript: "",
  alignment: {
    confirmedIndex: -1,
    matchedPhrase: "",
    confidence: 0,
    transcriptTokens: [],
  },
  liveAlignment: {
    confirmedIndex: -1,
    matchedPhrase: "",
    confidence: 0,
    transcriptTokens: [],
  },
};

export function useAssemblyAiStreaming(
  initialScript = "",
  lines: TeleprompterLine[] = [],
  wordsPerLine = 5,
): UseAssemblyAiStreamingResult {
  const [state, setState] = useState<TranscriptionSessionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptManagerSnapshot>(EMPTY_SNAPSHOT);
  const [currentLineIndex, setCurrentLineIndex] = useState(lines.length > 0 ? 0 : -1);
  const [semanticMatch, setSemanticMatch] = useState<SemanticMatchResult | null>(null);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const silenceGainRef = useRef<GainNode | null>(null);
  const stateRef = useRef<TranscriptionSessionState>("idle");
  const transcriptManagerRef = useRef(new TranscriptManager(initialScript));
  const currentLineIndexRef = useRef(lines.length > 0 ? 0 : -1);
  const preparedScriptIdRef = useRef<string | null>(null);
  const stalledChunkCountRef = useRef(0);
  const lastExactLineIndexRef = useRef(-1);
  const lastSemanticRequestKeyRef = useRef("");
  const lastAcceptedSemanticWindowRef = useRef("");
  const lastSemanticTranscriptFingerprintRef = useRef("");
  const lastSemanticAcceptedAtRef = useRef(0);

  const cleanupResources = () => {
    websocketRef.current = null;

    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }

    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    silenceGainRef.current?.disconnect();
    silenceGainRef.current = null;

    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const handleError = useCallback((
    cause: unknown,
    fallbackMessage = "Something went wrong while streaming transcription.",
  ) => {
    const message = cause instanceof Error ? cause.message : fallbackMessage;
    setError(message || fallbackMessage);
    setState("error");
    cleanupResources();
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    transcriptManagerRef.current.setScript(initialScript);
    setTranscript(transcriptManagerRef.current.getSnapshot());
    preparedScriptIdRef.current = null;
    stalledChunkCountRef.current = 0;
    lastExactLineIndexRef.current = -1;
    lastSemanticRequestKeyRef.current = "";
    lastAcceptedSemanticWindowRef.current = "";
    lastSemanticTranscriptFingerprintRef.current = "";
    lastSemanticAcceptedAtRef.current = 0;
    setSemanticMatch(null);
  }, [initialScript]);

  useEffect(() => {
    const nextLineIndex = lines.length > 0 ? 0 : -1;
    currentLineIndexRef.current = nextLineIndex;
    setCurrentLineIndex(nextLineIndex);
  }, [lines]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, []);

  useEffect(() => {
    currentLineIndexRef.current = currentLineIndex;
  }, [currentLineIndex]);

  useEffect(() => {
    const exactLineIndex = getLineIndexForConfirmedToken(
      lines,
      transcript.liveAlignment.confirmedIndex,
    );

    if (exactLineIndex < 0) {
      return;
    }

    if (exactLineIndex > lastExactLineIndexRef.current) {
      stalledChunkCountRef.current = 0;
      lastExactLineIndexRef.current = exactLineIndex;
    } else {
      stalledChunkCountRef.current += 1;
    }

    if (exactLineIndex > currentLineIndexRef.current) {
      setSemanticMatch(null);
      console.info(SEMANTIC_DEBUG_PREFIX, "exact-advance", {
        exactLineIndex,
        confirmedIndex: transcript.liveAlignment.confirmedIndex,
        confidence: transcript.liveAlignment.confidence,
      });
      setCurrentLineIndex(exactLineIndex);
    }
  }, [lines, transcript.liveAlignment.confirmedIndex]);

  useEffect(() => {
    let cancelled = false;

    async function runSemanticRecovery() {
      if (
        state !== "listening" ||
        !preparedScriptIdRef.current ||
        currentLineIndexRef.current < 0 ||
        lines.length === 0
      ) {
        return;
      }

      const spokenWindow = buildSpokenWindow(
        [transcript.stableTranscript, transcript.partialTranscript]
          .map((part) => part.trim())
          .filter(Boolean)
          .join(" "),
      );
      const sanitizedSpokenWindow = sanitizeSpokenWindow(spokenWindow);

      const exactLineIndex = getLineIndexForConfirmedToken(
        lines,
        transcript.liveAlignment.confirmedIndex,
      );
      const transcriptFingerprint = [
        transcript.stableTranscript,
        transcript.partialTranscript,
        transcript.liveAlignment.confirmedIndex,
      ].join("|");

      if (
        !shouldAttemptSemanticRecovery({
          exactLineIndex,
          currentLineIndex: currentLineIndexRef.current,
          liveConfidence: transcript.liveAlignment.confidence,
          stalledChunks: stalledChunkCountRef.current,
          spokenWindowWordCount: sanitizedSpokenWindow.split(/\s+/).filter(Boolean).length,
        })
      ) {
        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-skipped", {
          spokenWindow,
          sanitizedSpokenWindow,
          currentLineIndex: currentLineIndexRef.current,
          exactLineIndex,
          liveConfidence: transcript.liveAlignment.confidence,
          stalledChunks: stalledChunkCountRef.current,
        });
        return;
      }

      if (transcriptFingerprint === lastSemanticTranscriptFingerprintRef.current) {
        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-skipped-stale-transcript", {
          sanitizedSpokenWindow,
          transcriptFingerprint,
          currentLineIndex: currentLineIndexRef.current,
        });
        return;
      }

      if (Date.now() - lastSemanticAcceptedAtRef.current < SEMANTIC_JUMP_COOLDOWN_MS) {
        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-skipped-cooldown", {
          sanitizedSpokenWindow,
          currentLineIndex: currentLineIndexRef.current,
        });
        return;
      }

      if (
        sanitizedSpokenWindow &&
        sanitizedSpokenWindow === lastAcceptedSemanticWindowRef.current
      ) {
        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-skipped-reused-window", {
          sanitizedSpokenWindow,
          currentLineIndex: currentLineIndexRef.current,
        });
        return;
      }

      lastSemanticTranscriptFingerprintRef.current = transcriptFingerprint;

      const requestKey = [
        preparedScriptIdRef.current,
        transcriptFingerprint,
        sanitizedSpokenWindow,
      ].join(":");

      if (requestKey === lastSemanticRequestKeyRef.current) {
        return;
      }

      lastSemanticRequestKeyRef.current = requestKey;

      try {
        const candidate = await matchSemanticWindow({
          scriptId: preparedScriptIdRef.current,
          currentLineIndex: currentLineIndexRef.current,
          spokenWindow: sanitizedSpokenWindow,
          windowSize: DEFAULT_FORWARD_SEARCH_WINDOW,
        });

        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-candidate", {
          spokenWindow,
          sanitizedSpokenWindow,
          currentLineIndex: currentLineIndexRef.current,
          exactLineIndex,
          candidate,
          liveConfidence: transcript.liveAlignment.confidence,
          stalledChunks: stalledChunkCountRef.current,
        });

        if (cancelled) {
          return;
        }

        const resolution = resolveCandidateJump({
          candidate,
          spokenWindow,
        });

        if (!resolution.accepted) {
          console.info(SEMANTIC_DEBUG_PREFIX, "semantic-rejected", {
            spokenWindow,
            sanitizedSpokenWindow,
            candidate,
          });
          return;
        }

        const acceptedMatch = resolution.accepted;
        const nextAnchorIndex = getConfirmedIndexForLine(lines, acceptedMatch.lineIndex);

        transcriptManagerRef.current.promoteConfirmedIndex(nextAnchorIndex);
        setTranscript(transcriptManagerRef.current.getSnapshot());
        setSemanticMatch(acceptedMatch);
        lastAcceptedSemanticWindowRef.current = sanitizedSpokenWindow;
        lastSemanticAcceptedAtRef.current = Date.now();
        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-accepted", {
          spokenWindow,
          sanitizedSpokenWindow,
          acceptedMatch,
          nextAnchorIndex,
        });
        setCurrentLineIndex(acceptedMatch.lineIndex);
        stalledChunkCountRef.current = 0;
        lastExactLineIndexRef.current = Math.max(
          lastExactLineIndexRef.current,
          acceptedMatch.lineIndex - 1,
        );
      } catch (semanticError) {
        if (!cancelled) {
          handleError(
            semanticError,
            "Unable to evaluate semantic teleprompter progress.",
          );
        }
      }
    }

    void runSemanticRecovery();

    return () => {
      cancelled = true;
    };
  }, [
    handleError,
    lines,
    state,
    transcript.liveAlignment.confidence,
    transcript.liveAlignment.confirmedIndex,
    transcript.partialTranscript,
    transcript.stableTranscript,
  ]);

  async function startSession() {
    stopSession();
    setState("preparing");
    setError(null);
    transcriptManagerRef.current.resetSession();
    setTranscript(transcriptManagerRef.current.getSnapshot());
    preparedScriptIdRef.current = null;
    stalledChunkCountRef.current = 0;
    lastExactLineIndexRef.current = -1;
    lastSemanticRequestKeyRef.current = "";
    lastAcceptedSemanticWindowRef.current = "";
    lastSemanticTranscriptFingerprintRef.current = "";
    lastSemanticAcceptedAtRef.current = 0;
    setSemanticMatch(null);
    setCurrentLineIndex(lines.length > 0 ? 0 : -1);

    try {
      if (!preparedScriptIdRef.current) {
        const preparedScript = await prepareSemanticScript({
          script: initialScript,
          wordsPerLine,
        });

        preparedScriptIdRef.current = preparedScript.scriptId;
        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-prepared", preparedScript);
      } else {
        console.info(SEMANTIC_DEBUG_PREFIX, "semantic-prepare-reused", {
          scriptId: preparedScriptIdRef.current,
        });
      }
      setState("connecting");

      const token = await fetchTemporaryToken();
      const websocketUrl = new URL(WEBSOCKET_ENDPOINT);
      websocketUrl.searchParams.set("sample_rate", String(STREAM_SAMPLE_RATE));
      websocketUrl.searchParams.set("encoding", "pcm_s16le");
      websocketUrl.searchParams.set("format_turns", "true");
      websocketUrl.searchParams.set("speech_model", "universal-streaming-english");
      websocketUrl.searchParams.set("token", token);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = mediaStream;

      const websocket = new WebSocket(websocketUrl);
      websocket.binaryType = "arraybuffer";
      websocketRef.current = websocket;

      websocket.onopen = async () => {
        try {
          await beginAudioStreaming({
            mediaStream,
            websocket,
            audioContextRef,
            sourceNodeRef,
            processorNodeRef,
            silenceGainRef,
          });
        } catch (streamError) {
          handleError(streamError, "Unable to start the microphone stream.");
        }
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as AssemblyAiMessage;
          handleMessage(data);
        } catch {
          handleError(new Error("Unable to parse the AssemblyAI response."));
        }
      };

      websocket.onerror = () => {
        handleError(new Error("AssemblyAI WebSocket connection failed."));
      };

      websocket.onclose = () => {
        if (stateRef.current !== "error") {
          setState((currentState) =>
            currentState === "idle" ? currentState : "stopped",
          );
        }
      };
    } catch (sessionError) {
      handleError(sessionError, "Unable to initialize the AssemblyAI session.");
    }
  }

  function stopSession() {
    const websocket = websocketRef.current;

    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: "Terminate" }));
      websocket.close();
    } else if (websocket && websocket.readyState < WebSocket.CLOSING) {
      websocket.close();
    }

    cleanupResources();

    setState((currentState) => (currentState === "idle" ? currentState : "stopped"));
  }

  function resetSession() {
    stopSession();
    setError(null);
    transcriptManagerRef.current.resetSession();
    setTranscript(transcriptManagerRef.current.getSnapshot());
    stalledChunkCountRef.current = 0;
    lastExactLineIndexRef.current = -1;
    lastSemanticRequestKeyRef.current = "";
    lastAcceptedSemanticWindowRef.current = "";
    lastSemanticTranscriptFingerprintRef.current = "";
    lastSemanticAcceptedAtRef.current = 0;
    setSemanticMatch(null);
    setCurrentLineIndex(lines.length > 0 ? 0 : -1);
    setState("idle");
  }

  function seekToIndex(index: number) {
    transcriptManagerRef.current.seekToIndex(index);
    setTranscript(transcriptManagerRef.current.getSnapshot());
    setSemanticMatch(null);
    lastAcceptedSemanticWindowRef.current = "";
    lastSemanticTranscriptFingerprintRef.current = "";
    lastSemanticAcceptedAtRef.current = 0;
    setCurrentLineIndex(getLineIndexForConfirmedToken(lines, index));
  }

  function handleMessage(message: AssemblyAiMessage) {
    if (message.type === "Begin") {
      setState("listening");
      return;
    }

    if (message.type === "Termination") {
      setState("stopped");
      return;
    }

    transcriptManagerRef.current.applyTurn(message);
    setTranscript(transcriptManagerRef.current.getSnapshot());
  }

  return {
    state,
    error,
    transcript,
    currentLineIndex,
    semanticMatch,
    startSession,
    stopSession,
    resetSession,
    seekToIndex,
    setScript,
  };

  function setScript(script: string) {
    transcriptManagerRef.current.setScript(script);
    setTranscript(transcriptManagerRef.current.getSnapshot());
    preparedScriptIdRef.current = null;
    stalledChunkCountRef.current = 0;
    lastExactLineIndexRef.current = -1;
    lastSemanticRequestKeyRef.current = "";
    lastAcceptedSemanticWindowRef.current = "";
    lastSemanticTranscriptFingerprintRef.current = "";
    lastSemanticAcceptedAtRef.current = 0;
    setSemanticMatch(null);
    console.info(SEMANTIC_DEBUG_PREFIX, "semantic-invalidated-script-change");
  }
}

async function fetchTemporaryToken(): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Unable to fetch a temporary AssemblyAI token.");
  }

  const payload = (await response.json()) as { token?: string };

  if (!payload.token) {
    throw new Error("The AssemblyAI token response was missing a token.");
  }

  return payload.token;
}

async function beginAudioStreaming({
  mediaStream,
  websocket,
  audioContextRef,
  sourceNodeRef,
  processorNodeRef,
  silenceGainRef,
}: {
  mediaStream: MediaStream;
  websocket: WebSocket;
  audioContextRef: MutableRefObject<AudioContext | null>;
  sourceNodeRef: MutableRefObject<MediaStreamAudioSourceNode | null>;
  processorNodeRef: MutableRefObject<ScriptProcessorNode | null>;
  silenceGainRef: MutableRefObject<GainNode | null>;
}) {
  const audioContext = new AudioContext();
  audioContextRef.current = audioContext;
  await audioContext.resume();

  const sourceNode = audioContext.createMediaStreamSource(mediaStream);
  const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  const silenceGain = audioContext.createGain();

  silenceGain.gain.value = 0;
  sourceNode.connect(processorNode);
  processorNode.connect(silenceGain);
  silenceGain.connect(audioContext.destination);

  sourceNodeRef.current = sourceNode;
  processorNodeRef.current = processorNode;
  silenceGainRef.current = silenceGain;

  processorNode.onaudioprocess = (event) => {
    if (websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const channelData = event.inputBuffer.getChannelData(0);
    const pcmBuffer = convertFloat32ToPcm16(channelData, audioContext.sampleRate, STREAM_SAMPLE_RATE);

    if (pcmBuffer.byteLength > 0) {
      websocket.send(pcmBuffer);
    }
  };
}

function convertFloat32ToPcm16(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): ArrayBuffer {
  if (inputSampleRate === outputSampleRate) {
    return float32ToInt16Buffer(input);
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(input.length / sampleRateRatio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accumulator = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < input.length; index += 1) {
      accumulator += input[index];
      count += 1;
    }

    const sample = count > 0 ? accumulator / count : 0;
    result[offsetResult] = clampPcmSample(sample);
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result.buffer;
}

function float32ToInt16Buffer(input: Float32Array): ArrayBuffer {
  const result = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    result[index] = clampPcmSample(input[index]);
  }

  return result.buffer;
}

function clampPcmSample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}
