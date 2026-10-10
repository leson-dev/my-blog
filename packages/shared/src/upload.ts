import { z } from "zod";

export const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;
export type ImageContentType = keyof typeof IMAGE_EXTENSIONS;

const IMAGE_CONTENT_TYPES = Object.keys(IMAGE_EXTENSIONS) as [
  ImageContentType,
  ...ImageContentType[],
];

export const createUploadInputSchema = z.object({
  contentType: z.enum(IMAGE_CONTENT_TYPES),
});
export type CreateUploadInput = z.infer<typeof createUploadInputSchema>;

export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
  key: string;
  publicUrl: string;
}
