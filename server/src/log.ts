// Structured JSON logs, one line per event. Never log tokens, request bodies
// or query results: they can hold personal data.
export type Logger = {
  info: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
};

export function createLogger(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  const emit = (level: string) => (msg: string, fields: Record<string, unknown> = {}) =>
    write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }));
  return { info: emit('info'), error: emit('error') };
}

export const silentLogger: Logger = { info: () => {}, error: () => {} };
