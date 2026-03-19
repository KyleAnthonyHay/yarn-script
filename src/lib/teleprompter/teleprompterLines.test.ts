import { describe, expect, it } from "vitest";
import { tokenizeScript } from "../transcription/alignment";
import {
  buildTeleprompterLines,
  getConfirmedIndexForLine,
  getLineIndexForConfirmedToken,
} from "./teleprompterLines";

describe("teleprompterLines", () => {
  it("chunks script tokens into five-word teleprompter lines", () => {
    const tokens = tokenizeScript("one two three four five six seven eight nine ten eleven");
    const lines = buildTeleprompterLines(tokens, 5);

    expect(lines.map((line) => line.text)).toEqual([
      "one two three four five",
      "six seven eight nine ten",
      "eleven",
    ]);
  });

  it("maps confirmed token indexes back to the current active line", () => {
    const tokens = tokenizeScript("one two three four five six seven eight nine ten");
    const lines = buildTeleprompterLines(tokens, 5);

    expect(getLineIndexForConfirmedToken(lines, -1)).toBe(0);
    expect(getLineIndexForConfirmedToken(lines, 3)).toBe(0);
    expect(getLineIndexForConfirmedToken(lines, 4)).toBe(1);
    expect(getLineIndexForConfirmedToken(lines, 99)).toBe(1);
  });

  it("computes the semantic anchor token index for a given line", () => {
    const tokens = tokenizeScript("one two three four five six seven");
    const lines = buildTeleprompterLines(tokens, 5);

    expect(getConfirmedIndexForLine(lines, 0)).toBe(-1);
    expect(getConfirmedIndexForLine(lines, 1)).toBe(4);
    expect(getConfirmedIndexForLine(lines, 2)).toBe(6);
  });
});
