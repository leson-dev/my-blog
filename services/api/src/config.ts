import { z } from "zod";

const configSchema = z.object({
  TABLE_NAME: z.string().min(1),
  BUILD_QUEUE_URL: z.url(),
  MEDIA_BUCKET: z.string().min(1),
  BLOG_BASE_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
  SCHEDULER_GROUP: z.string().min(1),
  SCHEDULER_TARGET_ARN: z.string().min(1),
  SCHEDULER_ROLE_ARN: z.string().min(1),
});
export type Config = z.infer<typeof configSchema>;

export const loadConfig = (env: Record<string, string | undefined>): Config =>
  configSchema.parse(env);
