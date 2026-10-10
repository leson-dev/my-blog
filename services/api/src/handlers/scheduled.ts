import { scheduledPublishEventSchema } from "../events";
import type { Deps } from "../usecases/ports";
import { runScheduledPublish } from "../usecases/publishing";

export async function handleScheduled(event: unknown, deps: Deps): Promise<void> {
  const { postId, lang, publishAt } = scheduledPublishEventSchema.parse(event);
  await runScheduledPublish(deps, { postId, lang, publishAt });
}
