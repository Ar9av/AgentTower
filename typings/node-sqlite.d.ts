// Minimal type shim for the Node.js built-in `node:sqlite` module (added in Node 22.5+).
// Only the subset used by opencode-fs.ts is declared here.

declare module 'node:sqlite' {
  interface DatabaseSyncOptions {
    readOnly?: boolean
    open?: boolean
  }

  interface StatementSync {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown | undefined
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }

  class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions)
    prepare(sql: string): StatementSync
    exec(sql: string): void
    close(): void
  }
}
