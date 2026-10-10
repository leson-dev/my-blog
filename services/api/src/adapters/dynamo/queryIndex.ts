import { type DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { POSTS_INDEX } from "./items";

/** Reads every item of one GSI1 partition ("POST" or "TAG"), following pagination. */
export async function queryIndex(
  db: DynamoDBDocumentClient,
  tableName: string,
  partition: "POST" | "TAG",
  newestFirst: boolean,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: POSTS_INDEX,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": partition },
        ScanIndexForward: !newestFirst,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}
