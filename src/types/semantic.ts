export interface PreparedScriptMetadata {
  scriptId: string;
  lineCount: number;
  wordsPerLine: number;
}

export interface SemanticMatchResult {
  lineIndex: number;
  score: number;
  threshold: number;
  jumpDistance: number;
  lineText: string;
}

export interface SemanticRecoveryState {
  scriptId: string | null;
  currentLineIndex: number;
  semanticMatch: SemanticMatchResult | null;
}
