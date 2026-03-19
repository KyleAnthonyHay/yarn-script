import { describe, expect, it } from "vitest";
import { TranscriptManager } from "./TranscriptManager";

describe("TranscriptManager", () => {
  it("tracks stable and partial transcript text separately", () => {
    const manager = new TranscriptManager("we should build a live teleprompter");

    manager.applyTurn({
      transcript: "we should build",
      words: [
        { text: "we", word_is_final: true },
        { text: "should", word_is_final: true },
        { text: "build", word_is_final: true },
      ],
    });

    const snapshot = manager.getSnapshot();

    expect(snapshot.stableTranscript).toBe("we should build");
    expect(snapshot.partialTranscript).toBe("we should build");
    expect(snapshot.alignment.confirmedIndex).toBe(2);
  });

  it("commits finalized turns once and ignores duplicate end-of-turn payloads", () => {
    const manager = new TranscriptManager("we should build a live teleprompter");

    manager.applyTurn({
      utterance: "we should build a live teleprompter",
      end_of_turn: true,
    });
    manager.applyTurn({
      utterance: "we should build a live teleprompter",
      end_of_turn: true,
    });

    const snapshot = manager.getSnapshot();

    expect(snapshot.stableTranscript).toBe("we should build a live teleprompter");
    expect(snapshot.alignment.confirmedIndex).toBe(5);
  });

  it("keeps alignment moving forward across multiple incremental turns", () => {
    const manager = new TranscriptManager("go go now");

    manager.applyTurn({
      transcript: "go",
      words: [{ text: "go", word_is_final: true }],
    });
    manager.applyTurn({
      transcript: "go now",
      words: [
        { text: "go", word_is_final: true },
        { text: "now", word_is_final: true },
      ],
    });

    expect(manager.getSnapshot().alignment.confirmedIndex).toBe(2);
  });

  it("resets transcript state when the script changes", () => {
    const manager = new TranscriptManager("old script");

    manager.applyTurn({
      utterance: "old script",
      end_of_turn: true,
    });
    manager.setScript("new script words");

    const snapshot = manager.getSnapshot();

    expect(snapshot.stableTranscript).toBe("");
    expect(snapshot.partialTranscript).toBe("");
    expect(snapshot.alignment.confirmedIndex).toBe(-1);
    expect(snapshot.scriptTokens).toHaveLength(3);
  });

  it("advances when final words arrive with different capitalization than the script", () => {
    const manager = new TranscriptManager("Welcome To YarnScript");

    manager.applyTurn({
      transcript: "welcome to yarnscript",
      words: [
        { text: "welcome", word_is_final: true },
        { text: "to", word_is_final: true },
        { text: "yarnscript", word_is_final: true },
      ],
    });

    expect(manager.getSnapshot().alignment.confirmedIndex).toBe(2);
  });

  it("advances when AssemblyAI splits a branded word into separate words", () => {
    const manager = new TranscriptManager("Welcome to YarnScript.");

    manager.applyTurn({
      utterance: "welcome to yarn script",
      end_of_turn: true,
    });

    expect(manager.getSnapshot().alignment.confirmedIndex).toBe(2);
  });
});
