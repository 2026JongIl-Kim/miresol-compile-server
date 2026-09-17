# 컴파일 전용 서버(server.js)를 클라우드에 배포하기 위한 Dockerfile
# Render, Railway, Fly.io 등 "GitHub 리포 연결하면 자동 빌드+배포"해주는
# 플랫폼에서 이 Dockerfile을 그대로 인식해서 빌드합니다.

FROM node:18-slim

# arduino-cli 설치
# 주의: 공식 install.sh 스크립트는 내부적으로 GitHub API를 호출해서 최신 버전을 확인하는데,
# 일부 클라우드 빌드 환경(Render 등)에서 그 호출이 막혀 실패하는 경우가 있음.
# 그래서 install.sh 대신, 특정 버전을 아두이노 공식 다운로드 서버에서 직접 받아 설치함.
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL -o /tmp/arduino-cli.tar.gz \
      https://downloads.arduino.cc/arduino-cli/arduino-cli_1.5.1_Linux_64bit.tar.gz && \
    tar -xzf /tmp/arduino-cli.tar.gz -C /usr/local/bin arduino-cli && \
    chmod +x /usr/local/bin/arduino-cli && \
    rm /tmp/arduino-cli.tar.gz && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 먼저 설치 (캐시 활용을 위해 package.json만 먼저 복사)
COPY package*.json ./
RUN npm install --omit=dev

# 나머지 파일 복사
COPY server.js ./
COPY index.html ./

# 아두이노 우노(AVR) 코어를 이미지 빌드 시점에 미리 설치
# → 매 컴파일 요청마다 다운로드하지 않아 훨씬 빠르고, 오프라인에서도 컴파일 가능
RUN arduino-cli core update-index && arduino-cli core install arduino:avr

# 플랫폼이 PORT 환경변수로 실제 포트를 알려주므로 EXPOSE는 참고용
EXPOSE 3000

CMD ["node", "server.js"]
