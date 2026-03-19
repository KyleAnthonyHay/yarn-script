import { describe, expect, it } from "vitest";
import { tokenizeScript } from "../transcription/alignment";
import {
  buildSentenceSearchDocuments,
  buildSemanticSearchDocuments,
  buildTeleprompterLines,
  dedupeSemanticSearchDocuments,
} from "./teleprompterLines";

describe("semantic search documents", () => {
  it("builds overlapping multi-line windows for semantic matching", () => {
    const tokens = tokenizeScript(
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen",
    );
    const lines = buildTeleprompterLines(tokens, 5);
    const documents = buildSemanticSearchDocuments(lines, 3);

    expect(documents.map((document) => document.text)).toEqual([
      "one two three four five",
      "one two three four five six seven eight nine ten",
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen",
      "six seven eight nine ten",
      "six seven eight nine ten eleven twelve thirteen fourteen fifteen",
      "eleven twelve thirteen fourteen fifteen",
    ]);
    expect(documents[2]?.lineIndex).toBe(2);
  });

  it("builds sentence-shaped semantic documents that target the end line", () => {
    const script =
      "Welcome to YarnScript. You can restart at any time to begin a fresh take from the top of your script.";
    const lines = buildTeleprompterLines(tokenizeScript(script), 5);
    const documents = buildSentenceSearchDocuments(script, lines);

    expect(documents.map((document) => document.text)).toEqual([
      "Welcome to YarnScript.",
      "You can restart at any time to begin a fresh take from the top of your script.",
    ]);
    expect(documents[1]?.lineIndex).toBe(lines[lines.length - 1]?.lineIndex);
    expect(documents[1]?.kind).toBe("sentence");
  });

  it("dedupes duplicate semantic documents", () => {
    const documents = dedupeSemanticSearchDocuments([
      {
        lineIndex: 1,
        startLineIndex: 0,
        text: "Hello world",
        startTokenIndex: 0,
        endTokenIndex: 1,
        kind: "sentence",
      },
      {
        lineIndex: 1,
        startLineIndex: 0,
        text: "hello   world",
        startTokenIndex: 0,
        endTokenIndex: 1,
        kind: "sentence",
      },
    ]);

    expect(documents).toHaveLength(1);
  });
});
