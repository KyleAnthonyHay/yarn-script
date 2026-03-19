import {
  computeAlignment,
  tokenizeScript,
  type AlignmentResult,
  type ScriptToken,
} from "./alignment";

export interface TranscriptManagerSnapshot {
  scriptTokens: ScriptToken[];
  stableTranscript: string;
  partialTranscript: string;
  alignment: AlignmentResult;
}

export interface TranscriptManagerTurn {
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
  words?: Array<{
    text: string;
    word_is_final?: boolean;
  }>;
}

const EMPTY_ALIGNMENT: AlignmentResult = {
  confirmedIndex: -1,
  matchedPhrase: "",
  confidence: 0,
  transcriptTokens: [],
};

export class TranscriptManager {
  private script = "";
  private scriptTokens: ScriptToken[] = [];
  private stableTranscript = "";
  private partialTranscript = "";
  private finalizedTurns: string[] = [];
  private partialFinalWords = "";
  private alignment: AlignmentResult = EMPTY_ALIGNMENT;
  private lastCommittedTurn = "";

  constructor(script = "") {
    this.setScript(script);
  }

  setScript(script: string) {
    if (script === this.script) {
      return;
    }

    this.script = script;
    this.scriptTokens = tokenizeScript(script);
    this.resetTranscriptState();
  }

  resetSession() {
    this.resetTranscriptState();
  }

  applyTurn(turn: TranscriptManagerTurn) {
    const stableTurnText = this.extractStableTurnText(turn);
    const displayText = (turn.utterance?.trim() || turn.transcript?.trim() || "").trim();

    if (turn.end_of_turn) {
      const finalTurnText = displayText || stableTurnText;

      if (finalTurnText && finalTurnText !== this.lastCommittedTurn) {
        this.finalizedTurns.push(finalTurnText);
        this.lastCommittedTurn = finalTurnText;
      }

      this.partialFinalWords = "";
      this.partialTranscript = "";
    } else {
      this.partialFinalWords = stableTurnText;
      this.partialTranscript = displayText;
    }

    this.stableTranscript = this.joinTranscriptParts([
      ...this.finalizedTurns,
      this.partialFinalWords,
    ]);

    this.alignment = computeAlignment(
      this.scriptTokens,
      this.stableTranscript,
      this.alignment.confirmedIndex,
    );
  }

  getSnapshot(): TranscriptManagerSnapshot {
    return {
      scriptTokens: this.scriptTokens,
      stableTranscript: this.stableTranscript,
      partialTranscript: this.partialTranscript,
      alignment: this.alignment,
    };
  }

  private resetTranscriptState() {
    this.stableTranscript = "";
    this.partialTranscript = "";
    this.finalizedTurns = [];
    this.partialFinalWords = "";
    this.lastCommittedTurn = "";
    this.alignment = {
      confirmedIndex: -1,
      matchedPhrase: "",
      confidence: 0,
      transcriptTokens: [],
    };
  }

  private extractStableTurnText(turn: TranscriptManagerTurn): string {
    const finalWords = turn.words?.filter((word) => word.word_is_final).map((word) => word.text);

    if (finalWords && finalWords.length > 0) {
      return finalWords.join(" ").trim();
    }

    if (turn.end_of_turn) {
      return turn.utterance?.trim() || turn.transcript?.trim() || "";
    }

    return "";
  }

  private joinTranscriptParts(parts: string[]): string {
    return parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
