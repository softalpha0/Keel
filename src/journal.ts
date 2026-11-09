import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Journal, Receipt } from "./ledger.js";

export type { Journal } from "./ledger.js";

export class DuplicateMovementError extends Error {
  constructor(readonly key: string) {
    super(`a settled movement is already recorded under ${key}`);
  }
}

/**
 * An append-only file journal: one JSON line per settled movement, and a lock file per key created
 * with O_EXCL (the filesystem's "create only if absent"), which is the unique constraint. A
 * database with a unique index on the key does the same job in production.
 */
export class FileJournal implements Journal {
  private file: string;
  private locks: string;

  constructor(
    dir: string,
    private waitMs = 60_000,
    private staleMs = 10 * 60_000,
  ) {
    this.file = join(dir, "journal.jsonl");
    this.locks = join(dir, "locks");
    mkdirSync(this.locks, { recursive: true });
  }

  private all(): Receipt[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l: string) => JSON.parse(l) as Receipt);
  }

  get(key: string): Receipt | undefined {
    return this.all().find((r) => r.idempotencyKey === key && r.status === "settled");
  }

  private lockFile(key: string) {
    return join(this.locks, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.lock`);
  }

  async claim(key: string): Promise<{ owned: true } | { owned: false; receipt: Receipt }> {
    const lock = this.lockFile(key);
    const started = Date.now();
    for (;;) {
      const done = this.get(key);
      if (done) return { owned: false, receipt: done };
      try {
        closeSync(openSync(lock, "wx"));
        return { owned: true };
      } catch (err) {
        if ((err as { code?: string }).code !== "EEXIST") throw err;
      }
      // Someone else holds the key. A lock left by a crashed process expires; otherwise wait for their result.
      try {
        if (Date.now() - statSync(lock).mtimeMs > this.staleMs) unlinkSync(lock);
      } catch {
        // The lock vanished between our checks: just try again.
      }
      if (Date.now() - started > this.waitMs) throw new Error(`${key} is held by another process and has not settled`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  record(receipt: Receipt): void {
    if (receipt.status !== "settled") return;
    if (this.get(receipt.idempotencyKey)) throw new DuplicateMovementError(receipt.idempotencyKey);
    appendFileSync(this.file, JSON.stringify(receipt) + "\n");
  }

  release(key: string): void {
    try {
      unlinkSync(this.lockFile(key));
    } catch {
      // Already gone.
    }
  }
}
