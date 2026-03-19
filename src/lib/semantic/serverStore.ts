import type { PreparedScriptMetadata, SemanticMatchResult } from "@/types/semantic";

interface StoredSemanticLine {
  lineIndex: number;
  text: string;
  embedding: number[];
  startTokenIndex: number;
  endTokenIndex: number;
}

interface StoredSemanticScript {
  scriptId: string;
  scriptHash: string;
  scriptText: string;
  lineCount: number;
  wordsPerLine: number;
  lines: StoredSemanticLine[];
}

const globalStore = globalThis as typeof globalThis & {
  __semanticScriptStore__?: Map<string, StoredSemanticScript>;
  __semanticScriptHashLookup__?: Map<string, string>;
};

const scripts =
  globalStore.__semanticScriptStore__ ?? (globalStore.__semanticScriptStore__ = new Map());
const scriptHashLookup =
  globalStore.__semanticScriptHashLookup__ ??
  (globalStore.__semanticScriptHashLookup__ = new Map());

export function getPreparedSemanticScriptByHash(
  scriptHash: string,
): PreparedScriptMetadata | null {
  const scriptId = scriptHashLookup.get(scriptHash);

  if (!scriptId) {
    return null;
  }

  const script = scripts.get(scriptId);

  if (!script) {
    return null;
  }

  return {
    scriptId: script.scriptId,
    lineCount: script.lineCount,
    wordsPerLine: script.wordsPerLine,
  };
}

export function storePreparedSemanticScript(params: {
  scriptId: string;
  scriptHash: string;
  scriptText: string;
  wordsPerLine: number;
  lineCount?: number;
  lines: StoredSemanticLine[];
}): PreparedScriptMetadata {
  const script: StoredSemanticScript = {
    scriptId: params.scriptId,
    scriptHash: params.scriptHash,
    scriptText: params.scriptText,
    lineCount: params.lineCount ?? params.lines.length,
    wordsPerLine: params.wordsPerLine,
    lines: params.lines,
  };

  scripts.set(script.scriptId, script);
  scriptHashLookup.set(script.scriptHash, script.scriptId);

  return {
    scriptId: script.scriptId,
    lineCount: script.lineCount,
    wordsPerLine: script.wordsPerLine,
  };
}

export function getPreparedSemanticLines(scriptId: string): StoredSemanticLine[] {
  return scripts.get(scriptId)?.lines ?? [];
}

export function matchPreparedSemanticScript(params: {
  scriptId: string;
  embedding: number[];
  currentLineIndex: number;
  windowSize: number;
}): SemanticMatchResult | null {
  const script = scripts.get(params.scriptId);

  if (!script) {
    return null;
  }

  const maxLineIndex = params.currentLineIndex + Math.max(params.windowSize, 1);
  let bestMatch: SemanticMatchResult | null = null;

  for (const line of script.lines) {
    if (line.lineIndex <= params.currentLineIndex || line.lineIndex > maxLineIndex) {
      continue;
    }

    const score = cosineSimilarity(params.embedding, line.embedding);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        lineIndex: line.lineIndex,
        score,
        threshold: 0,
        jumpDistance: line.lineIndex - params.currentLineIndex,
        lineText: line.text,
      };
    }
  }

  return bestMatch;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return -1;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? -1 : dotProduct / denominator;
}
