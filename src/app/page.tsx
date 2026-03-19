"use client";

import { useState } from "react";
import { useAssemblyAiStreaming } from "@/hooks/useAssemblyAiStreaming";
import styles from "./page.module.css";

const DEFAULT_SCRIPT = `Welcome to YarnScript.

Paste your script, tap read back transcript, and start speaking.
As AssemblyAI transcribes your voice, the words you have already said will turn white.`;

export default function Home() {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const {
    state,
    error,
    transcript,
    startSession,
    stopSession,
    setScript: syncTranscriptScript,
  } = useAssemblyAiStreaming(script);
  const { scriptTokens, stableTranscript, partialTranscript, alignment } = transcript;

  const spokenCount = alignment.confirmedIndex + 1;
  const totalCount = scriptTokens.length;

  async function handlePaste() {
    try {
      const pastedText = await navigator.clipboard.readText();
      if (pastedText.trim().length > 0) {
        setScript(pastedText);
        syncTranscriptScript(pastedText);
      }
      setPasteError(null);
    } catch {
      setPasteError("Clipboard access was denied. Paste directly into the field.");
    }
  }

  async function handleStart() {
    await startSession();
  }

  const sessionLabel = {
    idle: "Idle",
    connecting: "Connecting",
    listening: "Listening",
    error: "Error",
    stopped: "Stopped",
  }[state];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>YarnScript</p>
          <h1>Live teleprompter highlighting from your voice.</h1>
        </div>
        <div className={styles.statusCard} data-state={state}>
          <span className={styles.statusLabel}>Session</span>
          <strong>{sessionLabel}</strong>
          <span className={styles.statusDot} data-state={state} />
        </div>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>Script Input</p>
              <h2>Paste the script you want to read.</h2>
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleStart}
              disabled={state === "connecting" || state === "listening" || !script.trim()}
            >
              Read Back Transcript
            </button>
          </div>

          <div className={styles.textareaWrap}>
            <textarea
              className={styles.textarea}
              value={script}
              onChange={(event) => {
                const nextScript = event.target.value;
                setScript(nextScript);
                syncTranscriptScript(nextScript);
              }}
              placeholder="Paste or write your script here..."
              spellCheck={false}
            />
            <button type="button" className={styles.pasteButton} onClick={handlePaste}>
              Paste
            </button>
          </div>

          <div className={styles.metaRow}>
            <p>
              {spokenCount} / {totalCount} words matched
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={stopSession}
                disabled={state !== "connecting" && state !== "listening"}
              >
                Stop
              </button>
            </div>
          </div>

          {(error ?? pasteError) ? (
            <p className={styles.errorText}>{error ?? pasteError}</p>
          ) : (
            <p className={styles.hintText}>
              Add your AssemblyAI key as <code>ASSEMBLYAI_API_KEY</code> in a local
              environment file before starting a session.
            </p>
          )}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>Live Script</p>
              <h2>Spoken words brighten as the transcript advances.</h2>
            </div>
          </div>

          <div className={styles.teleprompter}>
            {scriptTokens.length > 0 ? (
              scriptTokens.map((token) => (
                <span
                  key={token.index}
                  className={
                    token.index <= alignment.confirmedIndex
                      ? styles.spokenToken
                      : styles.pendingToken
                  }
                >
                  {token.raw}
                </span>
              ))
            ) : (
              <p className={styles.emptyState}>Your highlighted script will appear here.</p>
            )}
          </div>

          <div className={styles.debugGrid}>
            <div className={styles.debugCard}>
              <span className={styles.debugLabel}>Stable transcript</span>
              <p>{stableTranscript || "No confirmed transcript yet."}</p>
            </div>
            <div className={styles.debugCard}>
              <span className={styles.debugLabel}>Partial transcript</span>
              <p>{partialTranscript || "Waiting for speech..."}</p>
            </div>
            <div className={styles.debugCard}>
              <span className={styles.debugLabel}>Matched phrase</span>
              <p>{alignment.matchedPhrase || "No forward match yet."}</p>
            </div>
            <div className={styles.debugCard}>
              <span className={styles.debugLabel}>Confidence</span>
              <p>{alignment.confidence.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
