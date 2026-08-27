# ADR-003: PT 잔여 횟수 관리 전략

## 배경

PT 계약(PTContract)의 잔여 횟수(`remainingSessions`)를 어떻게 관리할지 결정해야 했다.
PT 수업이 완료될 때마다 정확한 잔여 횟수가 유지되어야 한다.

## 선택지

**A안 — 컬럼 직접 저장**
- PTContract에 `remainingSessions` 컬럼을 두고 수업 완료 시 직접 차감
- 장점: 조회 빠름, 구현 단순
- 단점: 차감 로직 실패 시 데이터 불일치 가능

**B안 — 매번 집계 계산**
- `remainingSessions = totalSessions - COUNT(PTSchedule WHERE status = COMPLETED)`
- 장점: 항상 정확, 별도 관리 불필요
- 단점: 조회마다 집계 쿼리 발생, 횟수가 많아질수록 성능 저하

## 결정

**A안 채택 + TypeORM QueryRunner 트랜잭션으로 원자적 처리**

## 이유

- 조회 성능 우선 (잔여 횟수는 자주 조회됨)
- 트랜잭션으로 데이터 정합성 문제를 해결할 수 있음
- 실무에서도 일반적으로 사용하는 패턴

## 구현 방식

PT 수업 완료 처리 시 아래 두 작업을 하나의 트랜잭션으로 묶어 원자적으로 처리한다.

```typescript
const queryRunner = dataSource.createQueryRunner();
await queryRunner.connect();
await queryRunner.startTransaction();

try {
  // 1. PTSchedule 상태 COMPLETED로 변경
  await queryRunner.manager.update(PTSchedule, scheduleId, {
    status: PTScheduleStatus.COMPLETED,
  });

  // 2. PTContract 잔여 횟수 차감
  await queryRunner.manager.decrement(
    PTContract,
    { id: contractId },
    'remainingSessions',
    1,
  );

  await queryRunner.commitTransaction();
} catch (error) {
  await queryRunner.rollbackTransaction(); // 하나라도 실패 시 전체 롤백
  throw error;
} finally {
  await queryRunner.release();
}
```

## 결과

- 네트워크 오류, 서버 다운 등 어떤 이유로든 둘 중 하나만 실행되는 상황을 방지
- 항상 `PTSchedule COMPLETED 건수 + remainingSessions = totalSessions` 관계 보장
- 면접 포인트: "데이터 정합성을 트랜잭션으로 보장하고, 실패 시 롤백으로 일관성을 유지했습니다"
