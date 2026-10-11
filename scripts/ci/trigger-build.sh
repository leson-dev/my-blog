#!/usr/bin/env bash
# Rebuild the site with the image just deployed, then wait until BUILD/LATEST reports the result
# of *this* build (updatedAt newer than the moment the message was sent). Spec 5.5: 5 minutes.
set -euo pipefail

OUTPUTS=${1:-infra/cdk-outputs.json}
REGION=${AWS_REGION:-ap-northeast-1}
QUEUE_URL=$(jq -r '.Blog.BuildQueueUrl // empty' "$OUTPUTS")
TABLE=$(jq -r '(.BlogData // {}) | to_entries[] | select(.key | startswith("ExportsOutputRefBlogTable")) | .value' "$OUTPUTS")
if [[ -z "$QUEUE_URL" || -z "$TABLE" ]]; then
  echo "cannot read the build queue / table from $OUTPUTS" >&2
  exit 1
fi

SENT_AT=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
aws sqs send-message --region "$REGION" --queue-url "$QUEUE_URL" \
  --message-body '{"reason":"deploy"}' --message-group-id site \
  --message-deduplication-id "deploy-${GITHUB_RUN_ID:-local}-$(date +%s)" >/dev/null
echo "build requested at $SENT_AT"

for _ in $(seq 1 60); do
  read -r STATUS UPDATED < <(aws dynamodb get-item --region "$REGION" --table-name "$TABLE" \
    --key '{"PK":{"S":"BUILD"},"SK":{"S":"LATEST"}}' \
    --query '[Item.status.S, Item.updatedAt.S]' --output text)
  if [[ "$UPDATED" > "$SENT_AT" ]]; then
    case "$STATUS" in
      success) echo "build success ($UPDATED)"; exit 0 ;;
      failed) echo "build failed ($UPDATED) — see /aws/lambda/blog-build" >&2; exit 1 ;;
    esac
  fi
  sleep 5
done
echo "the build did not finish within 5 minutes" >&2
exit 1
