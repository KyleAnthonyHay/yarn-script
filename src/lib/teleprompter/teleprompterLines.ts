import type { ScriptToken } from "@/lib/transcription/alignment";

export interface TeleprompterLine {
  lineIndex: number;
  tokens: ScriptToken[];
  text: string;
  startTokenIndex: number;
  endTokenIndex: number;
}

export interface SemanticSearchDocument {
  lineIndex: number;
  startLineIndex: number;
  text: string;
  startTokenIndex: number;
  endTokenIndex: number;
  kind: "line_window" | "sentence";
}

export function buildTeleprompterLines(
  scriptTokens: ScriptToken[],
  wordsPerLine: number,
): TeleprompterLine[] {
  if (wordsPerLine <= 0) {
    return [];
  }

  const lines: TeleprompterLine[] = [];
  let currentLineTokens: ScriptToken[] = [];

  for (const token of scriptTokens) {
    currentLineTokens.push(token);

    if (currentLineTokens.length === wordsPerLine) {
      lines.push(createLine(lines.length, currentLineTokens));
      currentLineTokens = [];
    }
  }

  if (currentLineTokens.length > 0) {
    lines.push(createLine(lines.length, currentLineTokens));
  }

  return lines;
}

export function getLineIndexForConfirmedToken(
  lines: TeleprompterLine[],
  confirmedIndex: number,
): number {
  if (lines.length === 0) {
    return -1;
  }

  const nextLine = lines.find((line) => line.endTokenIndex > confirmedIndex);
  return nextLine?.lineIndex ?? lines.length - 1;
}

export function getConfirmedIndexForLine(
  lines: TeleprompterLine[],
  lineIndex: number,
): number {
  if (lines.length === 0 || lineIndex <= 0) {
    return -1;
  }

  return lines[Math.min(lineIndex - 1, lines.length - 1)].endTokenIndex;
}

export function buildSemanticSearchDocuments(
  lines: TeleprompterLine[],
  maxWindowLines = 4,
): SemanticSearchDocument[] {
  const documents: SemanticSearchDocument[] = [];

  for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
    for (
      let endIndex = startIndex;
      endIndex < Math.min(lines.length, startIndex + maxWindowLines);
      endIndex += 1
    ) {
      const windowLines = lines.slice(startIndex, endIndex + 1);

      documents.push({
        lineIndex: windowLines[windowLines.length - 1].lineIndex,
        startLineIndex: windowLines[0].lineIndex,
        text: windowLines.map((line) => line.text).join(" "),
        startTokenIndex: windowLines[0].startTokenIndex,
        endTokenIndex: windowLines[windowLines.length - 1].endTokenIndex,
        kind: "line_window",
      });
    }
  }

  return documents;
}

export function buildSentenceSearchDocuments(
  script: string,
  lines: TeleprompterLine[],
): SemanticSearchDocument[] {
  const segments = script
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const documents: SemanticSearchDocument[] = [];
  let nextTokenIndex = 0;

  for (const segment of segments) {
    const tokenCount = segment
      .toLocaleLowerCase("en-US")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean).length;

    if (tokenCount === 0) {
      continue;
    }

    const startTokenIndex = nextTokenIndex;
    const endTokenIndex = nextTokenIndex + tokenCount - 1;
    nextTokenIndex += tokenCount;

    const startLineIndex =
      lines.find((line) => line.endTokenIndex >= startTokenIndex)?.lineIndex ?? 0;
    const endLineIndex =
      lines.find((line) => line.endTokenIndex >= endTokenIndex)?.lineIndex ??
      lines[lines.length - 1]?.lineIndex ??
      startLineIndex;

    documents.push({
      lineIndex: endLineIndex,
      startLineIndex,
      text: segment,
      startTokenIndex,
      endTokenIndex,
      kind: "sentence",
    });
  }

  return documents;
}

export function dedupeSemanticSearchDocuments(
  documents: SemanticSearchDocument[],
): SemanticSearchDocument[] {
  const seen = new Set<string>();

  return documents.filter((document) => {
    const key = [
      document.kind,
      document.startTokenIndex,
      document.endTokenIndex,
      document.text.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim(),
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function createLine(lineIndex: number, tokens: ScriptToken[]): TeleprompterLine {
  return {
    lineIndex,
    tokens,
    text: tokens.map((token) => token.raw).join("").replace(/\s+/g, " ").trim(),
    startTokenIndex: tokens[0].index,
    endTokenIndex: tokens[tokens.length - 1].index,
  };
}
