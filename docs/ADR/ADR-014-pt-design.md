# ADR-014: PT 계약·예약 설계

## 배경

PT는 이 프로젝트에서 **기술적으로 가장 고민할 것이 많은 영역**이다.
잔여 횟수라는 소모성 자원이 있고, 시간이라는 배타적 자원이 있고, 둘이 한 트랜잭션에서 움직인다.

그런데 도메인을 확인하면서 **처음 세운 전제가 무너졌다.** → [[도메인 지식#9. PT]]

```
처음 가정   네이버 예약처럼 여러 회원이 슬롯을 놓고 경쟁한다
실제        트레이너 ↔ 회원 1:1 전속. 구두로 정한 뒤 트레이너가 등록한다
```

이 차이가 나머지 결정을 전부 바꿨다.

---

## 결정 1: 빈 슬롯을 만들지 않는다

처음에는 "트레이너가 근무 가능 시간을 슬롯으로 열고 회원이 고른다"로 설계했다.
**빈 슬롯을 소비할 화면이 없다는 것을 뒤늦게 확인했다.**

| 용도 | 우리에게 있나 |
|------|-------------|
| 회원이 골라보는 화면 | ❌ 트레이너만 등록한다 |
| 트레이너의 근무시간 확인 | ❌ 본인이 아는 것을 시스템이 알려줄 이유가 없다 |
| 시간 겹침 방지 | ❌ 예약 행만 있어도 검사된다 |
| 가동률 통계 | △ Phase 6, 그것도 추측 |

한 달치 120행을 만들어 대부분 비워두게 된다.
게다가 **개념이 둘이 되면 동기화 문제가 따라온다.**
슬롯을 지웠는데 예약이 붙어 있으면? 예약을 옮겼는데 원래 슬롯은?

**`PTSchedule` 행 하나 = 예약 하나.** `memberId`는 nullable이 아니다.

> 요청하지 않은 "유연성"을 임의로 추가하지 않는다. → CLAUDE.md 1-2
>
> 이 설계는 **"네이버 예약처럼"이라는 초기 프레임의 잔재**였다.
> 도메인이 1:1 전속으로 바뀐 뒤에도 슬롯 개념만 그대로 남아 있었다.

### 선택하지 않은 안 — 회원 선착순 예약

트레이너가 빈 슬롯을 열고 담당 회원들이 선착순으로 잡는 방식.

**선착순이 성립하려면 경쟁 범위가 열려 있어야 한다.**
네이버 예약은 놓쳐도 다른 가게, 다른 시간이 있다. 우리는 다르다.

```
트레이너 A 담당 회원 15명
  └ 이 15명이 A의 시간만 놓고 다툰다
     └ 놓치면 대안이 없다. 다른 트레이너로 갈 수 없다
```

```
유연한 회원   아무 때나 가능 → 빈 시간 아무거나 잡는다
직장인 회원   저녁 7시만 가능 → 매번 이미 차 있다
```

**이것은 버그가 아니라 선착순이라는 규칙의 정상 작동이다.**
예약 횟수 제한이나 시간대 분산 로직을 덧대봐야 규칙을 겹치는 것뿐이다.

트레이너는 15명 전체를 보고 배분하지만 선착순은 각자 자기만 본다.
**전체를 보는 사람이 나누는 편이 실제로 더 공정하다.**

→ 경쟁 범위가 넓어지는 조건(그룹 수업, 트레이너 선택제)이 생기면 재검토. [[향후 과제]]

---

## 결정 2: 시간 겹침은 DB 제약으로 막는다

트레이너가 같은 시간에 두 회원을 잡으면 안 된다.

```sql
ALTER TABLE pt_schedules ADD CONSTRAINT no_trainer_overlap
  EXCLUDE USING gist (
    trainer_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status <> 'CANCELLED');
```

**UNIQUE가 "값이 같으면 거부"라면 EXCLUDE는 "범위가 겹치면 거부"다.**
시간 예약을 위해 만들어진 기능이고, 애플리케이션 코드가 필요 없다.

### 선택하지 않은 안 — 조회 후 판단

```java
// 이전 프로젝트(JabaClass)의 방식
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT s FROM Schedule s WHERE s.startTime < :endTime AND s.endTime > :startTime")
List<Schedule> findConflictSchedules(...)
```

락을 걸고 조회한 뒤 애플리케이션에서 판단한다. **MySQL이면 이것이 최선이다.**
PostgreSQL에는 제약이 있으므로 검사 로직을 코드에 두지 않는다.

> `ADR-001`에서 PostgreSQL을 고른 근거는 JSONB·배열 타입이었다.
> **실제로 값을 뽑아 쓰는 지점이 여기서 나왔다.**

---

## 결정 3: 차감은 확인 버튼으로. 배치 자동 완료는 없다

수업이 끝나면 트레이너가 확인 버튼을 누르고, 그때 잔여 횟수가 차감된다.

**자정에 일괄 완료 처리하는 방식은 채택하지 않는다.**

```
출석   QR이라는 증거가 있다 → 시스템이 안다
PT     증거가 없다          → 시스템이 알 수 없다
```

일괄 처리하면 **하지 않은 수업도 차감된다.** 되돌리려면 사람이 일일이 찾아야 한다.

> `status`에는 사람이 개입한 사실만 담는다.
> `EXPIRED`(ADR-010) · `SUSPENDED`(#22) · 홀딩 자동 종료(ADR-013)에 이어 **네 번째 적용**이다.

### 대신 미확인 목록을 띄운다

```
endAt < now  AND  status = 'SCHEDULED'   →  미확인 목록
```

배치가 아니라 **조회**다. `GET /holds/ending-today`와 같은 패턴이며,
"놓치지 않게 보여주되 사람이 누른다"는 원칙을 유지한다.

### 확인 권한

| 역할 | 권한 |
|------|------|
| TRAINER | 담당 회원의 수업을 완료·노쇼 처리 |
| OWNER | 잘못 처리된 건을 정정 |
| MEMBER | 조회만 |

트레이너도 실적이라는 이해관계가 있으므로 **정정 경로를 데스크에 남긴다.**

---

## 결정 4: 노쇼는 상태와 차감을 분리한다

헬스장마다 정책이 달라 노쇼를 차감할지는 트레이너 재량이다. 사유에 따라서도 달라진다.

```
❌  status: COMPLETED | NO_SHOW | CANCELLED
    → "노쇼였지만 봐준" 경우가 CANCELLED로 뭉개진다
    → 이 회원이 노쇼를 몇 번 했는지 셀 수 없다

✅  status           COMPLETED | NO_SHOW | CANCELLED
    sessionDeducted  BOOLEAN
```

| 조합 | 상황 |
|------|------|
| `NO_SHOW` + 차감 | 규정대로 처리 |
| `NO_SHOW` + 미차감 | 사정을 봐줬다. **노쇼 이력은 남는다** |
| `CANCELLED` + 미차감 | 사전 취소 또는 트레이너 사정 |

**"무슨 일이 있었나"와 "횟수를 깎았나"는 다른 사실이다.**
붙여두면 "노쇼 3회 이상 경고" 같은 기능을 나중에 만들 수 없다.

---

## 결정 5: 동시성은 조건부 UPDATE로 푼다

1:1 전속 + 트레이너 등록 구조라 **여러 회원이 한 시간을 다투는 경합은 발생하지 않는다.**
실제 위험은 다른 곳에 있다.

```
① 트레이너 일정 겹침        → EXCLUDE 제약 (결정 2)
② 완료 버튼 중복 클릭       → 2회 차감
③ 잔여 0인데 예약·완료 처리
```

②③을 조건부 UPDATE로 막는다.

```sql
-- 완료 확정: 이미 처리된 건이면 affected = 0
UPDATE pt_schedules
   SET status = 'COMPLETED', session_deducted = true
 WHERE id = :id AND status = 'SCHEDULED';

-- 잔여 차감: 0이면 affected = 0
UPDATE pt_contracts
   SET remaining_sessions = remaining_sessions - 1
 WHERE id = :contractId AND remaining_sessions > 0;
```

둘을 한 트랜잭션에 넣고 **affected rows가 0이면 롤백한다.**

**락도 재시도도 필요 없다.**

```
UPDATE는 실행되는 순간 그 행에 배타 락을 잡고,
락을 잡은 뒤에 WHERE 조건을 다시 평가한다.

  A: UPDATE … WHERE status='SCHEDULED'  → 락 획득, 조건 참  → 1 row
  B: UPDATE … WHERE status='SCHEDULED'  → A 커밋 대기 → 재평가 → 거짓 → 0 row
```

`SELECT`로 확인하고 `UPDATE`하면 그 사이가 비지만, **조건을 UPDATE 안에 넣으면 틈이 없다.**

### 선택하지 않은 안

| 방식 | 왜 아닌가 |
|------|----------|
| 비관적 락 | 읽고→계산하고→쓰는 과정이 길 때 쓴다. 우리는 조건이 SQL로 표현된다 |
| 낙관적 락(`@Version`) | 충돌이 드물 때 유효하나 재시도 로직이 따라온다. `remaining - 1`은 조건부 UPDATE로 충분하다 |
| Redis 분산 락 | **DB 락이 이미 분산 락이다.** 여러 인스턴스가 같은 DB를 본다 |
| Kafka / Outbox | 메시지 발행이 없다. 단일 DB라 원자성 문제가 발생하지 않는다 |
| Redis 대기열(SortedSet) | 초당 수만 요청을 흡수하는 장치다. 우리는 초당 몇 건이다 |

> **이전 프로젝트(JabaClass)와의 차이가 여기서 갈린다.**
> 그쪽은 MSA라 재고·예치금·주문이 서로 다른 DB에 있었고,
> 한 트랜잭션으로 묶을 수 없어 Outbox + Kafka + 보상 트랜잭션이 필요했다.
> **gym-manager는 모놀리식 단일 DB다. 그 도구들이 푸는 문제 자체가 없다.**
>
> 흥미로운 점은, JabaClass도 재고 차감만은 **조건부 UPDATE**로 풀었다는 것이다.
> (문서에는 "비관적 락"으로 적혀 있으나 실제 코드는 `UPDATE … WHERE capacity >= :quantity`)

---

## 결정 6: 잔여 횟수는 계속 컬럼에 저장한다 (ADR-003 유지)

`remainingSessions`를 저장하지 않고 매번 집계하는 방법도 있다.

```
remainingSessions = totalSessions - COUNT(session_deducted = true)
```

**계산이 항상 정확하다는 점에서 `EXPIRED`·`SUSPENDED`를 두지 않은 판단과 같은 방향이다.**
그럼에도 저장을 유지하는 이유는 **조건부 UPDATE의 대상이 필요하기 때문**이다.

```sql
UPDATE … SET remaining = remaining - 1 WHERE remaining > 0
```

집계값으로는 이 원자적 검사를 걸 수 없다. 세고 나서 판단하는 사이가 비어 있다.

**대신 저장값과 이력이 어긋날 위험을 떠안는다.** 검증 배치로 대응한다. → [[향후 과제]]

```
저장값   PTContract.remainingSessions
계산값   totalSessions - COUNT(session_deducted = true)
         둘이 다르면 알림. 자동 보정은 하지 않는다
```

자동 보정하지 않는 이유: **어느 쪽이 진실인지 기계가 판단할 수 없다.**

---

## 스키마

```
PTContract
  memberId          FK → User
  trainerId         FK → User      1:1 전속. 계약 시 배정
  paymentId         FK → Payment   계약이 곧 결제다
  totalSessions     INT
  remainingSessions INT            조건부 UPDATE 대상
  startDate / endDate
  status            ACTIVE | COMPLETED | CANCELLED

PTSchedule                         행 하나 = 예약 하나
  contractId        FK → PTContract
  trainerId / memberId
  startAt / endAt   TIMESTAMPTZ
  status            SCHEDULED | COMPLETED | NO_SHOW | CANCELLED
  sessionDeducted   BOOLEAN
  confirmedByUserId FK → User      누가 확정했나
  memo

  EXCLUDE (trainer_id =, tstzrange(start_at, end_at) &&) WHERE status <> 'CANCELLED'
```

---

## 결과

**얻는 것**

- 시간 겹침을 애플리케이션 코드 없이 DB가 보장한다
- 잠금·재시도 없이 정합성이 유지된다
- 노쇼 이력과 차감 여부가 분리되어 나중에 정책을 얹을 수 있다

**감수하는 것**

- 회원이 직접 예약할 수 없다. 트레이너를 거쳐야 한다
- `remainingSessions` 저장값이 이력과 어긋날 수 있다 (검증 배치로 대응)
- 트레이너 근무 가능 시간 개념이 없어 새벽 예약도 등록된다.
  **막으면 특별 시간대 수업 같은 예외를 못 하게 되므로 열어둔다**

**미룬 것** → [[향후 과제]]

- 트레이너 변경
- 회원 셀프 예약
- 잔여 횟수 정합성 검증 배치
- 당일 취소 위약 정책
