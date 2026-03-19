export type TranscriptionSessionState =
  | "idle"
  | "preparing"
  | "connecting"
  | "listening"
  | "error"
  | "stopped";
