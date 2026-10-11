# oki-dev blog

Personal serverless blog: **https://blog.oki-dev.xyz** (Vietnamese / Japanese).

- `apps/site` — Astro static site (built by a Lambda after each publish)
- `apps/admin` — React admin at `admin.oki-dev.xyz` (Cognito login, Markdown editor)
- `services/api` — HTTP API (Lambda, DynamoDB), `services/build` — site build Lambda (container)
- `packages/*` — shared types, Markdown pipeline, design tokens
- `infra` — AWS CDK (Tokyo + us-east-1 certificate), `e2e` — read-only checks against production

## Develop

```bash
pnpm install
pnpm test        # every package
pnpm lint && pnpm typecheck
pnpm --filter @blog/site dev
pnpm --filter @blog/admin dev:config && pnpm --filter @blog/admin dev
```

## Ship

`main` only accepts pull requests (squash, CI must pass). Merging deploys to production through GitHub Actions (OIDC, no stored keys), rebuilds the site and runs the read-only E2E checks. See `docs/runbooks/first-deploy.md`.
