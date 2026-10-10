import { type CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";

export async function invalidateAll(
  cf: CloudFrontClient,
  distributionId: string,
  callerReference: string,
): Promise<void> {
  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: callerReference,
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    }),
  );
}
