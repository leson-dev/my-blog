import {
  type CloudFrontClient,
  CreateInvalidationCommand,
  waitUntilInvalidationCompleted,
} from "@aws-sdk/client-cloudfront";

/** Seconds to wait for the invalidation; old hashed assets are kept if it takes longer. */
const MAX_WAIT_SECONDS = 120;

/** Invalidates `/*` and waits for completion. Returns false when it is still in progress. */
export async function invalidateAll(
  cf: CloudFrontClient,
  distributionId: string,
  callerReference: string,
): Promise<boolean> {
  const res = await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: callerReference,
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    }),
  );
  const id = res.Invalidation?.Id;
  if (!id) return false;
  try {
    await waitUntilInvalidationCompleted(
      { client: cf, maxWaitTime: MAX_WAIT_SECONDS },
      { DistributionId: distributionId, Id: id },
    );
    return true;
  } catch {
    return false;
  }
}
