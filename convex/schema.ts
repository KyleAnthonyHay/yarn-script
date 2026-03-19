import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  teleprompterScripts: defineTable({
    scriptId: v.string(),
    scriptHash: v.string(),
    scriptText: v.string(),
    lineCount: v.number(),
    wordsPerLine: v.number(),
    createdAt: v.number(),
  })
    .index("by_script_hash", ["scriptHash"])
    .index("by_script_id", ["scriptId"]),
  teleprompterLineEmbeddings: defineTable({
    scriptId: v.string(),
    scriptHash: v.string(),
    lineIndex: v.number(),
    text: v.string(),
    embedding: v.array(v.float64()),
    startTokenIndex: v.number(),
    endTokenIndex: v.number(),
  })
    .index("by_script_id_line_index", ["scriptId", "lineIndex"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["scriptId"],
    }),
});
