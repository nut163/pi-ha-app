import { access, realpath } from "node:fs/promises";
import path from "node:path";

export class PathPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

const DEFAULT_ALLOWED_PREFIXES = [
  "configuration.yaml",
  "automations.yaml",
  "scripts.yaml",
  "scenes.yaml",
  "ui-lovelace.yaml",
  "lovelace.yaml",
  "themes",
  "www",
  "custom_components",
  "custom_templates",
  "blueprints",
  "packages",
  "home-assistant.log",
];

export class ConfigPathPolicy {
  private readonly root: string;

  public constructor(
    root: string,
    private readonly allowedPrefixes = DEFAULT_ALLOWED_PREFIXES,
  ) {
    this.root = path.resolve(root);
  }

  public resolve(relativePath: string): string {
    if (!relativePath || relativePath.includes("\0")) {
      throw new PathPolicyError("A non-empty, NUL-free configuration path is required.");
    }
    if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
      throw new PathPolicyError("Configuration paths must be relative to /config.");
    }

    const normalized = relativePath.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (segments.some((segment) => segment === "..")) {
      throw new PathPolicyError("Parent-directory traversal is not allowed.");
    }

    const clean = path.posix.normalize(normalized).replace(/^\.\//, "");
    if (clean === "." || clean.startsWith("../") || clean.includes("/../")) {
      throw new PathPolicyError("The requested path escapes the configuration root.");
    }

    const allowed = this.allowedPrefixes.some(
      (prefix) => clean === prefix || clean.startsWith(`${prefix}/`),
    );
    if (!allowed) {
      throw new PathPolicyError(
        `Path '${relativePath}' is outside the approved Home Assistant configuration areas.`,
      );
    }

    const resolved = path.resolve(this.root, clean);
    const rootWithSeparator = `${this.root}${path.sep}`;
    if (resolved !== this.root && !resolved.startsWith(rootWithSeparator)) {
      throw new PathPolicyError("The requested path escapes the configuration root.");
    }
    return resolved;
  }

  public relative(absolutePath: string): string {
    const resolved = path.resolve(absolutePath);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new PathPolicyError("The path is outside the configuration root.");
    }
    return relative.split(path.sep).join("/");
  }

  public async assertNoSymlinkEscape(absolutePath: string): Promise<void> {
    const rootReal = await realpath(this.root).catch(() => this.root);
    try {
      const resolvedTarget = await realpath(absolutePath);
      const rootWithSeparator = `${rootReal}${path.sep}`;
      if (resolvedTarget !== rootReal && !resolvedTarget.startsWith(rootWithSeparator)) {
        throw new PathPolicyError("A symbolic link would escape the configuration root.");
      }
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (error instanceof PathPolicyError || code !== "ENOENT") throw error;
    }
    const parent = path.dirname(absolutePath);
    const existingParent = await this.closestExistingPath(parent);
    const resolvedParent = await realpath(existingParent);
    const rootWithSeparator = `${rootReal}${path.sep}`;
    if (resolvedParent !== rootReal && !resolvedParent.startsWith(rootWithSeparator)) {
      throw new PathPolicyError("A symbolic link would escape the configuration root.");
    }
  }

  public async assertReadable(absolutePath: string): Promise<void> {
    await access(absolutePath);
  }

  private async closestExistingPath(candidate: string): Promise<string> {
    let current = candidate;
    while (current !== path.dirname(current)) {
      try {
        await access(current);
        return current;
      } catch {
        current = path.dirname(current);
      }
    }
    return current;
  }
}
