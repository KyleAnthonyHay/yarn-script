"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAssemblyAiStreaming } from "@/hooks/useAssemblyAiStreaming";
import { TeleprompterPlaybackFacade } from "@/lib/teleprompter/TeleprompterPlaybackFacade";
import styles from "./page.module.css";

type View = "input" | "teleprompter";
type TextSize = "S" | "M" | "L";
type HighlightMode = "off" | "on";
const TEXT_SIZES: TextSize[] = ["S", "M", "L"];

const WORDS_PER_LINE = 5;
const VISIBLE_LINES = 4;
const SCROLL_DURATION_MS = 650;

const DEFAULT_SCRIPT = `Welcome to YarnScript. Paste your script, tap read back transcript, and start speaking. As AssemblyAI transcribes your voice, the words you have already said will turn bright. You can go off script, skip words, or ad-lib and the teleprompter will keep up with you. The goal is to make reading feel natural and effortless, so you can focus on delivery instead of losing your place. If you need to jump ahead or go back, just click any word and the teleprompter will reposition to that spot. The highlight will follow along from wherever you tapped, so you never lose your flow. Try changing the text size with the controls at the top of the screen, or toggle the highlight mode on and off to see which style works best for you. When you are finished reading, hit the stop button and the session will end cleanly. You can restart at any time to begin a fresh take from the top of your script.`;
const playbackFacade = new TeleprompterPlaybackFacade(WORDS_PER_LINE);

export default function Home() {
  const [view, setView] = useState<View>("input");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("off");
  const [textSize, setTextSize] = useState<TextSize>("M");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    state,
    error,
    transcript,
    startSession,
    stopSession,
    resetSession,
    seekToIndex,
    setScript: syncTranscriptScript,
  } = useAssemblyAiStreaming(script);

  const { scriptTokens, liveAlignment } = transcript;
  const displayConfirmedIndex = liveAlignment.confirmedIndex;

  const teleprompterRef = useRef<HTMLDivElement>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);

  const lines = useMemo(() => playbackFacade.buildLines(scriptTokens), [scriptTokens]);
  const { activeLineIndex, isComplete, spokenCount } = useMemo(
    () => playbackFacade.getPlaybackState(scriptTokens, lines, displayConfirmedIndex),
    [scriptTokens, lines, displayConfirmedIndex],
  );

  useEffect(() => {
    if (view !== "teleprompter" || !teleprompterRef.current || activeLineIndex < 0) return;

    const container = teleprompterRef.current;
    const target = container.querySelector<HTMLElement>(
      `[data-line-idx="${activeLineIndex}"]`,
    );

    if (!target) return;

    if (scrollAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
    }

    const centeredScrollTop =
      target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetScrollTop = Math.max(0, Math.min(centeredScrollTop, maxScrollTop));
    const startScrollTop = container.scrollTop;
    const distance = targetScrollTop - startScrollTop;

    if (Math.abs(distance) < 4) {
      container.scrollTop = targetScrollTop;
      return;
    }

    const startTime = performance.now();

    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / SCROLL_DURATION_MS, 1);
      const easedProgress = easeOutQuart(progress);

      container.scrollTop = startScrollTop + distance * easedProgress;

      if (progress < 1) {
        scrollAnimationFrameRef.current = requestAnimationFrame(animateScroll);
      } else {
        scrollAnimationFrameRef.current = null;
      }
    };

    scrollAnimationFrameRef.current = requestAnimationFrame(animateScroll);

    return () => {
      if (scrollAnimationFrameRef.current !== null) {
        cancelAnimationFrame(scrollAnimationFrameRef.current);
        scrollAnimationFrameRef.current = null;
      }
    };
  }, [view, activeLineIndex, textSize]);

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

  function handleRewind() {
    resetSession();
    if (teleprompterRef.current) {
      teleprompterRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleSeek(index: number) {
    seekToIndex(index);
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
              data-active={highlightMode === "on" ? "true" : "false"}
              onClick={() =>
                setHighlightMode((currentMode) => (currentMode === "on" ? "off" : "on"))
              }
            >
              {highlightMode === "on" ? "Highlight On" : "Highlight Off"}
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

        <div
          className={styles.teleprompter}
          ref={teleprompterRef}
          data-size={textSize}
          data-highlight-mode={highlightMode}
        >
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
                    const isSpoken =
                      highlightMode === "off"
                        ? true
                        : isPast || isActive;

                    return (
                      <button
                        type="button"
                        key={token.index}
                        className={`${styles.wordButton} ${
                          isSpoken ? styles.spokenWord : styles.pendingWord
                        }`}
                        onClick={() => handleSeek(token.index)}
                      >
                        {token.raw.trimEnd()}
                      </button>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <p className={styles.emptyState}>No script loaded.</p>
          )}
          {isComplete && (
            <button
              type="button"
              className={styles.rewindButton}
              onClick={handleRewind}
            >
              Rewind
            </button>
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
