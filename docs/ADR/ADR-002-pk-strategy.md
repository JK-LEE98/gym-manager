# ADR-002: PK 전략 — UUID

## 배경

Entity의 PK 타입을 결정해야 했다.
일반적으로 BigInt(Auto Increment)와 UUID 두 가지가 사용된다.

## 선택지

| | BigInt (Auto Increment) | UUID |
|---|------------------------|------|
| 성능 | 인덱스 효율 높음 | 약간 낮음 (랜덤성) |
| 보안 | ID 순서 추측 가능 | 추측 불가 |
| 분산 환경 | 충돌 가능 | 충돌 없음 |
| 가독성 | 높음 | 낮음 |

## 결정

**UUID** 선택

## 이유

- 회원 ID, 계약 ID 등이 API 응답에 노출되는 구조에서 순차 ID는 열거 공격(Enumeration Attack)에 취약
  - 예: `/users/1`, `/users/2` → 전체 회원 정보 순차 조회 가능
- 이 서비스 규모에서 UUID 인덱스 성능 차이는 무시 가능한 수준
- TypeORM에서 `@PrimaryGeneratedColumn('uuid')` 로 간단하게 적용 가능

## 결과

- 모든 Entity에 `@PrimaryGeneratedColumn('uuid')` 적용
- API 응답에서 UUID가 노출되어도 순서 예측 불가
