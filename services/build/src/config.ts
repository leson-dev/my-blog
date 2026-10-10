import { z } from "zod";

const configSchema = z.object({
  TABLE_NAME: z.string().min(1),
  SITE_BUCKET: z.string().min(1),
  DISTRIBUTION_ID: z.string().min(1),
  /** apps/site inside the image; read-only. */
  SITE_DIR: z.string().min(1).default("/opt/blog/apps/site"),
  /** Exported posts.json / tags.json. */
  DATA_DIR: z.string().min(1).default("/tmp/site-data"),
  /** Astro output (+ Pagefind index). */
  OUT_DIR: z.string().min(1).default("/tmp/site-dist"),
  /** Astro and Vite caches. */
  CACHE_DIR: z.string().min(1).default("/tmp/site-cache"),
  /** Target of the image's apps/site/.astro symlink. */
  DOT_ASTRO_DIR: z.string().min(1).default("/tmp/astro-dot"),
});
export type Config = z.infer<typeof configSchema>;

export const loadConfig = (env: Record<string, string | undefined>): Config =>
  configSchema.parse(env);
