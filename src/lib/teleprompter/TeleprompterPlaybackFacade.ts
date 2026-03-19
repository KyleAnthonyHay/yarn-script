import type { ScriptToken } from "@/lib/transcription/alignment";

interface PlaybackState {
  activeLineIndex: number;
  isComplete: boolean;
  spokenCount: number;
}

export class TeleprompterPlaybackFacade {
  constructor(private readonly wordsPerLine: number) {}

  buildLines(scriptTokens: ScriptToken[]): ScriptToken[][] {
    const lines: ScriptToken[][] = [];
    let currentLine: ScriptToken[] = [];

    for (const token of scriptTokens) {
      currentLine.push(token);
      if (currentLine.length === this.wordsPerLine) {
        lines.push(currentLine);
        currentLine = [];
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines;
  }

  getPlaybackState(scriptTokens: ScriptToken[], lines: ScriptToken[][], confirmedIndex: number): PlaybackState {
    const spokenCount = Math.max(0, confirmedIndex + 1);
    const isComplete = scriptTokens.length > 0 && spokenCount >= scriptTokens.length;

    if (lines.length === 0) {
      return {
        activeLineIndex: -1,
        isComplete,
        spokenCount,
      };
    }

    const activeLineIndex = lines.findIndex((line) =>
      line.some((token) => token.index > confirmedIndex),
    );

    return {
      activeLineIndex: activeLineIndex === -1 ? lines.length - 1 : activeLineIndex,
      isComplete,
      spokenCount,
    };
  }
}
