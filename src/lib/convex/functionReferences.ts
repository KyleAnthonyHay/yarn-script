import { makeFunctionReference } from "convex/server";

export const getPreparedScriptByHashRef = makeFunctionReference<"query">(
  "teleprompter.js:getPreparedScriptByHash",
);
export const storePreparedScriptRef = makeFunctionReference<"mutation">(
  "teleprompter.js:storePreparedScript",
);
export const matchPreparedScriptRef = makeFunctionReference<"action">(
  "teleprompter.js:matchPreparedScript",
);
