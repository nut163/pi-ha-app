import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";

interface EncryptedSecret {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

type SecretMap = Record<string, EncryptedSecret>;

export class SecretStore {
  private key?: Buffer;
  private readonly cache = new Map<string, string>();

  public constructor(
    private readonly keyPath: string,
    private readonly secretsPath: string,
  ) {}

  public async set(name: string, value: string): Promise<void> {
    const map = await this.readMap();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await this.getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const record: EncryptedSecret = {
      version: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    map[name] = record;
    await this.writeMap(map);
    this.cache.set(name, value);
  }

  public async get(name: string): Promise<string | undefined> {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    const record = (await this.readMap())[name];
    if (!record) return undefined;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await this.getKey(),
      Buffer.from(record.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    this.cache.set(name, plaintext);
    return plaintext;
  }

  public async delete(name: string): Promise<void> {
    const map = await this.readMap();
    delete map[name];
    await this.writeMap(map);
    this.cache.delete(name);
  }

  public async has(name: string): Promise<boolean> {
    return (await this.readMap())[name] !== undefined;
  }

  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;
    await mkdir(path.dirname(this.keyPath), { recursive: true });
    try {
      this.key = await readFile(this.keyPath);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
      this.key = randomBytes(32);
      await writeFile(this.keyPath, this.key, { mode: 0o600 });
    }
    if (this.key.length !== 32) throw new Error("The secret key file is not a 256-bit key");
    await chmod(this.keyPath, 0o600).catch(() => undefined);
    return this.key;
  }

  private async readMap(): Promise<SecretMap> {
    try {
      return JSON.parse(await readFile(this.secretsPath, "utf8")) as SecretMap;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return {};
      throw error;
    }
  }

  private async writeMap(map: SecretMap): Promise<void> {
    await mkdir(path.dirname(this.secretsPath), { recursive: true });
    await writeFile(this.secretsPath, `${JSON.stringify(map, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.secretsPath, 0o600).catch(() => undefined);
  }
}
