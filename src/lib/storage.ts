import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * File storage for photos, signatures and (later) invoice PDFs.
 *
 *   STORAGE_DRIVER=local (default) → files under STORAGE_DIR (./storage)
 *   STORAGE_DRIVER=s3              → any S3-compatible bucket (R2, MinIO, AWS):
 *                                    S3_BUCKET, S3_REGION, S3_ENDPOINT,
 *                                    S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *
 * Keys always start with t/<tenantId>/ so a tenant can only ever be served
 * its own files (checked in /api/files).
 */

export type StoredFile = { bytes: Buffer; contentType: string };

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const ALLOWED_TYPES = Object.keys(EXT);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detect the real type from the first bytes; never trust the browser's label. */
export function sniffType(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  if (b.length >= 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  if (b.length >= 5 && b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

export function newKey(tenantId: string, kind: string, contentType: string, now = new Date()) {
  const safeKind = kind.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "file";
  const ym = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `t/${tenantId}/${safeKind}/${ym}/${randomUUID()}.${EXT[contentType] ?? "bin"}`;
}

export function keyBelongsTo(key: string, tenantId: string) {
  return key.startsWith(`t/${tenantId}/`) && !key.includes("..") && /^[a-zA-Z0-9/_.-]+$/.test(key);
}

interface Driver {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
}

function localDriver(): Driver {
  const root = path.resolve(process.env.STORAGE_DIR ?? "storage");
  const full = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error("Bad storage key");
    return p;
  };
  return {
    async put(key, bytes, contentType) {
      const p = full(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, bytes);
      await fs.writeFile(`${p}.type`, contentType);
    },
    async get(key) {
      try {
        const p = full(key);
        const [bytes, contentType] = await Promise.all([fs.readFile(p), fs.readFile(`${p}.type`, "utf8")]);
        return { bytes, contentType };
      } catch {
        return null;
      }
    },
  };
}

async function s3Driver(): Promise<Driver> {
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  const Bucket = process.env.S3_BUCKET ?? "";
  return {
    async put(key, bytes, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        const bytes = Buffer.from(await out.Body!.transformToByteArray());
        return { bytes, contentType: out.ContentType ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
  };
}

let driver: Promise<Driver> | null = null;
function getDriver() {
  driver ??= process.env.STORAGE_DRIVER === "s3" ? s3Driver() : Promise.resolve(localDriver());
  return driver;
}

export async function putFile(key: string, bytes: Buffer, contentType: string) {
  await (await getDriver()).put(key, bytes, contentType);
}

export async function getFile(key: string) {
  return (await getDriver()).get(key);
}
