# Runbook: deploy lần đầu (prod)

Tài khoản `002581114203`, profile `default`, region `ap-northeast-1` (chứng chỉ CloudFront ở `us-east-1`).
Lần deploy đầu tiên: 2026-10-11.

## 0. Kiểm tra trước

```bash
aws sts get-caller-identity
docker info --format '{{.ServerVersion}}'
pnpm -r test
```

## 1. Bootstrap (mỗi tài khoản/region một lần)

```bash
pnpm --filter @blog/infra exec cdk bootstrap aws://002581114203/ap-northeast-1 aws://002581114203/us-east-1
```

## 2. Diff rồi deploy

```bash
pnpm --filter @blog/infra exec cdk diff --all
pnpm --filter @blog/infra exec cdk deploy --all --require-approval never --outputs-file cdk-outputs.json
```

- Lần đầu, `cdk diff` của stack `Blog` báo `ssm:/cdk/exports/Blog/... cannot be found`: bình thường, tham số SSM chỉ có sau khi `BlogCert` (us-east-1) deploy xong.
- Thời gian lần đầu: ~15 phút (BlogCert ~3 phút, BlogData ~45 giây, Blog ~7 phút, cộng thời gian đẩy image build lên ECR).
- Kết quả ghi ở `infra/cdk-outputs.json` (git-ignored).
- Không dùng `--hotswap` hay `--express` cho prod.

## 3. Xác nhận email cảnh báo

SNS gửi email "Subscription Confirmation" tới địa chỉ `alertEmail` trong `infra/cdk.json`; bấm link xác nhận. Kiểm tra:

```bash
aws sns list-subscriptions --region ap-northeast-1 --query 'Subscriptions[?Protocol==`email`]'
```

## 4. Build site lần đầu

Bucket site trống cho tới lần build đầu (blog trả 403). Đẩy một message vào hàng đợi build:

```bash
QUEUE_URL=$(jq -r .Blog.BuildQueueUrl infra/cdk-outputs.json)
aws sqs send-message --region ap-northeast-1 --queue-url "$QUEUE_URL" \
  --message-body '{"reason":"manual"}' --message-group-id site \
  --message-deduplication-id "manual-$(date +%s)"
```

Theo dõi:

```bash
aws logs tail /aws/lambda/blog-build --region ap-northeast-1 --follow
TABLE=$(jq -r '.BlogData | to_entries[] | select(.key|startswith("ExportsOutputRefBlogTable")) | .value' infra/cdk-outputs.json)
aws dynamodb get-item --region ap-northeast-1 --table-name "$TABLE" \
  --key '{"PK":{"S":"BUILD"},"SK":{"S":"LATEST"}}' --query 'Item.status.S'
```

Build rỗng mất ~50 giây, trạng thái `success`.

## 5. Smoke test

```bash
for p in / /vi/ /ja/ /vi/tags/ /vi/search/ /pagefind/pagefind.js; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://blog.oki-dev.xyz$p)"; done   # tất cả 200
curl -s -o /dev/null -w '%{http_code}\n' https://blog.oki-dev.xyz/khong-ton-tai/       # 404
curl -s -o /dev/null -w '%{http_code}\n' https://api.oki-dev.xyz/posts                 # 401
curl -s https://admin.oki-dev.xyz/config.json                                          # JSON cấu hình
curl -sI https://blog.oki-dev.xyz/ | grep -iE 'strict-transport|x-frame|x-content-type|referrer'
```

## 6. Tạo tài khoản admin (chủ blog tự làm)

```bash
USER_POOL_ID=$(jq -r .Blog.UserPoolId infra/cdk-outputs.json)
aws cognito-idp admin-create-user --region ap-northeast-1 --user-pool-id "$USER_POOL_ID" \
  --username <email-cua-ban> \
  --user-attributes Name=email,Value=<email-cua-ban> Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

Cognito gửi mật khẩu tạm qua email. Lần đăng nhập đầu (khi có trang admin ở Kế hoạch 5): đổi mật khẩu và đăng ký ứng dụng TOTP (MFA bắt buộc).

## Ghi chú

- `BlogData` bật termination protection; bảng DynamoDB và user pool bật deletion protection và `RETAIN`.
- Log: `/aws/lambda/blog-build`, `/aws/lambda/blog-api` (giữ 1 tháng).
- Cảnh báo: DLQ có message, API lỗi ≥5/5 phút, build lỗi; ngân sách 5 USD/tháng (dự báo).
