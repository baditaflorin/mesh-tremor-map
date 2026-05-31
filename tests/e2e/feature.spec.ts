import { expect, test, type Page } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

/**
 * Drive a burst of synthetic `devicemotion` events at a chosen total-acceleration
 * magnitude. `useDeviceMotion` reads `accelerationIncludingGravity` and computes
 * |a| − 9.81 (then smooths over ~several samples), so a magnitude of ~11 m/s²
 * reads as jitter ≈ 1.2 ("walking") and ~9.85 reads as ≈ 0 ("still").
 */
async function driveMotion(page: Page, totalAccel: number, samples = 15) {
  for (let i = 0; i < samples; i++) {
    await page.evaluate((mag) => {
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          accelerationIncludingGravity: { x: mag, y: 0, z: 0 },
        } as unknown as DeviceMotionEventInit),
      );
    }, totalAccel);
    await page.waitForTimeout(35);
  }
}

/**
 * DeviceMotion events don't fire in headless chromium without a real device,
 * so we test UI plumbing only — the arm flow + name-to-mesh publication path.
 */
test("arm button visible; name input persists across reload", async ({ page, baseURL }) => {
  await page.goto(baseURL ?? "");
  await expect(page.getByRole("button", { name: /arm accelerometer/i })).toBeVisible();
  await page.getByPlaceholder(/your name/i).fill("alice");
  await page.reload();
  await expect(page.getByPlaceholder(/your name/i)).toHaveValue("alice");
});

/**
 * Load-bearing cross-peer assertion. The advertised core action is "a live map
 * of who's walking and who's still — accel jitter aggregated across the mesh".
 * We drive *real* synthetic devicemotion on peer A and assert peer B's map shows
 * A as walking (then still). The old test only checked that the arm button was
 * visible on both peers — it never armed, never moved, and never read A's state
 * on B, so a regression in propagation would have passed silently.
 */
test("peer A's synthetic motion shows up as 'walking'/'still' on peer B's map", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder(/your name/i).fill("alice");
    await a.getByRole("button", { name: /arm accelerometer/i }).click();
    await expect(a.getByText(/you ·/)).toBeVisible();

    // Peer B sees alice's row appear (published on arm).
    const aliceRow = b.locator(".tr-peer", { hasText: "alice" });
    await expect(aliceRow).toBeVisible();

    // A walks: synthetic devicemotion ~11 m/s² => jitter ≈ 1.2 ("walking").
    await driveMotion(a, 11);
    await expect(a.getByText(/you ·/)).toContainText(/walking|running|shaking/);
    // The motion-derived state crossed the mesh: B labels alice as moving.
    await expect(aliceRow.locator(".tr-peer-state")).toHaveText(/walking|running|shaking/);
    await expect(aliceRow).toHaveClass(/tr-state-(walking|running|shaking)/);

    // A calms down: low-magnitude samples decay the smoothed jitter back to ~0.
    await driveMotion(a, 9.82, 25);
    await expect(a.getByText(/you ·/)).toContainText(/still/);
    // Both peers agree A is now still.
    await expect(aliceRow.locator(".tr-peer-state")).toHaveText("still");
    await expect(aliceRow).toHaveClass(/tr-state-still/);
  } finally {
    await cleanup();
  }
});
