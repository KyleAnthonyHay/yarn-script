"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  TranscriptManager,
  type TranscriptManagerSnapshot,
} from "@/lib/transcription/TranscriptManager";
import type { TranscriptionSessionState } from "@/types/transcription";

const STREAM_SAMPLE_RATE = 16_000;
const TOKEN_ENDPOINT = "/api/assemblyai/token";
const WEBSOCKET_ENDPOINT = "wss://streaming.assemblyai.com/v3/ws";

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
  startSession: () => Promise<void>;
  stopSession: () => void;
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
};

export function useAssemblyAiStreaming(initialScript = ""): UseAssemblyAiStreamingResult {
  const [state, setState] = useState<TranscriptionSessionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptManagerSnapshot>(EMPTY_SNAPSHOT);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const silenceGainRef = useRef<GainNode | null>(null);
  const stateRef = useRef<TranscriptionSessionState>("idle");
  const transcriptManagerRef = useRef(new TranscriptManager(initialScript));

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

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    transcriptManagerRef.current.setScript(initialScript);
    setTranscript(transcriptManagerRef.current.getSnapshot());
  }, [initialScript]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, []);

  async function startSession() {
    stopSession();
    setState("connecting");
    setError(null);
    transcriptManagerRef.current.resetSession();
    setTranscript(transcriptManagerRef.current.getSnapshot());

    try {
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

  function handleError(
    cause: unknown,
    fallbackMessage = "Something went wrong while streaming transcription.",
  ) {
    const message = cause instanceof Error ? cause.message : fallbackMessage;
    setError(message || fallbackMessage);
    setState("error");
    cleanupResources();
  }

  return {
    state,
    error,
    transcript,
    startSession,
    stopSession,
    setScript,
  };

  function setScript(script: string) {
    transcriptManagerRef.current.setScript(script);
    setTranscript(transcriptManagerRef.current.getSnapshot());
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
