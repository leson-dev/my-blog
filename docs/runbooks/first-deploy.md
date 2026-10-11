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

Build trang quản trị **ngay trước** khi diff (CDK đọc `apps/admin/dist`; thiếu thì synth báo lỗi kèm lệnh này; bản build cũ sẽ được deploy nguyên trạng):

```bash
pnpm --filter @blog/admin build
```

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

## Trang quản trị

- `https://admin.oki-dev.xyz/` → đăng nhập Cognito (MFA TOTP bắt buộc); trang đăng nhập màu C1 cấu hình ở `infra/lib/branding.ts` (logo phải có tỉ lệ rộng:cao trong khoảng 1:1–4:1, Cognito từ chối nếu khác).
- Dev local: `pnpm --filter @blog/admin dev:config && pnpm --filter @blog/admin dev` → `http://localhost:5173` (đăng nhập bằng tài khoản thật, ghi thẳng vào prod — cẩn thận khi đăng bài).
- CSP: `infra/lib/constructs/admin-csp.ts`. Lỗi "Refused to …" trong console → thêm nguồn ở đó, không nới `script-src`.
- Kiểm tra sau deploy: `curl -sI https://admin.oki-dev.xyz/` có `content-security-policy`, `cache-control: no-cache`; file `/assets/*.js` có `immutable`.

## CI/CD (GitHub Actions)

- Repo: `leson-dev/my-blog` (public). `main`: chỉ nhận PR, squash, check `ci` (GitHub Actions) phải xanh, nhánh phải cập nhật, không bypass.
- Quy trình: `git checkout -b feat/…` → push → `gh pr create` → CI xanh → `gh pr merge --squash` → workflow `deploy` tự chạy (deploy 3 stack, build lại site, smoke + E2E chỉ đọc). `deploy` không chạy lại CI: ruleset đã bắt `ci` xanh trên nhánh cập nhật với `main`; deploy chạy tay (`workflow_dispatch`) thì không có CI đi trước.
- Quyền AWS: role `blog-github-deploy` / `blog-github-gc` qua OIDC (stack `BlogCi`, deploy tay: `pnpm --filter @blog/infra exec cdk deploy BlogCi`). Không có access key/GitHub Secret.
- Repo dùng **subject bất biến** của GitHub: `repo:leson-dev@124803053/my-blog@1413856263:ref:refs/heads/main` (context `githubOidcSubject` trong `infra/cdk.json`; xem bằng `gh api repos/leson-dev/my-blog/actions/oidc/customization/sub`). Đổi tên tài khoản/repo không làm hỏng; chuyển repo sang chủ khác thì phải sửa giá trị này + deploy lại `BlogCi`.
- Merge chỉ sửa tài liệu (`*.md`, `docs/**`, `LICENSE`) **không** deploy (`paths-ignore`); `ci` vẫn chạy trên mọi PR vì là check bắt buộc của ruleset (bỏ qua thì PR kẹt). Deploy lại không đổi code: `gh workflow run deploy.yml`.
- Dọn asset CDK: workflow `gc` chạy ngày 1 hằng tháng; xem trước bằng `gh workflow run gc.yml -f action=print`. Nếu `gc` làm huỷ một lượt deploy đang chờ (cùng nhóm concurrency) → chạy lại `deploy`.
- E2E local (chỉ đọc prod): `pnpm --filter @blog/e2e e2e`.
- Workflow đỏ → GitHub gửi email; xem `gh run view --log-failed`. Không tự rollback: sửa qua PR mới.
