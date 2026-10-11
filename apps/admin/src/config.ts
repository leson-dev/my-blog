import { z } from "zod";

/** Runtime configuration written next to the SPA by CDK (infra/lib/blog-stack.ts). */
export const adminConfigSchema = z.object({
  region: z.string().min(1),
  apiUrl: z.url(),
  userPoolId: z.string().min(1),
  userPoolClientId: z.string().min(1),
  cognitoDomain: z.url(),
  redirectUri: z.url(),
});
export type AdminConfig = z.infer<typeof adminConfigSchema>;

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<AdminConfig> {
  const res = await fetchImpl("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
  return adminConfigSchema.parse(await res.json());
}
