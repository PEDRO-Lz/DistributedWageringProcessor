FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Sem CMD: api e worker rodam a mesma imagem, o comando (main.ts vs
# worker.ts) é decidido pelo `command:` de cada serviço no docker-compose.yml.
