FROM apify/actor-node:22 AS builder

COPY --chown=myuser:myuser package*.json ./
RUN npm install --include=dev --audit=false

COPY --chown=myuser:myuser . ./
RUN npm run build

FROM apify/actor-node:22

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && node --version \
    && npm --version \
    && rm -rf ~/.npm

COPY --from=builder --chown=myuser:myuser /usr/src/app/dist ./dist
COPY --chown=myuser:myuser . ./

# Cap V8 heap at ~60% of the run memory so GC kicks in before the container hits its cgroup limit.
CMD ["sh", "-c", "exec node --max-old-space-size=$(( ${ACTOR_MEMORY_MBYTES:-256} * 6 / 10 )) dist/main.js"]
