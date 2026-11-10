import { expect, it } from "vitest";

import { isAgentScanRunning, withAgentScanLock } from "./scan-lock";

it("holds the scan in this process: a second scan waits its turn (public PR 61)", async () => {
  let release!: () => void;
  const first = withAgentScanLock(() => new Promise<string>((resolve) => (release = () => resolve("first"))));
  expect(await isAgentScanRunning()).toBe(true);
  expect(await withAgentScanLock(async () => "second")).toBeNull();
  release();
  expect(await first).toBe("first");
  expect(await isAgentScanRunning()).toBe(false);
  expect(await withAgentScanLock(async () => "after")).toBe("after");
});

it("also releases ownership after an unexpected evaluation failure", async () => {
  await expect(withAgentScanLock(async () => { throw new Error("interrupted"); })).rejects.toThrow("interrupted");
  expect(await withAgentScanLock(async () => "next scan")).toBe("next scan");
});
