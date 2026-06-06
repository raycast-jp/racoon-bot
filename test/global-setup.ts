import fs from "node:fs";

/** テスト用 DB を毎回まっさらな状態から始める */
export default function setup(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`./data/test-e2e.db${suffix}`, { force: true });
  }
}
