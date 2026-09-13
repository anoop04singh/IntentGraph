import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** One durable ledger shared by HTTP and local stdio processes. No query text or secrets. */
export class Store {
  db: DatabaseSync;
  constructor(directory: string) {
    if (directory !== ':memory:') mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(directory === ':memory:' ? directory : join(directory, 'intentgraph.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS payments (
        proof_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, quote_id TEXT NOT NULL,
        status TEXT NOT NULL, amount TEXT NOT NULL, transaction_id TEXT UNIQUE,
        created_at TEXT NOT NULL, settled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY, tool TEXT NOT NULL, is_query INTEGER NOT NULL,
        success INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS calls_created ON calls(created_at);
    `);
  }
  claim(proofId: string, sessionId: string, quoteId: string, amount: string) {
    return this.db.prepare(`INSERT OR IGNORE INTO payments
      (proof_id,session_id,quote_id,status,amount,created_at) VALUES (?,?,?,'pending',?,?)`)
      .run(proofId, sessionId, quoteId, amount, new Date().toISOString()).changes === 1;
  }
  payment(proofId: string) { return this.db.prepare('SELECT * FROM payments WHERE proof_id=?').get(proofId); }
  settle(proofId: string, transaction: string) {
    this.db.prepare("UPDATE payments SET status='settled',transaction_id=?,settled_at=? WHERE proof_id=? AND status='pending'")
      .run(transaction, new Date().toISOString(), proofId);
  }
  fail(proofId: string, status: 'invalid' | 'failed' | 'uncertain') {
    this.db.prepare('UPDATE payments SET status=? WHERE proof_id=? AND status=\'pending\'').run(status, proofId);
  }
  recordCall(tool: string, success: boolean, duration: number) {
    this.db.prepare('INSERT INTO calls(tool,is_query,success,duration_ms,created_at) VALUES(?,?,?,?,?)')
      .run(tool, Number(tool.startsWith('execute_query_')), Number(success), Math.round(duration), new Date().toISOString());
  }
  stats() {
    const totals = this.db.prepare(`SELECT COUNT(*) AS toolCalls,
      COALESCE(SUM(is_query),0) AS queriesMade,
      COALESCE(SUM(CASE WHEN is_query=1 AND success=1 THEN 1 ELSE 0 END),0) AS queriesSucceeded
      FROM calls`).get()!;
    const payments = this.db.prepare("SELECT amount FROM payments WHERE status='settled'").all();
    const tinybars = payments.reduce((sum, row) => sum + BigInt(String(row.amount)), 0n);
    const recent = this.db.prepare(`SELECT tool,success,duration_ms AS durationMs,created_at AS createdAt FROM calls ORDER BY id DESC LIMIT 8`).all();
    const daily = this.db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS queries FROM calls
      WHERE is_query=1 AND created_at >= datetime('now','-7 days') GROUP BY day ORDER BY day`).all();
    return { toolCalls: Number(totals.toolCalls), queriesMade: Number(totals.queriesMade), queriesSucceeded: Number(totals.queriesSucceeded), paymentsSettled: payments.length, volumeTinybars: tinybars.toString(), recent, daily, updatedAt: new Date().toISOString() };
  }
  close() { this.db.close(); }
}
