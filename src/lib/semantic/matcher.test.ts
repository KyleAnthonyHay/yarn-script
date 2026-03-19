import { describe, expect, it } from "vitest";
import {
  buildSpokenWindow,
  getSimilarityThreshold,
  isVerbatimForwardMatch,
  normalizeSemanticCandidate,
  resolveCandidateJump,
  sanitizeSpokenWindow,
  shouldAttemptSemanticRecovery,
} from "./matcher";

describe("semantic matcher", () => {
  it("returns thresholds by jump distance", () => {
    expect(getSimilarityThreshold(1)).toBe(0.65);
    expect(getSimilarityThreshold(6)).toBe(0.72);
    expect(getSimilarityThreshold(12)).toBe(0.8);
  });

  it("accepts near jumps that clear threshold and window checks", () => {
    const candidate = normalizeSemanticCandidate({
      candidate: {
        lineIndex: 4,
        score: 0.66,
        threshold: 0,
        jumpDistance: 0,
        lineText: "line four",
      },
      currentLineIndex: 2,
    });

    expect(candidate).toMatchObject({
      lineIndex: 4,
      jumpDistance: 2,
      threshold: 0.65,
    });
  });

  it("rejects far jumps below threshold", () => {
    const candidate = normalizeSemanticCandidate({
      candidate: {
        lineIndex: 15,
        score: 0.79,
        threshold: 0,
        jumpDistance: 0,
        lineText: "line fifteen",
      },
      currentLineIndex: 2,
    });

    expect(candidate).toBeNull();
  });

  it("requires confirmation before accepting far jumps", () => {
    const candidate = normalizeSemanticCandidate({
      candidate: {
        lineIndex: 9,
        score: 0.8,
        threshold: 0,
        jumpDistance: 0,
        lineText: "line nine",
      },
      currentLineIndex: 2,
    });

    const result = resolveCandidateJump({
      candidate,
      spokenWindow: "line nine maybe",
    });

    expect(result.accepted).toMatchObject({
      lineIndex: 9,
    });
  });

  it("accepts a far jump immediately for a verbatim forward phrase", () => {
    const candidate = normalizeSemanticCandidate({
      candidate: {
        lineIndex: 12,
        score: 0.9,
        threshold: 0,
        jumpDistance: 0,
        lineText: "feel natural and effortless so you can focus on delivery instead of losing your place",
      },
      currentLineIndex: 0,
    });

    const result = resolveCandidateJump({
      candidate,
      spokenWindow:
        "feel natural and effortless so you can focus on delivery instead of losing your place",
    });

    expect(result.accepted).toMatchObject({
      lineIndex: 12,
    });
  });

  it("accepts a far jump immediately when confidence is well above threshold", () => {
    const candidate = normalizeSemanticCandidate({
      candidate: {
        lineIndex: 8,
        score: 0.9,
        threshold: 0,
        jumpDistance: 0,
        lineText: "you can go off script skip words or ad lib and the teleprompter will keep up with you",
      },
      currentLineIndex: 0,
    });

    const result = resolveCandidateJump({
      candidate,
      spokenWindow:
        "you can skip words or ad lib and the teleprompter can follow up with you",
    });

    expect(result.accepted).toMatchObject({
      lineIndex: 8,
    });
  });

  it("ignores backward or out-of-window candidates", () => {
    expect(
      normalizeSemanticCandidate({
        candidate: {
          lineIndex: 1,
          score: 0.99,
          threshold: 0,
          jumpDistance: 0,
          lineText: "backward",
        },
        currentLineIndex: 3,
      }),
    ).toBeNull();

    expect(
      normalizeSemanticCandidate({
        candidate: {
          lineIndex: 50,
          score: 0.99,
          threshold: 0,
          jumpDistance: 0,
          lineText: "too far",
        },
        currentLineIndex: 3,
        maxForwardJump: 20,
      }),
    ).toBeNull();
  });

  it("only attempts semantic recovery when token matching stalls or confidence drops", () => {
    expect(
      shouldAttemptSemanticRecovery({
        exactLineIndex: 4,
        currentLineIndex: 2,
        liveConfidence: 0.2,
        stalledChunks: 5,
        spokenWindowWordCount: 8,
      }),
    ).toBe(false);

    expect(
      shouldAttemptSemanticRecovery({
        exactLineIndex: 2,
        currentLineIndex: 2,
        liveConfidence: 0.4,
        stalledChunks: 1,
        spokenWindowWordCount: 8,
      }),
    ).toBe(true);

    expect(
      shouldAttemptSemanticRecovery({
        exactLineIndex: 2,
        currentLineIndex: 2,
        liveConfidence: 0.8,
        stalledChunks: 1,
        spokenWindowWordCount: 8,
      }),
    ).toBe(true);
  });

  it("builds a recent spoken window from the tail of the transcript", () => {
    expect(buildSpokenWindow("one two three four five six", 3)).toBe("four five six");
  });

  it("sanitizes spoken windows by collapsing duplicate partial words", () => {
    expect(
      sanitizeSpokenWindow(
        "feel natural feel natural and effortless so you can focus focus on delivery",
      ),
    ).toBe("feel natural and effortless so you can focus on delivery");
  });

  it("detects verbatim matches against a larger forward chunk", () => {
    expect(
      isVerbatimForwardMatch(
        "try changing the text size with the controls at the top of the screen",
        "flow try changing the text size with the controls at the top of the screen or toggle the highlight mode",
      ),
    ).toBe(true);
  });
});
