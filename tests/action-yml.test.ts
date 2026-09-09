/**
 * Static guard for the composite action's Node setup (M4).
 *
 * Regression: `actions/setup-node`'s `node-version-file` input does not
 * resolve `${{ github.action_path }}` inside composite actions — the runner
 * treated the absolute path as relative and doubled it
 * (`.../drizzle-doctor/home/runner/.../.node-version`), failing both smoke
 * jobs before the audit ever ran. The action therefore passes the pinned
 * version from `.node-version` via the plain `node-version` input instead.
 *
 * This test keeps the two in sync without adding a YAML parser dependency.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actionYml = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const nodeVersion = readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();

describe("action.yml Node setup", () => {
  it("does not use node-version-file (unresolved github.action_path in composite actions)", () => {
    expect(actionYml).not.toContain("node-version-file");
  });

  it("pins node-version to the .node-version content", () => {
    expect(nodeVersion).toMatch(/^\d+$/);
    expect(actionYml).toContain(`node-version: '${nodeVersion}'`);
  });
});
