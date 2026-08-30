import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function ensureParent(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "EISDIR") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic<T>(filePath: string, value: T): Promise<void> {
  await ensureParent(filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export class JsonStore<T> {
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    private readonly fallback: T,
  ) {}

  public async get(): Promise<T> {
    return readJson(this.filePath, this.fallback);
  }

  public async set(value: T): Promise<void> {
    await this.enqueue(() => writeJsonAtomic(this.filePath, value));
  }

  public async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    let result!: T;
    await this.enqueue(async () => {
      const current = await readJson(this.filePath, this.fallback);
      result = await mutator(current);
      await writeJsonAtomic(this.filePath, result);
    });
    return result;
  }

  private async enqueue<TTask>(task: () => Promise<TTask>): Promise<TTask> {
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export class JsonlStore<T> {
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async append(entry: T): Promise<void> {
    const task = async () => {
      await ensureParent(this.filePath);
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    };
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  }

  public async list(limit = 500): Promise<T[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line) as T)
        .reverse();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return [];
      throw error;
    }
  }
}
