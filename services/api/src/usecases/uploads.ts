import { type CreateUploadInput, IMAGE_EXTENSIONS, type UploadTicket } from "@blog/shared";
import type { Deps } from "./ports";

export async function createUpload(
  deps: Deps,
  input: CreateUploadInput,
  opts: { e2e: boolean },
): Promise<UploadTicket> {
  const year = new Date(deps.now()).getUTCFullYear();
  const prefix = opts.e2e ? "media/e2e" : `media/${year}`;
  const key = `${prefix}/${deps.newId().toLowerCase()}.${IMAGE_EXTENSIONS[input.contentType]}`;
  const signed = await deps.uploads.sign(key, input.contentType);
  return { ...signed, key, publicUrl: `${deps.blogBaseUrl}/${key}` };
}
