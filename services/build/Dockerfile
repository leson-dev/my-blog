# Build context: repository root.
#   docker build --platform linux/amd64 -f services/build/Dockerfile -t blog-build .

FROM --platform=linux/amd64 node:24-bookworm-slim AS deps
WORKDIR /opt/blog
RUN npm install -g pnpm@12.10.1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/api ./services/api
COPY services/build ./services/build
COPY apps/site ./apps/site
# Linux x64 binaries (esbuild, rolldown, pagefind) are installed here, matching the Lambda.
RUN pnpm install --frozen-lockfile --filter "@blog/site..." --filter "@blog/build..."
RUN pnpm --filter @blog/build bundle
# Astro always writes <root>/.astro; the image is read-only at runtime, so point it at /tmp.
RUN ln -s /tmp/astro-dot apps/site/.astro

FROM --platform=linux/amd64 public.ecr.aws/lambda/nodejs:24
# Same path as in the deps stage: pnpm's relative symlinks and Astro's root checks stay valid.
COPY --from=deps /opt/blog /opt/blog
COPY --from=deps /opt/blog/services/build/dist/ ${LAMBDA_TASK_ROOT}/
ENV ASTRO_TELEMETRY_DISABLED=1
CMD ["index.handler"]
