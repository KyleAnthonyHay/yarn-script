import { createHash, randomUUID } from "node:crypto";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { normalizeScriptWhitespace, tokenizeScript } from "@/lib/transcription/alignment";
import { getPreparedScriptByHashRef, storePreparedScriptRef } from "@/lib/convex/functionReferences";
import {
  getPreparedSemanticScriptByHash,
  storePreparedSemanticScript,
} from "@/lib/semantic/serverStore";
import {
  buildSentenceSearchDocuments,
  buildSemanticSearchDocuments,
  buildTeleprompterLines,
  dedupeSemanticSearchDocuments,
} from "@/lib/teleprompter/teleprompterLines";

export const runtime = "nodejs";

const EMBEDDING_MODEL = "text-embedding-3-small";
const SEMANTIC_INDEX_VERSION = "v3";

export async function POST(request: Request) {
  const { script, wordsPerLine } = (await request.json()) as {
    script?: string;
    wordsPerLine?: number;
  };

  if (!script || !script.trim()) {
    return NextResponse.json({ error: "A script is required before preparation can start." }, { status: 400 });
  }

  if (!wordsPerLine || wordsPerLine <= 0) {
    return NextResponse.json({ error: "wordsPerLine must be greater than zero." }, { status: 400 });
  }

  const normalizedScript = normalizeScriptWhitespace(script);

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY. Add it before preparing semantic script embeddings." },
      { status: 500 },
    );
  }

  const scriptHash = createHash("sha256")
    .update(
      JSON.stringify({
        version: SEMANTIC_INDEX_VERSION,
        wordsPerLine,
        script: normalizedScript,
      }),
    )
    .digest("hex");
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const existingScript = await getExistingPreparedScript(scriptHash, convexUrl);

  if (existingScript) {
    return NextResponse.json(existingScript);
  }

  const scriptTokens = tokenizeScript(normalizedScript);
  const lines = buildTeleprompterLines(scriptTokens, wordsPerLine);
  const semanticDocuments = dedupeSemanticSearchDocuments([
    ...buildSentenceSearchDocuments(normalizedScript, lines),
    ...buildSemanticSearchDocuments(lines, 5),
  ]);

  if (semanticDocuments.length === 0) {
    return NextResponse.json({ error: "The script did not contain any readable words." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: openAiApiKey });
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: semanticDocuments.map((document) => document.text),
  });

  const scriptId = randomUUID();
  const preparedDocuments = semanticDocuments.map((document, index) => ({
    lineIndex: document.lineIndex,
    text: document.text,
    embedding: embeddingResponse.data[index].embedding,
    startTokenIndex: document.startTokenIndex,
    endTokenIndex: document.endTokenIndex,
  }));
  const preparedScript = await persistPreparedScript({
    scriptId,
    scriptHash,
    scriptText: normalizedScript,
    wordsPerLine,
    lines: preparedDocuments,
    lineCount: lines.length,
    convexUrl,
  });

  return NextResponse.json(preparedScript);
}

async function getExistingPreparedScript(
  scriptHash: string,
  convexUrl: string | undefined,
): Promise<{ scriptId: string; lineCount: number; wordsPerLine: number } | null> {
  if (convexUrl) {
    try {
      return await fetchQuery(getPreparedScriptByHashRef, { scriptHash }, { url: convexUrl });
    } catch {
      return getPreparedSemanticScriptByHash(scriptHash);
    }
  }

  return getPreparedSemanticScriptByHash(scriptHash);
}

async function persistPreparedScript(params: {
  scriptId: string;
  scriptHash: string;
  scriptText: string;
  wordsPerLine: number;
  lineCount: number;
  lines: Array<{
    lineIndex: number;
    text: string;
    embedding: number[];
    startTokenIndex: number;
    endTokenIndex: number;
  }>;
  convexUrl: string | undefined;
}) {
  const localPreparedScript = storePreparedSemanticScript(params);

  if (params.convexUrl) {
    try {
      await fetchMutation(
        storePreparedScriptRef,
        {
          scriptId: params.scriptId,
          lineCount: params.lineCount,
          scriptHash: params.scriptHash,
          scriptText: params.scriptText,
          wordsPerLine: params.wordsPerLine,
          lines: params.lines,
        },
        { url: params.convexUrl },
      );
      return localPreparedScript;
    } catch {
      return localPreparedScript;
    }
  }

  return localPreparedScript;
}
