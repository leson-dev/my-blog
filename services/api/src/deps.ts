import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { DynamoBuildStatusRepository } from "./adapters/dynamo/buildStatusRepo";
import { DynamoPostRepository } from "./adapters/dynamo/postRepo";
import { DynamoTagRepository } from "./adapters/dynamo/tagRepo";
import { S3UploadSigner } from "./adapters/s3/uploadSigner";
import { EventBridgePublishScheduler } from "./adapters/scheduler/publishScheduler";
import { SqsBuildQueue } from "./adapters/sqs/buildQueue";
import type { Config } from "./config";
import type { Deps, Log } from "./usecases/ports";

export function createDeps(config: Config, log: Log): Deps {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return {
    posts: new DynamoPostRepository(db, config.TABLE_NAME),
    tags: new DynamoTagRepository(db, config.TABLE_NAME),
    builds: new DynamoBuildStatusRepository(db, config.TABLE_NAME),
    buildQueue: new SqsBuildQueue(new SQSClient({}), config.BUILD_QUEUE_URL),
    scheduler: new EventBridgePublishScheduler(new SchedulerClient({}), {
      groupName: config.SCHEDULER_GROUP,
      lambdaArn: config.SCHEDULER_TARGET_ARN,
      roleArn: config.SCHEDULER_ROLE_ARN,
    }),
    uploads: new S3UploadSigner(new S3Client({}), config.MEDIA_BUCKET),
    log,
    now: () => new Date().toISOString(),
    newId: () => ulid(),
    blogBaseUrl: config.BLOG_BASE_URL,
  };
}
