FROM node:24-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile

COPY . .

EXPOSE 8787

# wrangler dev --local 不会读取容器环境变量，启动时将其写入 .dev.vars 注入 Worker env；
# 未配置时删除残留文件，保证 TouchGal 处于“未配置即跳过”状态
CMD ["sh", "-c", "if [ -n \"$TOUCHGAL_API_TOKEN\" ]; then printf 'TOUCHGAL_API_TOKEN=%s\\n' \"$TOUCHGAL_API_TOKEN\" > .dev.vars; else rm -f .dev.vars; fi; exec pnpm exec wrangler dev --local --ip 0.0.0.0 --port 8787"]
