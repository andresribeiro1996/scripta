# Scripta API.
#
# Pinned to an exact Node 22 minor on purpose: this app reads its data
# through `node:sqlite`, which is still flagged experimental, so a silent
# base-image bump is a bump to the database layer. Change this
# deliberately, and run the test suite when you do.
#
# Three stages so the runtime image carries no compiler, no dev
# dependencies and no source. `sharp` ships platform-specific native
# binaries, which is why production dependencies are installed in their
# own stage on this same base rather than copied from the build stage or
# from a developer's machine — the binaries then match the platform that
# actually runs them.
ARG NODE_VERSION=22.22.2

# --- dependencies actually shipped -------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- compile -----------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
# `tsc` compiles .ts and copies nothing else, but every module reads its
# schema.sql from disk at runtime — scripts/copy-assets.mjs mirrors those
# into dist/ and fails the build if it finds none, so an unbootable image
# can't be produced silently.
RUN npm run build

# --- runtime -----------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Every managed host puts a proxy in front of this. Without it request.ip
# is the proxy's address for everyone and all four rate limiters collapse
# into one shared bucket — see src/config/env.ts. Override to a specific
# IP/CIDR list if you want to be stricter than "trust the proxy in front".
ENV TRUST_PROXY=true
ENV PORT=3000

# The five SQLite files and the two blob directories live here. Mount a
# persistent volume at /data or the account data is gone with the
# container.
#
# These are the fallbacks. Set DATABASE_URL and S3_BUCKET and the library
# module and both blob stores move off local disk entirely — at which
# point the container is stateless and needs no volume at all. Until BOTH
# are set, it does.
ENV AUTH_DB_PATH=/data/auth.sqlite \
    LIBRARY_DB_PATH=/data/library.sqlite \
    GALLERY_DB_PATH=/data/gallery.sqlite \
    COVERS_DB_PATH=/data/covers.sqlite \
    SOCIALS_DB_PATH=/data/socials.sqlite \
    GALLERY_STORAGE_PATH=/data/gallery-files \
    COVERS_STORAGE_PATH=/data/covers-files

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# The `node` user ships with the base image. Running as root would let a
# compromise in an image-processing path (sharp decodes whatever users
# upload) write anywhere in the container.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 3000

# Uses the app's own /health route rather than shelling out to curl, which
# isn't in this base image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
