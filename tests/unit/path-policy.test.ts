import { mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigPathPolicy, PathPolicyError } from "../../src/core/path-policy.js";

describe("ConfigPathPolicy", () => {
  it("accepts approved relative paths and rejects traversal", () => {
    const root = path.join(os.tmpdir(), `pi-policy-${Date.now()}`);
    const policy = new ConfigPathPolicy(root);
    expect(policy.resolve("automations.yaml")).toBe(path.join(root, "automations.yaml"));
    expect(() => policy.resolve("../outside.txt")).toThrow(PathPolicyError);
    expect(() => policy.resolve("secrets.yaml")).toThrow(PathPolicyError);
    expect(() => policy.resolve(path.join(root, "configuration.yaml"))).toThrow(PathPolicyError);
  });

  it("rejects symlinks that point outside the configuration root", async () => {
    const root = path.join(os.tmpdir(), `pi-symlink-${Date.now()}`);
    const outside = path.join(os.tmpdir(), `pi-outside-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.txt"), "secret");
    const link = path.join(root, "www");
    try {
      await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Some Windows CI identities cannot create links; the path checks above
      // still cover the primary boundary.
      return;
    }
    const policy = new ConfigPathPolicy(root);
    await expect(policy.assertNoSymlinkEscape(policy.resolve("www/secret.txt"))).rejects.toThrow(PathPolicyError);
  });
});
