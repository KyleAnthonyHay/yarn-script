import type { ScriptToken } from "@/lib/transcription/alignment";
import {
  buildTeleprompterLines,
  getConfirmedIndexForLine,
  type TeleprompterLine,
} from "@/lib/teleprompter/teleprompterLines";

interface PlaybackState {
  activeLineIndex: number;
  isComplete: boolean;
  spokenCount: number;
}

export class TeleprompterPlaybackFacade {
  constructor(private readonly wordsPerLine: number) {}

  buildLines(scriptTokens: ScriptToken[]): TeleprompterLine[] {
    return buildTeleprompterLines(scriptTokens, this.wordsPerLine);
  }

  getPlaybackState(
    scriptTokens: ScriptToken[],
    lines: TeleprompterLine[],
    currentLineIndex: number,
    confirmedIndex: number,
  ): PlaybackState {
    const semanticConfirmedIndex = getConfirmedIndexForLine(lines, currentLineIndex);
    const spokenCount = Math.max(0, Math.max(confirmedIndex, semanticConfirmedIndex) + 1);
    const isComplete = scriptTokens.length > 0 && spokenCount >= scriptTokens.length;

    if (lines.length === 0) {
      return {
        activeLineIndex: -1,
        isComplete,
        spokenCount,
      };
    }

    return {
      activeLineIndex:
        currentLineIndex >= 0 ? Math.min(currentLineIndex, lines.length - 1) : lines.length - 1,
      isComplete,
      spokenCount,
    };
  }
}
