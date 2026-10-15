export class TidepullError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "TidepullError";
    this.exitCode = exitCode;
  }
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Thrown when a caller's AbortSignal fires. name === "AbortError" so it works with standard abort handling. */
export function abortError(): TidepullError {
  const e = new TidepullError("Aborted", 130);
  e.name = "AbortError";
  return e;
}

/** Redirect policy violations. Never retried. */
export class RedirectError extends TidepullError {
  constructor(message: string) {
    super(message);
    this.name = "RedirectError";
  }
}
