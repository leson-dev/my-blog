import { z } from "zod";

export const scheduledPublishEventSchema = z.object({
  type: z.literal("scheduled-publish"),
  postId: z.string().min(1),
  publishAt: z.iso.datetime(),
});
export type ScheduledPublishEvent = z.infer<typeof scheduledPublishEventSchema>;

export function isScheduledPublishEvent(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "scheduled-publish"
  );
}
