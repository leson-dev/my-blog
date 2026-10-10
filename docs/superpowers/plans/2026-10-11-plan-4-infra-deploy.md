# Kế hoạch 4: Hạ tầng CDK & deploy lần đầu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Viết toàn bộ hạ tầng của blog bằng AWS CDK (TypeScript) trong `infra/`, kiểm thử bằng `aws-cdk-lib/assertions`, rồi deploy lần đầu vào tài khoản `002581114203` — `blog.oki-dev.xyz` phục vụ site (rỗng), `api.oki-dev.xyz` yêu cầu JWT, `admin.oki-dev.xyz` phục vụ `config.json` + trang chờ, Build Lambda chạy được qua SQS.

**Architecture:** Ba stack.
- `BlogCert` (`us-east-1`): chứng chỉ ACM cho `blog.` + `admin.` (CloudFront bắt buộc us-east-1).
- `BlogData` (`ap-northeast-1`, termination protection): bảng DynamoDB `BlogTable` (GSI `byUpdated`, PITR, RETAIN) và Cognito (user pool bắt buộc MFA TOTP, nhóm `e2e`, app client OAuth code + PKCE, Managed Login).
- `Blog` (`ap-northeast-1`, `crossRegionReferences`): bucket site/admin (DESTROY) + bucket ảnh (RETAIN, versioning) — bucket ảnh nằm ở đây vì OAC của CloudFront phải sửa bucket policy, đặt ở `BlogData` sẽ sinh vòng phụ thuộc; 2 CloudFront distribution; Lambda API (Node 24, arm64) + HTTP API (JWT Cognito, throttling, CORS, domain `api.`); EventBridge Scheduler group + role; SQS FIFO + DLQ + Build Lambda (image x86_64); CloudWatch alarm + SNS email + AWS Budgets; DNS alias; `config.json` cho trang quản trị.

**Tech Stack:** aws-cdk-lib 2.272.0, aws-cdk (CLI) 2.1144.0, constructs 10.8.1, tsx 4.23.15, esbuild 0.28.2 (bundle Lambda API), Vitest 5.0.3, TypeScript 7.0.2, Docker (image Build Lambda).

**Spec:**
- [`docs/superpowers/specs/2026-10-10-serverless-blog-design.md`](../specs/2026-10-10-serverless-blog-design.md) — mục 1 (kiến trúc), 3 (publish/build), 4.1 (cache), 5.2 (bảo mật), 5.3 (giám sát), 5.5 (stack CDK).
- [`docs/superpowers/specs/2026-10-10-ui-i18n-design.md`](../specs/2026-10-10-ui-i18n-design.md) — mục 2.1 (đường dẫn), 3 (dữ liệu, lịch hẹn).

**Vị trí:** sau Kế hoạch 3 (đã merge). `CiStack` (OIDC cho GitHub) **dời sang Kế hoạch 6** (đã thống nhất). Trang quản trị thật thuộc Kế hoạch 5 — kế hoạch này chỉ đặt `config.json` + trang chờ.

## Global Constraints

- Ràng buộc chung các kế hoạch trước vẫn áp dụng (pnpm catalog, không `minimumReleaseAgeExclude`, TS strict, Biome, commit trailer).
- Catalog thêm: `aws-cdk-lib: 2.272.0`, `aws-cdk: 2.1144.0`, `constructs: 10.8.1`, `tsx: 4.23.15`.
- **Tài khoản / region:** `002581114203`, `ap-northeast-1` (chính), `us-east-1` (chứng chỉ CloudFront). Profile AWS CLI `default`.
- **Tên miền:** hosted zone `oki-dev.xyz` (`Z05049371XH13FJE6L09`) — **không** dùng `fromLookup` (CI không cần quyền AWS để synth); mọi giá trị nằm trong `infra/cdk.json` context.
- **Email cảnh báo:** `nguyenleson0002@gmail.com`; ngân sách $5/tháng (dự báo > 100%).
- **Lambda API:** `NODEJS_24_X`, `ARM_64`, 512 MB, timeout 10 s, tên `blog-api`, log 30 ngày. Biến môi trường đúng như `services/api/src/config.ts`.
- **Build Lambda:** image từ `services/build/Dockerfile` (context gốc repo, `linux/amd64`), `X86_64`, 2048 MB, timeout 5 phút, `/tmp` 2 GiB, tên `blog-build`; SQS FIFO `batchSize 10`, visibility 30 phút, DLQ `maxReceiveCount 2`.
- **CloudFront site:** cache policy TTL min = default = max = 365 ngày (HTML trình duyệt `max-age=0` do header từ S3; edge giữ đến khi build invalidate); `/media/*` → bucket ảnh; CloudFront Function viewer-request đổi `/vi/` → `/vi/index.html` (S3 REST không có index tự động — **khác với Function chuyển ngôn ngữ đã bỏ ở spec**); lỗi 403/404 → `/404.html` (404); `SECURITY_HEADERS`; HTTP/2+3; TLS ≥ 1.2.
- **Mọi bucket:** chặn truy cập công khai, SSE-S3, bắt buộc TLS, chỉ CloudFront đọc qua OAC.
- **HTTP API:** mọi route có JWT authorizer Cognito; CORS chỉ `https://admin.oki-dev.xyz` và `http://localhost:5173` (dev Kế hoạch 5); throttling 20 req/s, burst 40.
- **Deploy là hành động thật:** mỗi lệnh `cdk bootstrap`, `cdk deploy`, gửi message SQS **phải được tác giả xác nhận trong chat ngay trước khi chạy**. Không dùng `--hotswap`/`--express`. Luôn `cdk diff` trước `cdk deploy`.
- **Không tạo tài khoản đăng nhập thay tác giả:** lệnh tạo user Cognito do tác giả tự chạy.

## Review Focus

1. **Vòng phụ thuộc / tham chiếu chéo region:** `BlogCert` (us-east-1) → `Blog` qua `crossRegionReferences`; `BlogData` → `Blog` qua export. Không stack nào được tham chiếu ngược. → Task 5 (synth cả app).
2. **Tài nguyên có dữ liệu bị xoá khi xoá stack / đổi construct ID:** bảng, user pool, bucket ảnh phải `Retain`; `BlogData` bật termination protection. → Task 2, Task 3.
3. **Site trả 403 thay vì trang cho URL thư mục** (`/vi/`, `/ja/posts/x/`) và cache HTML: CloudFront Function đổi URI đúng; cache policy giữ HTML lâu tại edge nhưng trình duyệt luôn hỏi lại. → Task 3.
4. **Quyền thừa / thiếu:** API chỉ tạo/sửa/xoá schedule trong group `blog-publish` và chỉ `PassRole` đúng role scheduler; Build Lambda chỉ ghi bucket site + invalidate đúng distribution blog; bucket ảnh nhận upload qua presigned POST từ origin admin. → Task 3, Task 4.
5. **Deploy hỏng giữa chừng / site trống sau deploy:** site chỉ có nội dung sau lượt build đầu tiên → bước kích hoạt build + kiểm tra HTTP thật. → Task 6.

---

## Cấu trúc file

```
pnpm-workspace.yaml               # SỬA: catalog + "infra" đã có trong packages
.dockerignore                     # SỬA: thêm **/cdk.out
infra/
  package.json, tsconfig.json, vitest.config.ts, cdk.json
  bin/blog.ts                     # entry CDK app
  lib/config.ts                   # đọc context → BlogConfig
  lib/app.ts                      # createStacks(app, repoRoot)
  lib/cert-stack.ts               # BlogCert (us-east-1)
  lib/data-stack.ts               # BlogData: DynamoDB + Cognito
  lib/blog-stack.ts               # Blog: ghép các construct
  lib/constructs/site-hosting.ts  # bucket site/admin, 2 distribution, DNS
  lib/constructs/build-pipeline.ts# SQS FIFO + DLQ + Build Lambda
  lib/constructs/api-service.ts   # Lambda API + HTTP API + domain + scheduler
  lib/constructs/monitoring.ts    # SNS + alarm + budget
  functions/rewrite-index.js      # CloudFront Function
  test/helpers.ts, test/*.test.ts
```

---

### Task 1: Khung `infra`, cấu hình & stack chứng chỉ

**Files:**
- Modify: `pnpm-workspace.yaml`, `.dockerignore`
- Create: `infra/package.json`, `infra/tsconfig.json`, `infra/vitest.config.ts`, `infra/cdk.json`, `infra/lib/config.ts`, `infra/lib/cert-stack.ts`, `infra/test/helpers.ts`
- Test: `infra/test/config.test.ts`, `infra/test/cert-stack.test.ts`

**Interfaces:**
- Produces:
  - `interface BlogConfig { account; region; domainName; hostedZoneId; alertEmail; adminDevOrigin; blogHost; adminHost; apiHost }`; `readConfig(app: App): BlogConfig` (ném `missing context: <key>`)
  - `class CertStack extends Stack { readonly certificate: acm.ICertificate }` — props `StackProps & { config: BlogConfig }`
  - `test/helpers.ts`: `TEST_CONTEXT`, `repoRoot`, `testApp(): App` (context test + tắt bundling)

- [ ] **Step 1: Nhánh, catalog, dockerignore**

```bash
git checkout -b feat/plan-4-infra
```

Thêm vào cuối khối `catalog:` của `pnpm-workspace.yaml`:
```yaml
  aws-cdk-lib: 2.272.0
  aws-cdk: 2.1144.0
  constructs: 10.8.1
  tsx: 4.23.15
```

Thêm vào cuối `.dockerignore`:
```
**/cdk.out
```

- [ ] **Step 2: Khung package**

`infra/package.json`:
```json
{
  "name": "@blog/infra",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "cdk": "cdk",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "aws-cdk-lib": "catalog:",
    "constructs": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "aws-cdk": "catalog:",
    "esbuild": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`infra/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "include": ["bin", "lib", "test"]
}
```

`infra/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
```

`infra/cdk.json`:
```json
{
  "app": "pnpm exec tsx bin/blog.ts",
  "context": {
    "account": "002581114203",
    "region": "ap-northeast-1",
    "domainName": "oki-dev.xyz",
    "hostedZoneId": "Z05049371XH13FJE6L09",
    "alertEmail": "nguyenleson0002@gmail.com",
    "adminDevOrigin": "http://localhost:5173"
  }
}
```

Run: `pnpm install`
Expected: thành công, không cảnh báo `minimumReleaseAge`.

- [ ] **Step 3: Viết test thất bại**

`infra/test/helpers.ts`:
```ts
import { resolve } from "node:path";
import { App } from "aws-cdk-lib";

export const repoRoot = resolve(import.meta.dirname, "../..");

export const TEST_CONTEXT = {
  account: "111111111111",
  region: "ap-northeast-1",
  domainName: "example.dev",
  hostedZoneId: "ZTEST123",
  alertEmail: "alerts@example.dev",
  adminDevOrigin: "http://localhost:5173",
};

/** An app with test context; Lambda bundling is skipped to keep synth fast. */
export const testApp = (context: Record<string, string> = TEST_CONTEXT) =>
  new App({ context: { ...context, "aws:cdk:bundling-stacks": [] } });
```

`infra/test/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import { TEST_CONTEXT, testApp } from "./helpers";

describe("readConfig", () => {
  it("reads the context and derives the three host names", () => {
    expect(readConfig(testApp())).toEqual({
      ...TEST_CONTEXT,
      blogHost: "blog.example.dev",
      adminHost: "admin.example.dev",
      apiHost: "api.example.dev",
    });
  });

  it("fails on a missing value", () => {
    const { alertEmail: _omit, ...rest } = TEST_CONTEXT;
    expect(() => readConfig(testApp(rest))).toThrow("missing context: alertEmail");
  });
});
```

`infra/test/cert-stack.test.ts`:
```ts
import { Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { CertStack } from "../lib/cert-stack";
import { readConfig } from "../lib/config";
import { testApp } from "./helpers";

describe("CertStack", () => {
  it("issues one DNS-validated certificate for the blog and admin hosts", () => {
    const app = testApp();
    const stack = new CertStack(app, "Cert", {
      env: { account: "111111111111", region: "us-east-1" },
      config: readConfig(app),
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "blog.example.dev",
      SubjectAlternativeNames: ["admin.example.dev"],
      ValidationMethod: "DNS",
    });
  });
});
```

- [ ] **Step 4: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/infra test`
Expected: FAIL — không resolve được `../lib/config`, `../lib/cert-stack`.

- [ ] **Step 5: Viết mã**

`infra/lib/config.ts`:
```ts
import type { App } from "aws-cdk-lib";

export interface BlogConfig {
  account: string;
  region: string;
  domainName: string;
  hostedZoneId: string;
  alertEmail: string;
  adminDevOrigin: string;
  blogHost: string;
  adminHost: string;
  apiHost: string;
}

const KEYS = ["account", "region", "domainName", "hostedZoneId", "alertEmail", "adminDevOrigin"] as const;

export function readConfig(app: App): BlogConfig {
  const values = {} as Record<(typeof KEYS)[number], string>;
  for (const key of KEYS) {
    const value: unknown = app.node.tryGetContext(key);
    if (typeof value !== "string" || value === "") throw new Error(`missing context: ${key}`);
    values[key] = value;
  }
  return {
    ...values,
    blogHost: `blog.${values.domainName}`,
    adminHost: `admin.${values.domainName}`,
    apiHost: `api.${values.domainName}`,
  };
}
```

`infra/lib/cert-stack.ts`:
```ts
import { Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import type { Construct } from "constructs";
import type { BlogConfig } from "./config";

/** CloudFront only accepts certificates from us-east-1. */
export class CertStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: StackProps & { config: BlogConfig }) {
    super(scope, id, props);
    const { config } = props;
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.domainName,
    });
    this.certificate = new acm.Certificate(this, "EdgeCertificate", {
      domainName: config.blogHost,
      subjectAlternativeNames: [config.adminHost],
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}
```

- [ ] **Step 6: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/infra test && pnpm --filter @blog/infra typecheck`
Expected: PASS 3 test; typecheck sạch.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add pnpm-workspace.yaml pnpm-lock.yaml .dockerignore infra
git commit -m "feat(infra): CDK app scaffold, context config and edge certificate stack" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stack dữ liệu — DynamoDB & Cognito

**Files:**
- Create: `infra/lib/data-stack.ts`
- Test: `infra/test/data-stack.test.ts`

**Interfaces:**
- Consumes: `BlogConfig` (Task 1).
- Produces: `class DataStack extends Stack { readonly table: dynamodb.TableV2; readonly userPool: cognito.UserPool; readonly userPoolClient: cognito.UserPoolClient; readonly userPoolDomain: cognito.UserPoolDomain }` — props `StackProps & { config: BlogConfig }`; termination protection bật.

- [ ] **Step 1: Viết test thất bại**

`infra/test/data-stack.test.ts`:
```ts
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { testApp } from "./helpers";

const synth = () => {
  const app = testApp();
  const stack = new DataStack(app, "Data", {
    env: { account: "111111111111", region: "ap-northeast-1" },
    config: readConfig(app),
  });
  return { stack, template: Template.fromStack(stack) };
};

describe("DataStack", () => {
  it("is protected against accidental deletion", () => {
    expect(synth().stack.terminationProtection).toBe(true);
  });

  it("creates the single table with the byUpdated index, PITR and retention", () => {
    const { template } = synth();
    template.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        GlobalSecondaryIndexes: [
          Match.objectLike({
            IndexName: "byUpdated",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
          }),
        ],
        Replicas: [
          Match.objectLike({
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          }),
        ],
      }),
    });
  });

  it("creates an admin-only user pool with mandatory TOTP MFA", () => {
    const { template } = synth();
    template.hasResource("AWS::Cognito::UserPool", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
        MfaConfiguration: "ON",
        EnabledMfas: ["SOFTWARE_TOKEN_MFA"],
        UsernameAttributes: ["email"],
      }),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: "e2e" });
  });

  it("creates a public OAuth code client for the admin with managed login", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: Match.arrayWith(["openid", "email"]),
      CallbackURLs: ["https://admin.example.dev/", "http://localhost:5173/"],
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: "oki-dev-blog-111111111111",
      ManagedLoginVersion: 2,
    });
    template.resourceCountIs("AWS::Cognito::ManagedLoginBranding", 1);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/infra exec vitest run test/data-stack.test.ts`
Expected: FAIL — không resolve được `../lib/data-stack`.

- [ ] **Step 3: Viết mã**

`infra/lib/data-stack.ts`:
```ts
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import type { BlogConfig } from "./config";

/** Stateful resources: retained on delete, stack protected against termination. */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: StackProps & { config: BlogConfig }) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;

    this.table = new dynamodb.TableV2(this, "BlogTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: "byUpdated",
          partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    this.userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, "E2EGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "e2e",
      description: "E2E test account: may only modify drafts (enforced by the API)",
    });

    const appUrls = [`https://${config.adminHost}/`, `${config.adminDevOrigin}/`];
    this.userPoolClient = this.userPool.addClient("AdminClient", {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: appUrls,
        logoutUrls: appUrls,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    this.userPoolDomain = this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `oki-dev-blog-${this.account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // Managed login needs a style per app client; Plan 5 replaces the defaults with C1 colours.
    new cognito.CfnManagedLoginBranding(this, "LoginBranding", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
  }
}
```

> Nếu `tsc` báo `pointInTimeRecoverySpecification` không tồn tại trên `TablePropsV2` của 2.272.0, dùng `pointInTimeRecovery: true` (tên cũ) và ghi Ruling; test vẫn kiểm tra kết quả CloudFormation.

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/infra test && pnpm --filter @blog/infra typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add infra
git commit -m "feat(infra): data stack with DynamoDB table and Cognito user pool" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hosting — bucket, CloudFront, CloudFront Function, DNS

**Files:**
- Create: `infra/functions/rewrite-index.js`, `infra/lib/constructs/site-hosting.ts`
- Test: `infra/test/rewrite-index.test.ts`, `infra/test/site-hosting.test.ts`

**Interfaces:**
- Consumes: `BlogConfig`.
- Produces: `class SiteHosting extends Construct` — props `{ config: BlogConfig; certificate: acm.ICertificate; zone: route53.IHostedZone; mediaBucket: s3.IBucket }`; thuộc tính `siteBucket`, `adminBucket`, `blogDistribution`, `adminDistribution`. Hàm `createMediaBucket(scope, id, config): s3.Bucket`.

- [ ] **Step 1: Viết test thất bại**

`infra/test/rewrite-index.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Request = { uri: string };
const code = readFileSync(join(import.meta.dirname, "../functions/rewrite-index.js"), "utf8");
const handler = new Function(`${code}; return handler;`)() as (event: { request: Request }) => Request;
const rewrite = (uri: string) => handler({ request: { uri } }).uri;

describe("rewrite-index CloudFront Function", () => {
  it.each([
    ["/", "/index.html"],
    ["/vi/", "/vi/index.html"],
    ["/ja/posts/tokyo-autumn/", "/ja/posts/tokyo-autumn/index.html"],
    ["/vi/tags/life", "/vi/tags/life/index.html"],
    ["/_astro/app.abc123.css", "/_astro/app.abc123.css"],
    ["/404.html", "/404.html"],
    ["/pagefind/pagefind.js", "/pagefind/pagefind.js"],
  ])("%s -> %s", (uri, expected) => {
    expect(rewrite(uri)).toBe(expected);
  });
});
```

`infra/test/site-hosting.test.ts`:
```ts
import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { describe, it } from "vitest";
import { readConfig } from "../lib/config";
import { createMediaBucket, SiteHosting } from "../lib/constructs/site-hosting";
import { testApp } from "./helpers";

const synth = () => {
  const app = testApp();
  const config = readConfig(app);
  const stack = new Stack(app, "Hosting", { env: { account: "111111111111", region: "ap-northeast-1" } });
  new SiteHosting(stack, "Hosting", {
    config,
    certificate: acm.Certificate.fromCertificateArn(stack, "Cert", "arn:aws:acm:us-east-1:111111111111:certificate/x"),
    zone: route53.HostedZone.fromHostedZoneAttributes(stack, "Zone", { hostedZoneId: "ZTEST123", zoneName: "example.dev" }),
    mediaBucket: createMediaBucket(stack, "Media", config),
  });
  return Template.fromStack(stack);
};

describe("SiteHosting", () => {
  it("keeps every bucket private, encrypted and TLS-only", () => {
    const template = synth();
    template.allResourcesProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.anyValue(),
    });
  });

  it("retains and versions the media bucket, expires e2e uploads and allows admin POST uploads", () => {
    const template = synth();
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        VersioningConfiguration: { Status: "Enabled" },
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({ Prefix: "media/e2e/", ExpirationInDays: 1, Status: "Enabled" }),
          ]),
        },
        CorsConfiguration: {
          CorsRules: [
            Match.objectLike({
              AllowedMethods: ["POST"],
              AllowedOrigins: ["https://admin.example.dev", "http://localhost:5173"],
            }),
          ],
        },
      }),
    });
  });

  it("serves the blog through CloudFront with OAC, the index rewrite and long edge caching", () => {
    const template = synth();
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["blog.example.dev"],
        HttpVersion: "http2and3",
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        }),
        CacheBehaviors: [Match.objectLike({ PathPattern: "/media/*" })],
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 404, ResponsePagePath: "/404.html" }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: "/404.html" }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({ MinTTL: 31536000, DefaultTTL: 31536000, MaxTTL: 31536000 }),
    });
    template.resourcePropertiesCountIs(
      "AWS::CloudFront::OriginAccessControl",
      { OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: "s3" }) },
      3,
    );
  });

  it("serves the admin SPA with index.html as the fallback", () => {
    synth().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["admin.example.dev"],
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: "/index.html" }),
        ]),
      }),
    });
  });

  it("points blog and admin A/AAAA records at the distributions", () => {
    const template = synth();
    for (const type of ["A", "AAAA"]) {
      for (const name of ["blog.example.dev.", "admin.example.dev."]) {
        template.hasResourceProperties("AWS::Route53::RecordSet", { Name: name, Type: type });
      }
    }
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/infra exec vitest run test/rewrite-index.test.ts test/site-hosting.test.ts`
Expected: FAIL — thiếu `functions/rewrite-index.js` và `lib/constructs/site-hosting`.

- [ ] **Step 3: Viết mã**

`infra/functions/rewrite-index.js`:
```js
// CloudFront Function (cloudfront-js-2.0), viewer request on the blog distribution.
// S3 REST origins have no directory index: serve /vi/ and /vi/tags/life from index.html.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (uri.split("/").pop().indexOf(".") === -1) {
    request.uri = uri + "/index.html";
  }
  return request;
}
```

`infra/lib/constructs/site-hosting.ts`:
```ts
import { join } from "node:path";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { BlogConfig } from "../config";

const ONE_YEAR = Duration.days(365);

const privateBucket = (scope: Construct, id: string, props: s3.BucketProps = {}) =>
  new s3.Bucket(scope, id, {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    ...props,
  });

/** Uploaded images: retained and versioned; e2e uploads expire after a day. */
export const createMediaBucket = (scope: Construct, id: string, config: BlogConfig) =>
  privateBucket(scope, id, {
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    versioned: true,
    cors: [
      {
        allowedMethods: [s3.HttpMethods.POST],
        allowedOrigins: [`https://${config.adminHost}`, config.adminDevOrigin],
        allowedHeaders: ["*"],
        maxAge: 3000,
      },
    ],
    lifecycleRules: [
      {
        id: "expire-e2e-uploads",
        prefix: "media/e2e/",
        expiration: Duration.days(1),
        noncurrentVersionExpiration: Duration.days(1),
      },
      { id: "expire-old-versions", noncurrentVersionExpiration: Duration.days(30) },
    ],
  });

export interface SiteHostingProps {
  config: BlogConfig;
  certificate: acm.ICertificate;
  zone: route53.IHostedZone;
  mediaBucket: s3.IBucket;
}

export class SiteHosting extends Construct {
  readonly siteBucket: s3.Bucket;
  readonly adminBucket: s3.Bucket;
  readonly blogDistribution: cloudfront.Distribution;
  readonly adminDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SiteHostingProps) {
    super(scope, id);
    const { config, certificate, zone, mediaBucket } = props;

    this.siteBucket = privateBucket(this, "SiteBucket");
    this.adminBucket = privateBucket(this, "AdminBucket");

    const indexRewrite = new cloudfront.Function(this, "IndexRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: join(import.meta.dirname, "../../functions/rewrite-index.js"),
      }),
    });

    // HTML is sent with max-age=0 to browsers but kept at the edge until a build invalidates /*.
    const siteCache = new cloudfront.CachePolicy(this, "SiteCache", {
      comment: "oki-dev blog: cached at the edge until the next build invalidates it",
      minTtl: ONE_YEAR,
      defaultTtl: ONE_YEAR,
      maxTtl: ONE_YEAR,
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const common = {
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    };

    this.blogDistribution = new cloudfront.Distribution(this, "BlogDistribution", {
      ...common,
      domainNames: [config.blogHost],
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: siteCache,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [
          { function: indexRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        "/media/*": {
          origin: S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
      },
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: "/404.html",
        ttl: Duration.minutes(1),
      })),
    });

    this.adminDistribution = new cloudfront.Distribution(this, "AdminDistribution", {
      ...common,
      domainNames: [config.adminHost],
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.adminBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
      // Single-page app: unknown paths render index.html.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
        ttl: Duration.seconds(10),
      })),
    });

    const records: Array<[string, string, cloudfront.Distribution]> = [
      ["Blog", config.blogHost, this.blogDistribution],
      ["Admin", config.adminHost, this.adminDistribution],
    ];
    for (const [name, host, distribution] of records) {
      const target = route53.RecordTarget.fromAlias(new CloudFrontTarget(distribution));
      new route53.ARecord(this, `${name}A`, { zone, recordName: host, target });
      new route53.AaaaRecord(this, `${name}Aaaa`, { zone, recordName: host, target });
    }
  }
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/infra test && pnpm --filter @blog/infra typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add infra
git commit -m "feat(infra): private buckets, CloudFront distributions with OAC and DNS records" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Build pipeline & API service

**Files:**
- Create: `infra/lib/constructs/build-pipeline.ts`, `infra/lib/constructs/api-service.ts`
- Test: `infra/test/build-pipeline.test.ts`, `infra/test/api-service.test.ts`

**Interfaces:**
- Consumes: `BlogConfig`, `repoRoot` (helpers), các tài nguyên Task 2–3.
- Produces:
  - `class BuildPipeline extends Construct` — props `{ table: dynamodb.ITableV2; siteBucket: s3.IBucket; distribution: cloudfront.Distribution; repoRoot: string }`; thuộc tính `queue`, `dlq`, `fn`
  - `API_ROUTES` (14 route key của Kế hoạch 1b Task 8); `class ApiService extends Construct` — props `{ config; zone; table; mediaBucket; buildQueue: sqs.IQueue; userPool: cognito.IUserPool; userPoolClient: cognito.IUserPoolClient; repoRoot }`; thuộc tính `fn`, `httpApi`, `url`

- [ ] **Step 1: Viết test thất bại**

`infra/test/build-pipeline.test.ts`:
```ts
import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { describe, it } from "vitest";
import { BuildPipeline } from "../lib/constructs/build-pipeline";
import { repoRoot, testApp } from "./helpers";

const synth = () => {
  const stack = new Stack(testApp(), "Build", { env: { account: "111111111111", region: "ap-northeast-1" } });
  const siteBucket = new s3.Bucket(stack, "Site");
  new BuildPipeline(stack, "Build", {
    table: new dynamodb.TableV2(stack, "Table", { partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING } }),
    siteBucket,
    distribution: new cloudfront.Distribution(stack, "Dist", {
      defaultBehavior: { origin: S3BucketOrigin.withOriginAccessControl(siteBucket) },
    }),
    repoRoot,
  });
  return Template.fromStack(stack);
};

describe("BuildPipeline", () => {
  it("feeds a FIFO queue with a two-attempt DLQ into the build function", () => {
    const template = synth();
    template.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
      VisibilityTimeout: 1800,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 2 }),
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", { BatchSize: 10 });
  });

  it("runs the build as an x86_64 container image with the planned limits", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "blog-build",
      PackageType: "Image",
      Architectures: ["x86_64"],
      MemorySize: 2048,
      Timeout: 300,
      EphemeralStorage: { Size: 2048 },
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          SITE_BUCKET: Match.anyValue(),
          DISTRIBUTION_ID: Match.anyValue(),
        }),
      },
    });
  });

  it("may invalidate and poll invalidations of the blog distribution", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "cloudfront:GetInvalidation" }),
        ]),
      },
    });
  });
});
```

`infra/test/api-service.test.ts`:
```ts
import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import { API_ROUTES, ApiService } from "../lib/constructs/api-service";
import { repoRoot, testApp } from "./helpers";

const synth = () => {
  const app = testApp();
  const stack = new Stack(app, "Api", { env: { account: "111111111111", region: "ap-northeast-1" } });
  const userPool = new cognito.UserPool(stack, "Pool");
  new ApiService(stack, "Api", {
    config: readConfig(app),
    zone: route53.HostedZone.fromHostedZoneAttributes(stack, "Zone", { hostedZoneId: "ZTEST123", zoneName: "example.dev" }),
    table: new dynamodb.TableV2(stack, "Table", { partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING } }),
    mediaBucket: new s3.Bucket(stack, "Media"),
    buildQueue: new sqs.Queue(stack, "Queue", { fifo: true }),
    userPool,
    userPoolClient: userPool.addClient("Client"),
    repoRoot,
  });
  return Template.fromStack(stack);
};

describe("ApiService", () => {
  it("runs the API on Node 24 / arm64 with the environment services/api expects", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "blog-api",
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          BUILD_QUEUE_URL: Match.anyValue(),
          MEDIA_BUCKET: Match.anyValue(),
          BLOG_BASE_URL: "https://blog.example.dev",
          SCHEDULER_GROUP: "blog-publish",
          SCHEDULER_TARGET_ARN: Match.anyValue(),
          SCHEDULER_ROLE_ARN: Match.anyValue(),
        }),
      },
    });
  });

  it("protects every planned route with the Cognito JWT authorizer", () => {
    const template = synth();
    expect(API_ROUTES).toHaveLength(14);
    for (const routeKey of API_ROUTES) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: routeKey, AuthorizationType: "JWT" });
    }
  });

  it("throttles, restricts CORS to the admin origins and serves api.<domain>", () => {
    const template = synth();
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: Match.objectLike({ ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 }),
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ["https://admin.example.dev", "http://localhost:5173"],
      }),
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", { DomainName: "api.example.dev" });
    template.hasResourceProperties("AWS::Route53::RecordSet", { Name: "api.example.dev.", Type: "A" });
  });

  it("lets the API manage schedules only in its group and pass only the scheduler role", () => {
    const template = synth();
    template.hasResourceProperties("AWS::Scheduler::ScheduleGroup", { Name: "blog-publish" });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule"],
          }),
          Match.objectLike({ Action: "iam:PassRole" }),
        ]),
      },
    });
    // ARNs contain the ${AWS::Partition} token, so check the serialized template.
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain(":scheduler:ap-northeast-1:111111111111:schedule/blog-publish/*");
    expect(json).toContain(":lambda:ap-northeast-1:111111111111:function:blog-api");
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: "scheduler.amazonaws.com" },
            Condition: { StringEquals: { "aws:SourceAccount": "111111111111" } },
          }),
        ],
      },
    });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/infra exec vitest run test/build-pipeline.test.ts test/api-service.test.ts`
Expected: FAIL — không resolve được các construct mới.

- [ ] **Step 3: Viết mã**

`infra/lib/constructs/build-pipeline.ts`:
```ts
import { Duration, RemovalPolicy, Size } from "aws-cdk-lib";
import type * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface BuildPipelineProps {
  table: dynamodb.ITableV2;
  siteBucket: s3.IBucket;
  distribution: cloudfront.Distribution;
  repoRoot: string;
}

/** SQS FIFO (one message group) → Build Lambda: one build at a time, batches collapsed. */
export class BuildPipeline extends Construct {
  readonly queue: sqs.Queue;
  readonly dlq: sqs.Queue;
  readonly fn: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: BuildPipelineProps) {
    super(scope, id);
    const timeout = Duration.minutes(5);

    this.dlq = new sqs.Queue(this, "BuildDlq", {
      fifo: true,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    this.queue = new sqs.Queue(this, "BuildQueue", {
      fifo: true,
      contentBasedDeduplication: false,
      // AWS guidance for Lambda event sources: at least six times the function timeout.
      visibilityTimeout: Duration.minutes(30),
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: 2 },
      enforceSSL: true,
    });

    this.fn = new lambda.DockerImageFunction(this, "BuildFunction", {
      functionName: "blog-build",
      code: lambda.DockerImageCode.fromImageAsset(props.repoRoot, {
        file: "services/build/Dockerfile",
        platform: Platform.LINUX_AMD64,
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout,
      ephemeralStorageSize: Size.gibibytes(2),
      logGroup: new logs.LogGroup(this, "BuildLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: props.table.tableName,
        SITE_BUCKET: props.siteBucket.bucketName,
        DISTRIBUTION_ID: props.distribution.distributionId,
      },
    });
    this.fn.addEventSource(new SqsEventSource(this.queue, { batchSize: 10 }));

    props.table.grantReadWriteData(this.fn);
    props.siteBucket.grantReadWrite(this.fn);
    props.siteBucket.grantDelete(this.fn);
    props.distribution.grantCreateInvalidation(this.fn);
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:GetInvalidation"],
        resources: [props.distribution.distributionArn],
      }),
    );
  }
}
```

`infra/lib/constructs/api-service.ts`:
```ts
import { join } from "node:path";
import { ArnFormat, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import type { BlogConfig } from "../config";

/** Route keys served by services/api (Plan 1b, Task 8). */
export const API_ROUTES = [
  "GET /posts",
  "POST /posts",
  "GET /posts/{id}",
  "PUT /posts/{id}",
  "DELETE /posts/{id}",
  "PUT /posts/{id}/versions/{lang}",
  "DELETE /posts/{id}/versions/{lang}",
  "POST /posts/{id}/versions/{lang}/publish",
  "POST /posts/{id}/versions/{lang}/unpublish",
  "GET /tags",
  "PUT /tags/{key}",
  "POST /uploads",
  "GET /builds/latest",
  "POST /builds",
] as const;

export interface ApiServiceProps {
  config: BlogConfig;
  zone: route53.IHostedZone;
  table: dynamodb.ITableV2;
  mediaBucket: s3.IBucket;
  buildQueue: sqs.IQueue;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  repoRoot: string;
}

export class ApiService extends Construct {
  readonly fn: NodejsFunction;
  readonly httpApi: apigwv2.HttpApi;
  readonly url: string;

  constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);
    const { config, zone } = props;
    const stack = Stack.of(this);

    const scheduleGroup = new scheduler.ScheduleGroup(this, "PublishSchedules", {
      scheduleGroupName: "blog-publish",
    });

    // The function's own ARN goes into its environment: build it from the fixed name
    // instead of referencing the function (which would be a circular dependency).
    const functionName = "blog-api";
    const functionArn = stack.formatArn({
      service: "lambda",
      resource: "function",
      resourceName: functionName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": stack.account } },
      }),
      description: "EventBridge Scheduler invokes blog-api for scheduled publishing",
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [functionArn, `${functionArn}:*`],
      }),
    );

    this.fn = new NodejsFunction(this, "ApiFunction", {
      functionName,
      entry: join(props.repoRoot, "services/api/src/index.ts"),
      handler: "handler",
      projectRoot: props.repoRoot,
      depsLockFilePath: join(props.repoRoot, "pnpm-lock.yaml"),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      bundling: {
        format: OutputFormat.ESM,
        target: "node24",
        minify: true,
        sourceMap: true,
        mainFields: ["module", "main"],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        TABLE_NAME: props.table.tableName,
        BUILD_QUEUE_URL: props.buildQueue.queueUrl,
        MEDIA_BUCKET: props.mediaBucket.bucketName,
        BLOG_BASE_URL: `https://${config.blogHost}`,
        SCHEDULER_GROUP: scheduleGroup.scheduleGroupName,
        SCHEDULER_TARGET_ARN: functionArn,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });

    props.table.grantReadWriteData(this.fn);
    props.buildQueue.grantSendMessages(this.fn);
    props.mediaBucket.grantPut(this.fn);
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule"],
        resources: [
          stack.formatArn({
            service: "scheduler",
            resource: "schedule",
            resourceName: `${scheduleGroup.scheduleGroupName}/*`,
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );
    schedulerRole.grantPassRole(this.fn.grantPrincipal);

    const certificate = new acm.Certificate(this, "ApiCertificate", {
      domainName: config.apiHost,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    const domainName = new apigwv2.DomainName(this, "ApiDomain", {
      domainName: config.apiHost,
      certificate,
    });

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "blog-api",
      createDefaultStage: false,
      defaultAuthorizer: new HttpUserPoolAuthorizer("Cognito", props.userPool, {
        userPoolClients: [props.userPoolClient],
      }),
      corsPreflight: {
        allowOrigins: [`https://${config.adminHost}`, config.adminDevOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["authorization", "content-type"],
        maxAge: Duration.days(1),
      },
    });
    new apigwv2.HttpStage(this, "DefaultStage", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 20, burstLimit: 40 },
      domainMapping: { domainName },
    });

    const integration = new HttpLambdaIntegration("Api", this.fn);
    for (const routeKey of API_ROUTES) {
      const [method, path] = routeKey.split(" ") as [keyof typeof apigwv2.HttpMethod, string];
      this.httpApi.addRoutes({ path, methods: [apigwv2.HttpMethod[method]], integration });
    }

    new route53.ARecord(this, "ApiA", {
      zone,
      recordName: config.apiHost,
      target: route53.RecordTarget.fromAlias(
        new ApiGatewayv2DomainProperties(domainName.regionalDomainName, domainName.regionalHostedZoneId),
      ),
    });
    this.url = `https://${config.apiHost}`;
  }
}
```

> Nếu `HttpStage` 2.272.0 không có `throttle`, đặt qua `(stage.node.defaultChild as apigwv2.CfnStage).defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 }` và ghi Ruling — test kiểm tra kết quả CloudFormation.

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/infra test && pnpm --filter @blog/infra typecheck`
Expected: PASS (synth có Docker asset → bước staging chép repo trừ `.dockerignore`, mất vài giây); typecheck sạch.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add infra
git commit -m "feat(infra): build pipeline (SQS FIFO + image Lambda) and JWT-protected HTTP API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Giám sát, ghép stack & `config.json` trang quản trị

**Files:**
- Create: `infra/lib/constructs/monitoring.ts`, `infra/lib/blog-stack.ts`, `infra/lib/app.ts`, `infra/bin/blog.ts`
- Test: `infra/test/monitoring.test.ts`, `infra/test/app.test.ts`

**Interfaces:**
- Consumes: Task 1–4.
- Produces:
  - `class Monitoring extends Construct` — props `{ alertEmail: string; apiFn: lambda.IFunction; buildFn: lambda.IFunction; dlq: sqs.IQueue }`
  - `class BlogStack extends Stack` — props `StackProps & { config; certificate: acm.ICertificate; data: DataStack; repoRoot: string }`; outputs `BlogUrl`, `AdminUrl`, `ApiUrl`, `BuildQueueUrl`, `UserPoolId`, `SiteBucketName`
  - `createStacks(app: App, repoRoot: string): { cert: CertStack; data: DataStack; blog: BlogStack }` — stack ID `BlogCert`, `BlogData`, `Blog`
  - `admin.oki-dev.xyz/config.json`: `{ region, apiUrl, userPoolId, userPoolClientId, cognitoDomain, redirectUri }`

- [ ] **Step 1: Viết test thất bại**

`infra/test/monitoring.test.ts`:
```ts
import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { describe, it } from "vitest";
import { Monitoring } from "../lib/constructs/monitoring";
import { testApp } from "./helpers";

const synth = () => {
  const stack = new Stack(testApp(), "Mon", { env: { account: "111111111111", region: "ap-northeast-1" } });
  const fn = (id: string) =>
    new lambda.Function(stack, id, {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => {}"),
    });
  new Monitoring(stack, "Monitoring", {
    alertEmail: "alerts@example.dev",
    apiFn: fn("Api"),
    buildFn: fn("Build"),
    dlq: new sqs.Queue(stack, "Dlq", { fifo: true }),
  });
  return Template.fromStack(stack);
};

describe("Monitoring", () => {
  it("emails alerts through SNS", () => {
    synth().hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "alerts@example.dev",
    });
  });

  it("alarms on a dead-lettered build, API errors and build errors, also notifying recovery", () => {
    const template = synth();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    template.allResourcesProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: [Match.anyValue()],
      OKActions: [Match.anyValue()],
      TreatMissingData: "notBreaching",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateNumberOfMessagesVisible",
      Threshold: 1,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { MetricName: "Errors", Threshold: 5 });
  });

  it("warns when the monthly forecast exceeds 5 USD", () => {
    synth().hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 5, Unit: "USD" }, TimeUnit: "MONTHLY" }),
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: "FORECASTED", Threshold: 100 }),
          Subscribers: [{ SubscriptionType: "EMAIL", Address: "alerts@example.dev" }],
        }),
      ],
    });
  });
});
```

`infra/test/app.test.ts`:
```ts
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { createStacks } from "../lib/app";
import { repoRoot, testApp } from "./helpers";

describe("createStacks", () => {
  it("places the certificate in us-east-1 and the rest in the main region", () => {
    const { cert, data, blog } = createStacks(testApp(), repoRoot);
    expect([cert.stackName, cert.region]).toEqual(["BlogCert", "us-east-1"]);
    expect([data.stackName, data.region]).toEqual(["BlogData", "ap-northeast-1"]);
    expect([blog.stackName, blog.region]).toEqual(["Blog", "ap-northeast-1"]);
    expect(blog.dependencies.map((s) => s.stackName).sort()).toEqual(["BlogCert", "BlogData"]);
  });

  it("synthesizes the whole app without dependency cycles", () => {
    const app = testApp();
    createStacks(app, repoRoot);
    expect(() => app.synth()).not.toThrow();
  });

  it("publishes config.json for the admin and the key outputs", () => {
    const template = Template.fromStack(createStacks(testApp(), repoRoot).blog);
    template.hasResourceProperties("Custom::CDKBucketDeployment", { Prune: false });
    for (const name of ["BlogUrl", "AdminUrl", "ApiUrl", "BuildQueueUrl", "UserPoolId", "SiteBucketName"]) {
      template.hasOutput(name, Match.anyValue());
    }
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/infra exec vitest run test/monitoring.test.ts test/app.test.ts`
Expected: FAIL — không resolve được `monitoring`, `app`.

- [ ] **Step 3: Viết mã**

`infra/lib/constructs/monitoring.ts`:
```ts
import { Duration } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface MonitoringProps {
  alertEmail: string;
  apiFn: lambda.IFunction;
  buildFn: lambda.IFunction;
  dlq: sqs.IQueue;
}

/** Alarms → SNS → email (spec 5.3); Discord was dropped for now. */
export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const topic = new sns.Topic(this, "Alerts", {
      displayName: "oki-dev blog alerts",
      enforceSSL: true,
    });
    topic.addSubscription(new EmailSubscription(props.alertEmail));
    const action = new SnsAction(topic);

    const alarm = (alarmId: string, metric: cloudwatch.IMetric, threshold: number, description: string) =>
      new cloudwatch.Alarm(this, alarmId, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      });

    const alarms = [
      alarm(
        "BuildDeadLettered",
        props.dlq.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(1),
          statistic: "Maximum",
        }),
        1,
        "A build request failed twice and landed in the DLQ",
      ),
      alarm(
        "ApiErrors",
        props.apiFn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
        5,
        "blog-api: 5 or more errors in 5 minutes",
      ),
      alarm(
        "BuildErrors",
        props.buildFn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
        1,
        "blog-build failed",
      ),
    ];
    for (const a of alarms) {
      a.addAlarmAction(action);
      a.addOkAction(action);
    }

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: "oki-dev-blog-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 5, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: "FORECASTED",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
        },
      ],
    });
  }
}
```

`infra/lib/blog-stack.ts`:
```ts
import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import type { BlogConfig } from "./config";
import { ApiService } from "./constructs/api-service";
import { BuildPipeline } from "./constructs/build-pipeline";
import { Monitoring } from "./constructs/monitoring";
import { createMediaBucket, SiteHosting } from "./constructs/site-hosting";
import type { DataStack } from "./data-stack";

const ADMIN_PLACEHOLDER = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>oki-dev admin</title></head>
<body style="font-family:monospace;background:#0d1117;color:#7ee787;padding:2rem">~/oki-dev/admin$ coming soon</body></html>`;

export interface BlogStackProps extends StackProps {
  config: BlogConfig;
  certificate: acm.ICertificate;
  data: DataStack;
  repoRoot: string;
}

export class BlogStack extends Stack {
  constructor(scope: Construct, id: string, props: BlogStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });
    const { config, data } = props;

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.domainName,
    });
    // Lives here (not in BlogData): CloudFront OAC edits its bucket policy, which would
    // otherwise make BlogData depend on Blog and create a cycle.
    const mediaBucket = createMediaBucket(this, "MediaBucket", config);

    const hosting = new SiteHosting(this, "Hosting", {
      config,
      certificate: props.certificate,
      zone,
      mediaBucket,
    });
    const build = new BuildPipeline(this, "Build", {
      table: data.table,
      siteBucket: hosting.siteBucket,
      distribution: hosting.blogDistribution,
      repoRoot: props.repoRoot,
    });
    const api = new ApiService(this, "Api", {
      config,
      zone,
      table: data.table,
      mediaBucket,
      buildQueue: build.queue,
      userPool: data.userPool,
      userPoolClient: data.userPoolClient,
      repoRoot: props.repoRoot,
    });
    new Monitoring(this, "Monitoring", {
      alertEmail: config.alertEmail,
      apiFn: api.fn,
      buildFn: build.fn,
      dlq: build.dlq,
    });

    // Runtime configuration for the admin SPA (Plan 5 adds the app itself next to it).
    new s3deploy.BucketDeployment(this, "AdminConfig", {
      destinationBucket: hosting.adminBucket,
      sources: [
        s3deploy.Source.jsonData("config.json", {
          region: this.region,
          apiUrl: api.url,
          userPoolId: data.userPool.userPoolId,
          userPoolClientId: data.userPoolClient.userPoolClientId,
          cognitoDomain: data.userPoolDomain.baseUrl(),
          redirectUri: `https://${config.adminHost}/`,
        }),
        s3deploy.Source.data("index.html", ADMIN_PLACEHOLDER),
      ],
      distribution: hosting.adminDistribution,
      distributionPaths: ["/config.json", "/index.html"],
      prune: false,
    });

    new CfnOutput(this, "BlogUrl", { value: `https://${config.blogHost}/` });
    new CfnOutput(this, "AdminUrl", { value: `https://${config.adminHost}/` });
    new CfnOutput(this, "ApiUrl", { value: api.url });
    new CfnOutput(this, "BuildQueueUrl", { value: build.queue.queueUrl });
    new CfnOutput(this, "UserPoolId", { value: data.userPool.userPoolId });
    new CfnOutput(this, "SiteBucketName", { value: hosting.siteBucket.bucketName });
  }
}
```

`infra/lib/app.ts`:
```ts
import type { App } from "aws-cdk-lib";
import { BlogStack } from "./blog-stack";
import { CertStack } from "./cert-stack";
import { readConfig } from "./config";
import { DataStack } from "./data-stack";

export function createStacks(app: App, repoRoot: string) {
  const config = readConfig(app);
  const env = { account: config.account, region: config.region };
  const cert = new CertStack(app, "BlogCert", {
    env: { account: config.account, region: "us-east-1" },
    crossRegionReferences: true,
    config,
  });
  const data = new DataStack(app, "BlogData", { env, config });
  const blog = new BlogStack(app, "Blog", {
    env,
    config,
    certificate: cert.certificate,
    data,
    repoRoot,
  });
  return { cert, data, blog };
}
```

`infra/bin/blog.ts`:
```ts
import { resolve } from "node:path";
import { App } from "aws-cdk-lib";
import { createStacks } from "../lib/app";

const app = new App();
createStacks(app, resolve(import.meta.dirname, "../.."));
app.synth();
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/infra test && pnpm --filter @blog/infra typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 5: Synth thật & kiểm tra toàn repo**

Run: `pnpm --filter @blog/infra exec cdk synth --quiet`
Expected: synth 3 stack không lỗi (bundle Lambda API bằng esbuild). Đọc mọi dòng `[Warning]`; cảnh báo nào chỉ ra cấu hình sai thì sửa, còn lại ghi vào ledger.

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: tất cả xanh.

- [ ] **Step 6: Commit**

```bash
git add infra
git commit -m "feat(infra): monitoring, stack wiring, admin config.json and CDK entry point" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy lần đầu & kiểm tra thật

> Mọi lệnh có dấu ⚠️ thay đổi tài khoản AWS thật — **hỏi tác giả trong chat và chờ đồng ý** ngay trước khi chạy, mỗi lệnh một lần hỏi.

**Files:**
- Modify: `infra/cdk.context.json` (nếu CDK tạo ra — commit lại)
- Create: `docs/runbooks/first-deploy.md` (ghi lại các bước + kết quả, để Kế hoạch 6 tự động hoá)

**Interfaces:**
- Produces: hạ tầng chạy thật; output `BuildQueueUrl`, `UserPoolId` dùng ở Kế hoạch 5/6.

- [ ] **Step 1: Kiểm tra danh tính & Docker**

Run: `aws sts get-caller-identity --query Account --output text && docker info --format '{{.ServerVersion}}'`
Expected: `002581114203` và một phiên bản Docker.

- [ ] **Step 2: ⚠️ Bootstrap CDK (2 region)**

Run: `pnpm --filter @blog/infra exec cdk bootstrap aws://002581114203/ap-northeast-1 aws://002581114203/us-east-1`
Expected: `CDKToolkit` ở trạng thái `CREATE_COMPLETE` ở cả hai region.

- [ ] **Step 3: Diff**

Run: `pnpm --filter @blog/infra exec cdk diff --all`
Expected: chỉ có tạo mới (`[+]`). Tóm tắt cho tác giả: số tài nguyên mỗi stack, các quyền IAM mới.

- [ ] **Step 4: ⚠️ Deploy**

Run: `pnpm --filter @blog/infra exec cdk deploy --all --require-approval never --outputs-file cdk-outputs.json`
Expected: `BlogCert`, `BlogData`, `Blog` deploy xong (lần đầu 15–30 phút: chứng chỉ chờ xác thực DNS, CloudFront phân phối, build image x86_64). Thêm `infra/cdk-outputs.json` vào `.gitignore`.
Nếu lỗi: `aws cloudformation describe-events --stack-name <stack> --filters FailedEvents=true` (sự kiện `_FAILED` đầu tiên là nguyên nhân) → systematic-debugging; không dùng `--hotswap`.

- [ ] **Step 5: Xác nhận email SNS**

Nhờ tác giả mở email "AWS Notification - Subscription Confirmation" gửi tới `nguyenleson0002@gmail.com` và bấm **Confirm subscription**.

- [ ] **Step 6: ⚠️ Kích hoạt build đầu tiên**

Run:
```bash
aws sqs send-message --queue-url "$(jq -r '.Blog.BuildQueueUrl' infra/cdk-outputs.json)" --message-group-id site --message-deduplication-id "$(uuidgen)" --message-body '{"reason":"first-deploy"}'
```
Rồi theo dõi: `aws logs tail /aws/lambda/blog-build --follow --since 5m` cho tới `build finished` (hoặc lỗi → systematic-debugging). Kiểm tra trạng thái:
```bash
aws dynamodb get-item --table-name "$(aws cloudformation describe-stack-resources --stack-name BlogData --query "StackResources[?ResourceType=='AWS::DynamoDB::GlobalTable'].PhysicalResourceId" --output text)" --key '{"PK":{"S":"BUILD"},"SK":{"S":"LATEST"}}' --query 'Item.status.S' --output text
```
Expected: `success`.

- [ ] **Step 7: Kiểm tra HTTP thật**

Run:
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://blog.oki-dev.xyz/
curl -s -o /dev/null -w "%{http_code}\n" https://blog.oki-dev.xyz/ja/
curl -s -o /dev/null -w "%{http_code}\n" https://blog.oki-dev.xyz/vi/khong-ton-tai/
curl -s -o /dev/null -w "%{http_code}\n" https://api.oki-dev.xyz/posts
curl -s https://admin.oki-dev.xyz/config.json
curl -sI https://blog.oki-dev.xyz/ | grep -iE "strict-transport-security|x-content-type-options|cache-control"
```
Expected: `200 text/html…`; `200`; `404`; `401`; JSON có `apiUrl: "https://api.oki-dev.xyz"`; có HSTS, `nosniff`, `cache-control: public, max-age=0, must-revalidate`.

- [ ] **Step 8: Tác giả tự tạo tài khoản quản trị**

Đưa cho tác giả lệnh sau để **tự chạy** (Cognito gửi mật khẩu tạm qua email; lần đăng nhập đầu ở Kế hoạch 5 sẽ đổi mật khẩu và đăng ký TOTP):
```bash
aws cognito-idp admin-create-user --user-pool-id "$(jq -r '.Blog.UserPoolId' infra/cdk-outputs.json)" --username <email-của-bạn> --user-attributes Name=email,Value=<email-của-bạn> Name=email_verified,Value=true --desired-delivery-mediums EMAIL
```

- [ ] **Step 9: Runbook & commit**

Viết `docs/runbooks/first-deploy.md`: lệnh đã chạy, thời gian, output chính (không ghi secret), sự cố gặp phải và cách xử lý.

```bash
git add .gitignore infra docs/runbooks
git commit -m "chore(infra): first deploy runbook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Hoàn tất Kế hoạch 4

- `pnpm lint && pnpm typecheck && pnpm test` xanh; `cdk synth` không lỗi.
- `https://blog.oki-dev.xyz/` trả trang (rỗng) của site, `https://api.oki-dev.xyz/posts` trả 401, `https://admin.oki-dev.xyz/config.json` trả cấu hình; build đầu tiên `success`; email cảnh báo đã xác nhận.
- Kế hoạch 5 dùng `config.json` + app client Cognito; Kế hoạch 6 thêm `CiStack` (OIDC) và tự động hoá `cdk deploy` theo runbook.
