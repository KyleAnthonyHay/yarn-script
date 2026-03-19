"use client";

import { useEffect, useRef, useState } from "react";
import { useAssemblyAiStreaming } from "@/hooks/useAssemblyAiStreaming";
import styles from "./page.module.css";

type View = "input" | "teleprompter";
type TextSize = "S" | "M" | "L";
const TEXT_SIZES: TextSize[] = ["S", "M", "L"];

const WORDS_PER_LINE = 5;
const VISIBLE_LINES = 4;

const DEFAULT_SCRIPT = `Welcome to YarnScript. Paste your script, tap read back transcript, and start speaking. As AssemblyAI transcribes your voice, the words you have already said will turn bright. You can go off script, skip words, or ad-lib and the teleprompter will keep up with you. The goal is to make reading feel natural and effortless, so you can focus on delivery instead of losing your place.`;

export default function Home() {
  const [view, setView] = useState<View>("input");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [highlights, setHighlights] = useState(true);
  const [textSize, setTextSize] = useState<TextSize>("S");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    state,
    error,
    transcript,
    startSession,
    stopSession,
    setScript: syncTranscriptScript,
  } = useAssemblyAiStreaming(script);

  const { scriptTokens, alignment } = transcript;
  const spokenCount = alignment.confirmedIndex + 1;

  const teleprompterRef = useRef<HTMLDivElement>(null);

  const lines: { index: number; raw: string }[][] = [];
  let currentLine: { index: number; raw: string }[] = [];
  for (const token of scriptTokens) {
    currentLine.push(token);
    if (currentLine.length === WORDS_PER_LINE) {
      lines.push(currentLine);
      currentLine = [];
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  const activeLineIndex = lines.findIndex((line) =>
    line.some((t) => t.index > alignment.confirmedIndex),
  );

  const spokenOnActiveLine =
    activeLineIndex >= 0
      ? lines[activeLineIndex].filter((t) => t.index <= alignment.confirmedIndex).length
      : 0;
  const activeLineLength = activeLineIndex >= 0 ? lines[activeLineIndex].length : 1;
  const pastMidpoint = spokenOnActiveLine >= Math.ceil(activeLineLength / 2);

  const scrollTargetIndex = pastMidpoint && activeLineIndex < lines.length - 1
    ? activeLineIndex + 1
    : activeLineIndex;

  useEffect(() => {
    if (view !== "teleprompter" || !teleprompterRef.current) return;
    const target = teleprompterRef.current.querySelector(
      `[data-line-idx="${scrollTargetIndex}"]`,
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [spokenCount, view, scrollTargetIndex]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      if (text.trim().length > 0) {
        setScript(text);
        syncTranscriptScript(text);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleStart() {
    setView("teleprompter");
    await startSession();
  }

  function handleBack() {
    stopSession();
    setView("input");
  }

  const isSessionActive = state === "connecting" || state === "listening";
  const canStart = script.trim().length > 0 && !isSessionActive;

  if (view === "input") {
    return (
      <main className={styles.page}>
        <div className={styles.inputView}>
          <header className={styles.brand}>
            <span className={styles.logo}>Y</span>
            <span className={styles.brandName}>YarnScript</span>
          </header>

          <h1 className={styles.headline}>
            Paste your script,<br />
            then read it back.
          </h1>

          <div className={styles.inputCard}>
            <div className={styles.textareaWrap}>
              <textarea
                className={styles.textarea}
                value={script}
                onChange={(e) => {
                  setScript(e.target.value);
                  syncTranscriptScript(e.target.value);
                }}
                placeholder="Paste transcript here"
                spellCheck={false}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                className={styles.hiddenInput}
                onChange={handleFileUpload}
              />
              <button
                type="button"
                className={styles.uploadChip}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload .txt file"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className={styles.tooltip}>Upload .txt file</span>
              </button>
            </div>

            <button
              type="button"
              className={styles.startButton}
              onClick={handleStart}
              disabled={!canStart}
            >
              Read Back Transcript
            </button>

            {error && <p className={styles.errorText}>{error}</p>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.teleprompterView}>
        <header className={styles.teleprompterBar}>
          <button type="button" className={styles.backButton} onClick={handleBack}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <div className={styles.statusPill} data-state={state}>
            <span className={styles.statusDot} data-state={state} />
            <span>
              {{ idle: "Ready", connecting: "Connecting", listening: "Listening", error: "Error", stopped: "Done" }[state]}
            </span>
          </div>

          <div className={styles.barActions}>
            <div className={styles.sizePicker}>
              {TEXT_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={styles.sizeOption}
                  data-active={textSize === size ? "true" : "false"}
                  onClick={() => setTextSize(size)}
                >
                  {size}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={styles.highlightToggle}
              data-active={highlights ? "true" : "false"}
              onClick={() => setHighlights((h) => !h)}
            >
              {highlights ? "Highlights on" : "Highlights off"}
            </button>

            {isSessionActive && (
              <button type="button" className={styles.stopButton} onClick={stopSession}>
                Stop
              </button>
            )}

            {!isSessionActive && (
              <button
                type="button"
                className={styles.restartButton}
                onClick={() => startSession()}
              >
                Restart
              </button>
            )}
          </div>
        </header>

        <div className={styles.teleprompter} ref={teleprompterRef} data-size={textSize}>
          <div className={styles.teleprompterSpacer} />
          {lines.length > 0 ? (
            lines.map((line, lineIdx) => {
              const isActive =
                lineIdx === activeLineIndex ||
                (activeLineIndex === -1 && lineIdx === lines.length - 1);
              const isPast =
                activeLineIndex !== -1
                  ? lineIdx < activeLineIndex
                  : true;
              const isFuture = activeLineIndex !== -1 && lineIdx > activeLineIndex;
              const distanceFromActive = activeLineIndex !== -1 ? Math.abs(lineIdx - activeLineIndex) : 0;
              const isVisible = distanceFromActive <= VISIBLE_LINES;

              return (
                <div
                  key={lineIdx}
                  className={styles.teleprompterLine}
                  data-line-idx={lineIdx}
                  data-line-active={isActive ? "true" : "false"}
                  data-line-past={isPast && !isActive ? "true" : "false"}
                  data-line-future={isFuture ? "true" : "false"}
                  data-line-visible={isVisible ? "true" : "false"}
                >
                  {line.map((token) => {
                    const lineHasSpoken = line.some((t) => t.index <= alignment.confirmedIndex);
                    const isSpoken = highlights
                      ? token.index <= alignment.confirmedIndex
                      : isPast || (isActive && lineHasSpoken);

                    return (
                      <span
                        key={token.index}
                        className={isSpoken ? styles.spokenWord : styles.pendingWord}
                      >
                        {token.raw}
                      </span>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <p className={styles.emptyState}>No script loaded.</p>
          )}
          <div className={styles.teleprompterSpacer} />
        </div>

        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{
              width: scriptTokens.length > 0
                ? `${(spokenCount / scriptTokens.length) * 100}%`
                : "0%",
            }}
          />
        </div>
      </div>
    </main>
  );
}
