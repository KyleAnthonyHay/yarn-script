import { fetchAction } from "convex/nextjs";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { matchPreparedScriptRef } from "@/lib/convex/functionReferences";
import { normalizeSemanticCandidate } from "@/lib/semantic/matcher";
import {
  getPreparedSemanticLines,
  matchPreparedSemanticScript,
} from "@/lib/semantic/serverStore";

export const runtime = "nodejs";

const EMBEDDING_MODEL = "text-embedding-3-small";

export async function POST(request: Request) {
  const { scriptId, currentLineIndex, spokenWindow, windowSize } = (await request.json()) as {
    scriptId?: string;
    currentLineIndex?: number;
    spokenWindow?: string;
    windowSize?: number;
  };

  if (!scriptId || typeof currentLineIndex !== "number" || !spokenWindow?.trim()) {
    return NextResponse.json(
      { error: "scriptId, currentLineIndex, and spokenWindow are required." },
      { status: 400 },
    );
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY. Add it before semantic matching can run." },
      { status: 500 },
    );
  }

  const openai = new OpenAI({ apiKey: openAiApiKey });
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: spokenWindow,
  });

  const rawMatch =
    (await getRawMatch({
      scriptId,
      embedding: embeddingResponse.data[0].embedding,
      currentLineIndex,
      windowSize: windowSize ?? 30,
      convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
    })) ??
    getLexicalFallbackMatch({
      scriptId,
      spokenWindow,
      currentLineIndex,
      windowSize: windowSize ?? 30,
    });

  const match = rawMatch
    ? normalizeSemanticCandidate({
        candidate: rawMatch,
        currentLineIndex,
        maxForwardJump: windowSize ?? 30,
      })
    : null;

  console.info("[semantic-route] match", {
    scriptId,
    currentLineIndex,
    spokenWindow,
    rawMatch,
    normalizedMatch: match,
  });

  return NextResponse.json({ match });
}

async function getRawMatch(params: {
  scriptId: string;
  embedding: number[];
  currentLineIndex: number;
  windowSize: number;
  convexUrl: string | undefined;
}) {
  if (params.convexUrl) {
    try {
      return await fetchAction(
        matchPreparedScriptRef,
        {
          scriptId: params.scriptId,
          embedding: params.embedding,
          currentLineIndex: params.currentLineIndex,
          windowSize: params.windowSize,
        },
        { url: params.convexUrl },
      );
    } catch {
      return matchPreparedSemanticScript(params);
    }
  }

  return matchPreparedSemanticScript(params);
}

function getLexicalFallbackMatch(params: {
  scriptId: string;
  spokenWindow: string;
  currentLineIndex: number;
  windowSize: number;
}) {
  const normalizedSpokenWindow = normalizeForScoring(params.spokenWindow);
  const spokenTokens = normalizedSpokenWindow.split(" ").filter(Boolean);

  if (spokenTokens.length < 5) {
    return null;
  }

  const lines = getPreparedSemanticLines(params.scriptId);
  const maxLineIndex = params.currentLineIndex + Math.max(params.windowSize, 1);
  let bestMatch: {
    lineIndex: number;
    score: number;
    lineText: string;
  } | null = null;

  for (const line of lines) {
    if (line.lineIndex <= params.currentLineIndex || line.lineIndex > maxLineIndex) {
      continue;
    }

    const normalizedLineText = normalizeForScoring(line.text);
    const score = computeLexicalScore(normalizedSpokenWindow, spokenTokens, normalizedLineText);

    if (score < 0.58) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        lineIndex: line.lineIndex,
        score,
        lineText: line.text,
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    lineIndex: bestMatch.lineIndex,
    score: bestMatch.score,
    threshold: 0,
    jumpDistance: bestMatch.lineIndex - params.currentLineIndex,
    lineText: bestMatch.lineText,
  };
}

function computeLexicalScore(
  normalizedSpokenWindow: string,
  spokenTokens: string[],
  normalizedLineText: string,
) {
  if (!normalizedLineText) {
    return 0;
  }

  if (
    normalizedLineText.includes(normalizedSpokenWindow) ||
    normalizedSpokenWindow.includes(normalizedLineText)
  ) {
    return 0.95;
  }

  const lineTokens = normalizedLineText.split(" ").filter(Boolean);
  const lineTokenSet = new Set(lineTokens);
  const overlapCount = spokenTokens.filter((token) => lineTokenSet.has(token)).length;
  const overlapRatio = overlapCount / Math.max(Math.min(spokenTokens.length, lineTokens.length), 1);
  const containmentBonus = spokenTokens.some((token) => normalizedLineText.includes(token)) ? 0.05 : 0;

  return overlapRatio + containmentBonus;
}

function normalizeForScoring(text: string) {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
