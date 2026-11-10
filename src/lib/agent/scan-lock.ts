import "server-only";

// Dossier is one process on one SQLite file, so the job agent's scan lock is
// held in that process: one scan at a time, and a restart releases it. It
// serializes scans only, not imports/wipes or independent draft jobs.

const globalForScan = globalThis as unknown as { agentScanRunning?: boolean };

/** Read-only screen status, without taking the lock. */
export async function isAgentScanRunning(): Promise<boolean> {
  return globalForScan.agentScanRunning === true;
}

/** Runs `work` unless a scan is running already; null when one is. */
export async function withAgentScanLock<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  if (globalForScan.agentScanRunning) return null;
  globalForScan.agentScanRunning = true;
  try {
    return await work(new AbortController().signal);
  } finally {
    globalForScan.agentScanRunning = false;
  }
}
