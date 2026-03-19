import type { SemanticMatchResult } from "@/types/semantic";

export const DEFAULT_FORWARD_SEARCH_WINDOW = 36;
const HIGH_CONFIDENCE_FAR_JUMP_MARGIN = 0.12;

interface ThresholdRule {
  maxDistance: number;
  threshold: number;
}

const THRESHOLD_RULES: ThresholdRule[] = [
  { maxDistance: 3, threshold: 0.65 },
  { maxDistance: 10, threshold: 0.72 },
  { maxDistance: Number.POSITIVE_INFINITY, threshold: 0.8 },
];

export function getSimilarityThreshold(jumpDistance: number): number {
  return (
    THRESHOLD_RULES.find((rule) => jumpDistance <= rule.maxDistance)?.threshold ??
    THRESHOLD_RULES[THRESHOLD_RULES.length - 1].threshold
  );
}

export function shouldAttemptSemanticRecovery(params: {
  exactLineIndex: number;
  currentLineIndex: number;
  liveConfidence: number;
  stalledChunks: number;
  spokenWindowWordCount: number;
}): boolean {
  const {
    exactLineIndex,
    currentLineIndex,
    liveConfidence,
    stalledChunks,
    spokenWindowWordCount,
  } = params;

  if (spokenWindowWordCount < 4) {
    return false;
  }

  if (exactLineIndex > currentLineIndex) {
    return false;
  }

  return liveConfidence < 0.62 || stalledChunks >= 1;
}

export function buildSpokenWindow(text: string, maxWords = 28): string {
  const words = collapseRepeatedWords(
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );

  return words.slice(-maxWords).join(" ");
}

export function sanitizeSpokenWindow(text: string, maxWords = 18): string {
  const normalizedWords = text
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const collapsedWords = collapseRepeatedWords(normalizedWords);
  return collapsedWords.slice(-maxWords).join(" ");
}

export function normalizeSemanticCandidate(params: {
  candidate: SemanticMatchResult;
  currentLineIndex: number;
  maxForwardJump?: number;
}): SemanticMatchResult | null {
  const { candidate, currentLineIndex, maxForwardJump = DEFAULT_FORWARD_SEARCH_WINDOW } = params;

  if (candidate.lineIndex <= currentLineIndex) {
    return null;
  }

  const jumpDistance = candidate.lineIndex - currentLineIndex;

  if (jumpDistance > maxForwardJump) {
    return null;
  }

  const threshold = getSimilarityThreshold(jumpDistance);

  if (candidate.score < threshold) {
    return null;
  }

  return {
    ...candidate,
    jumpDistance,
    threshold,
  };
}

export function resolveCandidateJump(params: {
  candidate: SemanticMatchResult | null;
  spokenWindow?: string;
}): {
  accepted: SemanticMatchResult | null;
} {
  const { candidate, spokenWindow = "" } = params;

  if (!candidate) {
    return {
      accepted: null,
    };
  }

  if (candidate.jumpDistance <= 3) {
    return {
      accepted: candidate,
    };
  }

  if (isVerbatimForwardMatch(spokenWindow, candidate.lineText)) {
    return {
      accepted: candidate,
    };
  }

  if (candidate.score >= candidate.threshold + HIGH_CONFIDENCE_FAR_JUMP_MARGIN) {
    return {
      accepted: candidate,
    };
  }

  return {
    accepted: candidate,
  };
}

export function isVerbatimForwardMatch(spokenWindow: string, candidateText: string): boolean {
  const normalizedSpokenWindow = normalizeForComparison(spokenWindow);
  const normalizedCandidateText = normalizeForComparison(candidateText);

  if (!normalizedSpokenWindow || !normalizedCandidateText) {
    return false;
  }

  const spokenWordCount = normalizedSpokenWindow.split(" ").filter(Boolean).length;

  if (spokenWordCount < 5) {
    return false;
  }

  return (
    normalizedCandidateText.includes(normalizedSpokenWindow) ||
    normalizedSpokenWindow.includes(normalizedCandidateText)
  );
}

function normalizeForComparison(text: string): string {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseRepeatedWords(words: string[]): string[] {
  const collapsed: string[] = [];
  let index = 0;

  while (index < words.length) {
    let skippedRepeatedPhrase = false;

    for (let phraseLength = Math.min(4, Math.floor((words.length - index) / 2)); phraseLength >= 1; phraseLength -= 1) {
      const leftPhrase = words.slice(index, index + phraseLength).join(" ");
      const rightPhrase = words.slice(index + phraseLength, index + phraseLength * 2).join(" ");

      if (leftPhrase && leftPhrase === rightPhrase) {
        collapsed.push(...words.slice(index, index + phraseLength));
        index += phraseLength * 2;
        skippedRepeatedPhrase = true;
        break;
      }
    }

    if (skippedRepeatedPhrase) {
      continue;
    }

    if (collapsed[collapsed.length - 1] !== words[index]) {
      collapsed.push(words[index]);
    }

    index += 1;
  }

  return collapsed;
}
