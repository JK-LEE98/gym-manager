# ADR-001: 데이터베이스 선택 — PostgreSQL

## 배경

헬스장 회원관리 서비스의 주 DB를 선택해야 했다.
개발자는 H2, MariaDB, PostgreSQL 사용 경험이 있으며 특정 이유 없이 사용해왔다.
이번에는 서비스 특성에 맞는 기술적 근거를 기반으로 결정했다.

## 선택지

| | MariaDB | PostgreSQL |
|---|---------|------------|
| JSON 지원 | 제한적 | 강력 (JSONB) |
| 복잡한 쿼리 | 보통 | 우수 |
| TypeORM 궁합 | 좋음 | 매우 좋음 |
| 통계/집계 | 보통 | 우수 (Window Function 등) |
| 커뮤니티/자료 | 많음 | 많음 |

## 결정

**PostgreSQL** 선택

## 이유

- 통계 API (월별 매출, 출석률 등) 구현 시 Window Function, 집계 함수 활용 가능
- TypeORM과의 궁합이 검증되어 있고 레퍼런스가 풍부함
- 추후 채팅 로그나 유연한 데이터 구조 추가 시 JSONB 활용 가능
- 초기 서비스 규모에서 MariaDB 대비 성능 차이 없음

## 결과

- Docker로 로컬 개발 환경 구성
- TypeORM 엔티티 기반 스키마 관리
- 운영 환경에서도 동일하게 PostgreSQL 사용
