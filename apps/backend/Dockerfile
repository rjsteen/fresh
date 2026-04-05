# Multi-stage production build
FROM elixir:1.17-alpine AS builder

RUN apk add --no-cache build-base git

WORKDIR /app
ENV MIX_ENV=prod

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

COPY config/config.exs config/prod.exs config/runtime.exs config/
COPY lib lib
COPY priv priv

RUN mix compile
RUN mix release --overwrite

# ---------------------------------------------------------------------------
FROM alpine:3.19 AS runtime

RUN apk add --no-cache libstdc++ openssl ncurses-libs

WORKDIR /app

RUN addgroup -S finapp && adduser -S finapp -G finapp
USER finapp

COPY --from=builder --chown=finapp:finapp /app/_build/prod/rel/finapp ./

EXPOSE 4000

ENV RELEASE_DISTRIBUTION=none
ENV RELEASE_NODE=finapp@127.0.0.1

CMD ["./bin/finapp", "start"]
