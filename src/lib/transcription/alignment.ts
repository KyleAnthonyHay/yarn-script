export interface ScriptToken {
  index: number;
  raw: string;
  normalized: string;
}

export interface AlignmentResult {
  confirmedIndex: number;
  matchedPhrase: string;
  confidence: number;
  transcriptTokens: string[];
}

const FILLER_TOKENS = new Set([
  "uh",
  "um",
  "erm",
  "hmm",
  "ah",
  "like",
]);

export function normalizeText(text: string): string {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeToken(token: string): string {
  return normalizeText(token);
}

export function tokenizeTranscript(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  return normalized.split(" ").filter(Boolean);
}

export function tokenizeScript(script: string): ScriptToken[] {
  const matches = script.match(/\S+\s*/g) ?? [];
  let nextIndex = 0;

  return matches.flatMap((rawToken) => {
    const normalized = normalizeToken(rawToken);

    if (!normalized) {
      return [];
    }

    const token: ScriptToken = {
      index: nextIndex,
      raw: rawToken,
      normalized,
    };

    nextIndex += 1;
    return [token];
  });
}

export function computeAlignment(
  scriptTokens: ScriptToken[],
  transcriptText: string,
  previousConfirmedIndex: number,
): AlignmentResult {
  const transcriptTokens = tokenizeTranscript(transcriptText);
  const recentTranscriptTokens = transcriptTokens.slice(-20);

  if (scriptTokens.length === 0 || recentTranscriptTokens.length === 0) {
    return {
      confirmedIndex: previousConfirmedIndex,
      matchedPhrase: "",
      confidence: 0,
      transcriptTokens: recentTranscriptTokens,
    };
  }

  let confirmedIndex = previousConfirmedIndex;
  let scriptCursor = Math.min(previousConfirmedIndex + 1, scriptTokens.length);
  let matches = 0;
  let relevantTranscriptTokens = 0;
  let lastMatchedTranscriptIndex = -1;

  for (let index = 0; index < recentTranscriptTokens.length; index += 1) {
    const transcriptToken = recentTranscriptTokens[index];

    if (FILLER_TOKENS.has(transcriptToken)) {
      continue;
    }

    relevantTranscriptTokens += 1;

    if (scriptCursor >= scriptTokens.length) {
      break;
    }

    const directMatch = matchAtPosition({
      scriptTokens,
      transcriptTokens: recentTranscriptTokens,
      scriptCursor,
      transcriptIndex: index,
    });

    if (directMatch) {
      confirmedIndex = directMatch.confirmedIndex;
      scriptCursor = directMatch.nextScriptCursor;
      matches += directMatch.matchedUnits;
      lastMatchedTranscriptIndex = directMatch.lastTranscriptIndex;
      index = directMatch.lastTranscriptIndex;
      continue;
    }

    const lookaheadMatch = findLookaheadMatch({
      scriptTokens,
      transcriptTokens: recentTranscriptTokens,
      scriptCursor,
      transcriptIndex: index,
    });

    if (lookaheadMatch) {
      confirmedIndex = lookaheadMatch.confirmedIndex;
      scriptCursor = lookaheadMatch.nextScriptCursor;
      matches += lookaheadMatch.matchedUnits;
      lastMatchedTranscriptIndex = lookaheadMatch.lastTranscriptIndex;
      index = lookaheadMatch.lastTranscriptIndex;
    }
  }

  const phraseStart = Math.max(0, lastMatchedTranscriptIndex - 4);
  const matchedPhrase =
    lastMatchedTranscriptIndex >= 0
      ? recentTranscriptTokens.slice(phraseStart, lastMatchedTranscriptIndex + 1).join(" ")
      : "";

  return {
    confirmedIndex,
    matchedPhrase,
    confidence:
      relevantTranscriptTokens > 0 ? Math.min(matches / relevantTranscriptTokens, 1) : 0,
    transcriptTokens: recentTranscriptTokens,
  };
}

interface MatchAtPositionParams {
  scriptTokens: ScriptToken[];
  transcriptTokens: string[];
  scriptCursor: number;
  transcriptIndex: number;
}

interface MatchAtPositionResult {
  confirmedIndex: number;
  nextScriptCursor: number;
  lastTranscriptIndex: number;
  matchedUnits: number;
}

function matchAtPosition({
  scriptTokens,
  transcriptTokens,
  scriptCursor,
  transcriptIndex,
}: MatchAtPositionParams): MatchAtPositionResult | null {
  const currentScriptToken = scriptTokens[scriptCursor];
  const currentTranscriptToken = transcriptTokens[transcriptIndex];

  if (!currentScriptToken || !currentTranscriptToken) {
    return null;
  }

  if (currentTranscriptToken === currentScriptToken.normalized) {
    return {
      confirmedIndex: scriptCursor,
      nextScriptCursor: scriptCursor + 1,
      lastTranscriptIndex: transcriptIndex,
      matchedUnits: 1,
    };
  }

  const compactScriptToken = compactToken(currentScriptToken.normalized);
  const compactTranscriptPair = compactToken(
    [currentTranscriptToken, transcriptTokens[transcriptIndex + 1] ?? ""].join(" "),
  );

  if (
    transcriptTokens[transcriptIndex + 1] &&
    compactTranscriptPair === compactScriptToken
  ) {
    return {
      confirmedIndex: scriptCursor,
      nextScriptCursor: scriptCursor + 1,
      lastTranscriptIndex: transcriptIndex + 1,
      matchedUnits: 1,
    };
  }

  const compactScriptPair = compactToken(
    [
      currentScriptToken.normalized,
      scriptTokens[scriptCursor + 1]?.normalized ?? "",
    ].join(" "),
  );

  if (scriptTokens[scriptCursor + 1] && compactScriptPair === compactToken(currentTranscriptToken)) {
    return {
      confirmedIndex: scriptCursor + 1,
      nextScriptCursor: scriptCursor + 2,
      lastTranscriptIndex: transcriptIndex,
      matchedUnits: 2,
    };
  }

  return null;
}

function findLookaheadMatch({
  scriptTokens,
  transcriptTokens,
  scriptCursor,
  transcriptIndex,
}: MatchAtPositionParams): MatchAtPositionResult | null {
  const MAX_SKIP = 2;
  const MIN_CONSECUTIVE_MATCHES = 2;

  for (
    let candidateIndex = scriptCursor + 1;
    candidateIndex <= Math.min(scriptCursor + MAX_SKIP, scriptTokens.length - 1);
    candidateIndex += 1
  ) {
    let matchedUnits = 0;
    let nextScriptCursor = candidateIndex;
    let nextTranscriptIndex = transcriptIndex;

    while (
      scriptTokens[nextScriptCursor]?.normalized &&
      transcriptTokens[nextTranscriptIndex] &&
      scriptTokens[nextScriptCursor].normalized === transcriptTokens[nextTranscriptIndex]
    ) {
      matchedUnits += 1;
      nextScriptCursor += 1;
      nextTranscriptIndex += 1;
    }

    if (
      matchedUnits >= MIN_CONSECUTIVE_MATCHES ||
      isRepeatedWordBridge({
        scriptTokens,
        scriptCursor,
        candidateIndex,
        matchedUnits,
      })
    ) {
      return {
        confirmedIndex: nextScriptCursor - 1,
        nextScriptCursor,
        lastTranscriptIndex: nextTranscriptIndex - 1,
        matchedUnits,
      };
    }
  }

  return null;
}

function isRepeatedWordBridge({
  scriptTokens,
  scriptCursor,
  candidateIndex,
  matchedUnits,
}: {
  scriptTokens: ScriptToken[];
  scriptCursor: number;
  candidateIndex: number;
  matchedUnits: number;
}): boolean {
  return (
    matchedUnits === 1 &&
    candidateIndex === scriptCursor + 1 &&
    scriptTokens[scriptCursor - 1]?.normalized === scriptTokens[scriptCursor]?.normalized
  );
}

function compactToken(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}
