import {
  actionGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const SCRIPT_LINE_VALIDATOR = v.object({
  lineIndex: v.number(),
  text: v.string(),
  embedding: v.array(v.float64()),
  startTokenIndex: v.number(),
  endTokenIndex: v.number(),
});
const GET_LINES_BY_IDS_REF = makeFunctionReference<"query">("teleprompter.js:getLinesByIds");

export const getPreparedScriptByHash = queryGeneric({
  args: {
    scriptHash: v.string(),
  },
  handler: async (ctx, args) => {
    const script = await ctx.db
      .query("teleprompterScripts")
      .withIndex("by_script_hash", (q) => q.eq("scriptHash", args.scriptHash))
      .unique();

    if (!script) {
      return null;
    }

    return {
      scriptId: script.scriptId,
      lineCount: script.lineCount,
      wordsPerLine: script.wordsPerLine,
    };
  },
});

export const storePreparedScript = mutationGeneric({
  args: {
    lineCount: v.number(),
    scriptId: v.string(),
    scriptHash: v.string(),
    scriptText: v.string(),
    wordsPerLine: v.number(),
    lines: v.array(SCRIPT_LINE_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const existingScript = await ctx.db
      .query("teleprompterScripts")
      .withIndex("by_script_hash", (q) => q.eq("scriptHash", args.scriptHash))
      .unique();

    if (existingScript) {
      const existingLines = await ctx.db
        .query("teleprompterLineEmbeddings")
        .withIndex("by_script_id_line_index", (q) => q.eq("scriptId", existingScript.scriptId))
        .collect();

      await Promise.all(existingLines.map((line) => ctx.db.delete(line._id)));
      await ctx.db.delete(existingScript._id);
    }

    await ctx.db.insert("teleprompterScripts", {
      scriptId: args.scriptId,
      scriptHash: args.scriptHash,
      scriptText: args.scriptText,
      lineCount: args.lineCount,
      wordsPerLine: args.wordsPerLine,
      createdAt: Date.now(),
    });

    await Promise.all(
      args.lines.map((line) =>
        ctx.db.insert("teleprompterLineEmbeddings", {
          scriptId: args.scriptId,
          scriptHash: args.scriptHash,
          lineIndex: line.lineIndex,
          text: line.text,
          embedding: line.embedding,
          startTokenIndex: line.startTokenIndex,
          endTokenIndex: line.endTokenIndex,
        }),
      ),
    );

    return {
      scriptId: args.scriptId,
      lineCount: args.lineCount,
      wordsPerLine: args.wordsPerLine,
    };
  },
});

export const getLinesByIds = internalQueryGeneric({
  args: {
    ids: v.array(v.id("teleprompterLineEmbeddings")),
  },
  handler: async (ctx, args) => {
    const lines = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return lines.filter((line) => line !== null).map((line) => ({
      _id: line._id,
      lineIndex: line.lineIndex,
      text: line.text,
    }));
  },
});

export const matchPreparedScript = actionGeneric({
  args: {
    scriptId: v.string(),
    embedding: v.array(v.float64()),
    currentLineIndex: v.number(),
    windowSize: v.number(),
  },
  handler: async (ctx, args) => {
    const rawMatches = await ctx.vectorSearch(
      "teleprompterLineEmbeddings",
      "by_embedding",
      {
        vector: args.embedding,
        limit: Math.min(Math.max(args.windowSize * 3, 12), 64),
        filter: (q) => q.eq("scriptId", args.scriptId),
      },
    );

    if (rawMatches.length === 0) {
      return null;
    }

    const matchedLines = (await ctx.runQuery(GET_LINES_BY_IDS_REF, {
      ids: rawMatches.map((match) => match._id),
    })) as Array<{
      _id: string;
      lineIndex: number;
      text: string;
    }>;

    const lineMap = new Map(matchedLines.map((line) => [line._id, line]));
    const maxLineIndex = args.currentLineIndex + Math.max(args.windowSize, 1);

    for (const rawMatch of rawMatches) {
      const line = lineMap.get(String(rawMatch._id));
      if (!line) {
        continue;
      }

      if (line.lineIndex <= args.currentLineIndex || line.lineIndex > maxLineIndex) {
        continue;
      }

      return {
        lineIndex: line.lineIndex,
        score: rawMatch._score,
        threshold: 0,
        jumpDistance: line.lineIndex - args.currentLineIndex,
        lineText: line.text,
      };
    }

    return null;
  },
});
