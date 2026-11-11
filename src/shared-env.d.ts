// Minimal ambient declarations for the environment-agnostic shared code
// (src/shared must compile without DOM or Node typings).
declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
