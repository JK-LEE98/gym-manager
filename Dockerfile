# 멀티스테이지 빌드
#
# 빌드에는 TypeScript 컴파일러와 devDependencies가 필요하지만,
# 실행에는 컴파일된 JS와 운영 의존성만 있으면 된다.
# 단계를 나누면 최종 이미지에서 소스코드·빌드 도구·devDependencies가 전부 빠진다.
# 이미지가 작아지고, 공격 표면도 줄어든다.

# ---------- 1단계: 빌드 ----------
FROM node:24-slim AS builder

WORKDIR /app

# package 파일만 먼저 복사한다.
# 소스가 바뀌어도 의존성이 그대로면 이 레이어는 캐시되어 npm ci를 건너뛴다.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ---------- 2단계: 실행 ----------
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# 운영 의존성만 설치한다.
# builder의 node_modules를 복사하지 않고 다시 설치하는 이유:
#   devDependencies가 섞이지 않은 깨끗한 트리를 만들기 위함이다.
#   같은 베이스 이미지를 쓰므로 bcrypt 같은 네이티브 모듈도 동일하게 빌드된다.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 컴파일 결과만 가져온다. 소스(.ts)는 이미지에 포함되지 않는다
COPY --from=builder /app/dist ./dist

# root로 실행하지 않는다. 컨테이너가 뚫려도 권한을 제한하기 위함이다.
# node 이미지에 기본 포함된 비특권 사용자다
USER node

EXPOSE 3000

CMD ["node", "dist/main"]
