# gym-manager

헬스장 회원관리 백엔드. NestJS · TypeORM · PostgreSQL.

## 설계 문서

`docs/`는 **Obsidian Vault로 열면** 위키링크와 그래프 뷰가 동작한다.

| 문서 | 내용 |
|------|------|
| [개발 로그](docs/개발%20로그.md) | **여기부터 읽는다.** 현재 진행 상황, 이슈·PR 이력 |
| [도메인 지식](docs/도메인%20지식.md) | 실제 헬스장 운영 방식. 설계의 출발점 |
| [DB 모델링](docs/DB%20모델링.md) | ERD, 테이블 상세, 인덱스 전략 |
| [API 명세](docs/API%20명세.md) | 엔드포인트, 권한 매트릭스, 에러 코드 |
| [기능 명세](docs/기능%20명세.md) | 역할별 기능 정의 |
| [아키텍처](docs/아키텍처.md) | 레이어, 멀티테넌시, 환경 구성 |
| [향후 과제](docs/향후%20과제.md) | 미룬 것들. **트리거와 함께 기록** |
| [트러블슈팅](docs/트러블슈팅.md) | 실제로 겪은 문제와 해결 과정 |
| [학습 노트](docs/학습%20노트.md) | Spring ↔ NestJS 대조, TypeScript·TypeORM |

## ADR

설계 결정과 **선택하지 않은 안**을 함께 기록한다.

| | |
|---|---|
| [001](docs/ADR/ADR-001-db-selection.md) | PostgreSQL 선택 |
| [002](docs/ADR/ADR-002-pk-strategy.md) | PK를 UUID로 |
| [003](docs/ADR/ADR-003-remaining-sessions.md) | PT 잔여 횟수 저장 전략 |
| [004](docs/ADR/ADR-004-multi-tenancy.md) | 행 단위 멀티테넌시 |
| [005](docs/ADR/ADR-005-owner-account-separation.md) | OWNER 공용 운영 계정 |
| [006](docs/ADR/ADR-006-refresh-token-storage.md) | Refresh Token 저장·Rotation |
| [007](docs/ADR/ADR-007-ai-context-management.md) | AI 컨텍스트 3계층 관리 |
| [008](docs/ADR/ADR-008-user-enumeration.md) | 사용자 열거 방지 |
| [009](docs/ADR/ADR-009-login-identifier.md) | `loginId` 기반 로그인 |
| [010](docs/ADR/ADR-010-membership-design.md) | 회원권 설계 — 만료를 저장하지 않는다 |
| [011](docs/ADR/ADR-011-membership-hold.md) | 홀딩(휴회) — 종료일 전체 재계산 |
| [012](docs/ADR/ADR-012-membership-transfer.md) | 양도 — 홀딩 조기 종료 |
| [013](docs/ADR/ADR-013-attendance-qr.md) | QR 출석 — 검증 순서와 재출입 |
| [014](docs/ADR/ADR-014-pt-design.md) | PT — EXCLUDE 제약, 조건부 UPDATE |
| [015](docs/ADR/ADR-015-notification-removal.md) | **알림 제거** — Pull과 Push의 차이 |
| [016](docs/ADR/ADR-016-migration.md) | 마이그레이션 도입 — `synchronize`를 전 환경에서 끈다 |

## 개발

```bash
docker compose up -d              # 개발 DB (5432)
npm run seed                      # SUPER_ADMIN + 테스트 Gym
npm run start:dev                 # http://localhost:3000
                                  # Swagger: /api-docs
```

첫 기동 때 **마이그레이션이 스키마를 만든다.** `synchronize`는 모든 환경에서 꺼져 있다. → ADR-016

### 검증 루프

```bash
npm run lint       # 자동 수정
npm run lint:ci    # 검증만 (0 problems)
npm run build      # 타입 검사 + 컴파일
npm run test:e2e   # E2E (테스트 DB 5433 필요)
```

CI가 PR마다 실행하는 것과 같은 명령이다. → [학습 노트](docs/학습%20노트.md)

### 스키마 변경

**Entity를 고치면 마이그레이션 생성이 의무다.** 잊으면 CI의 `migration:check`가 잡는다.

```bash
npm run migration:generate   # Entity와 현재 DB의 차이로 파일 생성
npm run migration:run        # 미적용 마이그레이션 실행
npm run migration:show       # 적용 현황
npm run migration:check      # 차이가 남아 있으면 종료 코드 1
```

## 브랜치

```
feat/xxx  →  dev  →  main
   PR         PR       ↑
                  운영 배포 시점
```

`dev`가 통합 브랜치, **`main`은 "지금 운영에 떠 있는 것"** 이다.
배포마다 `dev → main` PR과 태그가 남는다. → [아키텍처 7장](docs/아키텍처.md)

`docs/`·`README`·`.github/`는 리뷰할 로직이 없으므로 `dev`에 직접 커밋한다.
