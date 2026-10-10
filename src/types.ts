// Shim — types live in @curtis/core (packages/core/src/types.ts).
// Import from the package directly in new code; this re-export keeps the
// plugin tree compiling until the shell consumes the package explicitly.
export * from '../packages/core/src/types';
