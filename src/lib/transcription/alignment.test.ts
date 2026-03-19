import { describe, expect, it } from "vitest";
import {
  computeAlignment,
  normalizeToken,
  normalizeText,
  tokenizeScript,
  tokenizeTranscript,
} from "./alignment";

describe("normalizeText", () => {
  it("removes punctuation and collapses whitespace", () => {
    expect(normalizeText(" Hello,\nYarnScript!!!  ")).toBe("hello yarnscript");
  });
});

describe("normalizeToken", () => {
  it("lowercases each token before matching", () => {
    expect(normalizeToken("YarnScript")).toBe("yarnscript");
  });
});

describe("tokenizeScript", () => {
  it("preserves the original token text for display", () => {
    expect(tokenizeScript("Hello, world!\n").map((token) => token.raw)).toEqual([
      "Hello, ",
      "world!\n",
    ]);
  });
});

describe("computeAlignment", () => {
  it("advances through an exact readback", () => {
    const scriptTokens = tokenizeScript("we should build a live teleprompter");

    const result = computeAlignment(scriptTokens, "we should build a live teleprompter", -1);

    expect(result.confirmedIndex).toBe(scriptTokens.length - 1);
  });

  it("ignores filler words", () => {
    const scriptTokens = tokenizeScript("we should build a live teleprompter");

    const result = computeAlignment(scriptTokens, "um we should build", -1);

    expect(result.confirmedIndex).toBe(2);
  });

  it("allows skipped script words within a short lookahead", () => {
    const scriptTokens = tokenizeScript("we should build a very helpful teleprompter");

    const result = computeAlignment(scriptTokens, "we should build helpful teleprompter", -1);

    expect(result.confirmedIndex).toBe(6);
  });

  it("ignores ad-libbed words without regressing progress", () => {
    const scriptTokens = tokenizeScript("this teleprompter follows your pace");

    const result = computeAlignment(
      scriptTokens,
      "this teleprompter honestly really follows your pace",
      -1,
    );

    expect(result.confirmedIndex).toBe(scriptTokens.length - 1);
  });

  it("handles repeated words without jumping backward", () => {
    const scriptTokens = tokenizeScript("go go now");

    const result = computeAlignment(scriptTokens, "go now", -1);

    expect(result.confirmedIndex).toBe(2);
  });

  it("never moves the pointer backward", () => {
    const scriptTokens = tokenizeScript("we should keep moving forward");

    const result = computeAlignment(scriptTokens, "we should", 3);

    expect(result.confirmedIndex).toBe(3);
  });

  it("normalizes transcript tokens consistently", () => {
    expect(tokenizeTranscript("Wait...   what?")).toEqual(["wait", "what"]);
  });

  it("matches script and transcript regardless of capitalization", () => {
    const scriptTokens = tokenizeScript("Welcome To YarnScript");

    const result = computeAlignment(scriptTokens, "welcome to yarnscript", -1);

    expect(result.confirmedIndex).toBe(scriptTokens.length - 1);
  });

  it("matches a compound script token against split transcript words", () => {
    const scriptTokens = tokenizeScript("Welcome to YarnScript.");

    const result = computeAlignment(scriptTokens, "welcome to yarn script", -1);

    expect(result.confirmedIndex).toBe(scriptTokens.length - 1);
  });

  it("matches split script words against a compounded transcript token", () => {
    const scriptTokens = tokenizeScript("Welcome to yarn script.");

    const result = computeAlignment(scriptTokens, "welcome to yarnscript", -1);

    expect(result.confirmedIndex).toBe(scriptTokens.length - 1);
  });
});
