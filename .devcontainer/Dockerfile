# Public dev container image for AgentScript monorepo
# Uses public base image instead of private SFDC registry
FROM node:22-bookworm

# Docker fills this automatically for multi-arch builds
ARG TARGETARCH

USER root

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        python3 \
        python3-pip \
        python3-dev \
        python3-venv \
        cmake \
        gcc \
        g++ \
        make \
        curl \
        openssl \
        libssl-dev \
        pkg-config \
        # Java for agentscript-java package
        openjdk-17-jdk \
        maven \
        # Useful utilities
        jq \
        vim \
        nano \
        less \
        xz-utils \
        tmux \
        locales \
        ncurses-bin \
    && rm -rf /var/lib/apt/lists/*

# Set up locale for unicode support
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

# Install Emscripten SDK (for tree-sitter WASM builds)
RUN git clone https://github.com/emscripten-core/emsdk.git /etc/emsdk && \
    cd /etc/emsdk \
    && ./emsdk install 5.0.1 \
    && ./emsdk activate 5.0.1

ENV EMSDK=/etc/emsdk
ENV PATH="/etc/emsdk:/etc/emsdk/upstream/emscripten:${PATH}"

# Install tree-sitter CLI v0.25.10 (prebuilt binary)
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        ARCH="arm64"; \
    else \
        ARCH="x64"; \
    fi \
    && curl -sSL -o /tmp/tree-sitter.gz "https://github.com/tree-sitter/tree-sitter/releases/download/v0.25.10/tree-sitter-linux-${ARCH}.gz" \
    && gunzip -c /tmp/tree-sitter.gz > /usr/local/bin/tree-sitter \
    && chmod +x /usr/local/bin/tree-sitter \
    && rm /tmp/tree-sitter.gz

# Enable corepack for pnpm
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Python development tools
RUN pip3 install --break-system-packages --no-cache-dir \
    ruff \
    mypy \
    pytest \
    pytest-cov \
    setuptools \
    wheel \
    build \
    tree-sitter

# Java environment
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="$JAVA_HOME/bin:$PATH"

# Fix tree-sitter CLI looking for aarch64-linux-gnu-gcc instead of gcc
ENV CC=gcc

# Terminal unicode support
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV TERM=xterm-256color

# Create workspace directory
RUN mkdir -p /workspace

CMD ["sleep", "infinity"]
