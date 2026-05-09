FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV RESOLUTION=1920x1080x24

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    websockify \
    novnc \
    socat \
    fonts-liberation \
    fonts-noto-color-emoji \
    dbus-x11 \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Profile directory (mounted as volume for persistence)
RUN mkdir -p /data/profile

COPY monitor.html /usr/share/novnc/monitor.html
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9222 6080

ENTRYPOINT ["/entrypoint.sh"]
