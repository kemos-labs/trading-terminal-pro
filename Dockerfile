# Full-stack image: SPA + Fastify API (yfinance) + MacroVol rates — one public URL.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    gfortran \
    libopenblas-dev \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python: yfinance (equity chains) + MacroVol (rates/FRED)
# Hashed, fully resolved lock is the production dependency authority.
COPY macrovol-api/requirements.lock /tmp/macrovol-requirements.lock
RUN pip3 install --no-cache-dir --break-system-packages --require-hashes \
    -r /tmp/macrovol-requirements.lock \
    && python3 -c "import yfinance, fastapi, uvicorn; print('python ok')"

# Node deps (cached layer)
COPY package.json package-lock.json* ./
RUN npm install

# App source + production build
COPY . .
RUN npm run build \
    && chmod +x scripts/start-production.sh

ENV NODE_ENV=production \
    MACROVOL_API_URL=http://127.0.0.1:8765 \
    PORT=3001

EXPOSE 3001

# Platforms (Render/Railway/Fly) inject PORT; start script honors it.
CMD ["bash", "scripts/start-production.sh"]
