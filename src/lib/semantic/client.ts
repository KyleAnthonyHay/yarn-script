import type { PreparedScriptMetadata, SemanticMatchResult } from "@/types/semantic";

export async function prepareSemanticScript(params: {
  script: string;
  wordsPerLine: number;
}): Promise<PreparedScriptMetadata> {
  const response = await fetch("/api/semantic/prepare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const payload = (await response.json()) as PreparedScriptMetadata | { error: string };

  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload ? payload.error : "Unable to prepare the teleprompter script.",
    );
  }

  return payload;
}

export async function matchSemanticWindow(params: {
  scriptId: string;
  currentLineIndex: number;
  spokenWindow: string;
  windowSize: number;
}): Promise<SemanticMatchResult | null> {
  const response = await fetch("/api/semantic/match", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const payload = (await response.json()) as
    | { match: SemanticMatchResult | null }
    | { error: string };

  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload ? payload.error : "Unable to evaluate semantic teleprompter progress.",
    );
  }

  return payload.match;
}
