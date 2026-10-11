import type { ImageContentType } from "@blog/shared";
import type { Endpoints } from "../api/endpoints";

export const MAX_EDGE = 1600;
export const WEBP_QUALITY = 0.85;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function fitWithin(width: number, height: number, max: number = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface PreparedImage {
  blob: Blob;
  contentType: ImageContentType;
}

/** ≤ 1600px on the long edge, re-encoded as WebP. GIFs are kept as they are (animation). */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.type === "image/gif") return { blob: file, contentType: "image/gif" };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Không đọc được ảnh "${file.name}"`);
  }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ canvas");
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
  );
  if (!blob || blob.type !== "image/webp") throw new Error("Trình duyệt không xuất được ảnh WebP");
  return { blob, contentType: "image/webp" };
}

export interface UploadDeps {
  prepare: (file: File) => Promise<PreparedImage>;
  fetch: typeof fetch;
}

const defaultDeps = (): UploadDeps => ({
  prepare: prepareImage,
  fetch: globalThis.fetch.bind(globalThis),
});

/** Compress → ask the API for a presigned POST → upload straight to S3. Returns the public URL. */
export async function uploadImage(
  api: Pick<Endpoints, "createUpload">,
  file: File,
  deps: UploadDeps = defaultDeps(),
): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`"${file.name}" không phải ảnh`);
  const { blob, contentType } = await deps.prepare(file);
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error("Ảnh lớn hơn 10 MB sau khi nén");

  const ticket = await api.createUpload(contentType);
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
  form.append("file", blob);
  const res = await deps.fetch(ticket.url, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Tải ảnh thất bại (HTTP ${res.status})`);
  return ticket.publicUrl;
}

export const altFromFileName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "");

export const imageMarkdown = (url: string, alt = "") => `![${alt}](${url})`;
