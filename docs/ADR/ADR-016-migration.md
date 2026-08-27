# ADR-016: TypeORM 마이그레이션 도입

## 배경

여기까지 스키마는 전부 `synchronize: true`가 만들었다. Entity를 고치면 TypeORM이
DB를 알아서 맞춰주므로 설계가 자주 바뀌는 초기에는 이 편이 빨랐다.

**운영 배포를 결정하면서 그대로 둘 수 없게 됐다.**

```
synchronize: true   →  컬럼 삭제·타입 변경 시 데이터가 조용히 사라진다
synchronize: false  →  스키마가 아예 만들어지지 않는다
```

두 번째가 덜 알려진 함정이다. 끄는 것으로 끝나지 않는다. **테이블을 만들 주체가
사라지므로**, 첫 배포에서 앱은 뜨는데 모든 요청이 `42P01 relation does not exist`로 죽는다.
마이그레이션은 "하면 좋은 것"이 아니라 배포의 **선행 조건**이다.

Spring의 `ddl-auto: create`로만 개발하다가 운영에서 `validate`로 바꾸는 상황과 같다.
Flyway 없이 `validate`로 띄우면 똑같이 죽는다.

---

## 결정 1: 초기 마이그레이션은 **빈 DB**에서 생성한다

`migration:generate`는 "Entity와 **지금 붙은 DB**의 차이"를 뽑는다.
어느 DB에 붙느냐가 결과를 통째로 바꾼다.

| 붙는 DB | 결과 |
|---|---|
| 개발 DB (5432) | 이미 테이블이 다 있음 → **빈 마이그레이션** |
| 테스트 DB (5433) | 마찬가지 + 테스트를 망가뜨릴 위험 |
| **빈 DB (5434, 일회용)** | 아무것도 없음 → **전체 스키마** |

**운영 DB의 첫 배포가 정확히 세 번째 상황이다.** 아무것도 없는 상태에서 시작한다.

### 개발 DB는 이미 "새로 만든 것"과 다르다

검증 중에 드러난 사실이다. 두 스키마를 `pg_dump`로 비교했더니 컬럼 순서가 달랐다.

```
개발 DB:   ... created_at, updated_at, address, birth_date, memo
마이그:    ... address, birth_date, memo, created_at, updated_at
```

`synchronize`가 `ALTER TABLE ADD COLUMN`으로 **뒤에 붙여온 이력**이 그대로 쌓인 것이다.
Entity 중간에 선언해도 DB에는 맨 뒤에 붙는다.

컬럼 순서는 PostgreSQL에서 의미가 없다(TypeORM은 항상 컬럼명을 명시한다).
다만 **개발 DB에서 generate를 돌렸다면 이 차이를 없애려는 이상한 마이그레이션이
나왔을 수 있다.** 빈 DB를 따로 띄운 이유가 여기서 다시 확인됐다.

---

## 결정 2: 확장 설치를 마이그레이션 안으로 옮긴다

`generate`는 **확장을 뽑아내지 못한다.** Entity 메타데이터에 없기 때문이다.
생성된 파일 맨 앞에 손으로 두 줄을 넣었다.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
CREATE EXTENSION IF NOT EXISTS "btree_gist"
```

| 확장 | 없으면 |
|------|--------|
| `uuid-ossp` | 모든 PK 기본값 `uuid_generate_v4()`가 `function does not exist` |
| `btree_gist` | `pt_schedules`의 EXCLUDE가 `uuid has no default operator class for gist` |

**`uuid-ossp`는 하마터면 놓칠 뻔했다.** `btree_gist`만 신경 쓰고 있었는데,
모든 테이블의 PK 기본값이 `uuid_generate_v4()`였다. 첫 줄에서 터졌을 것이다.

이로써 `data-source.factory.ts`는 역할이 끝나 삭제했다.
**확장은 스키마의 일부이므로 스키마를 만드는 곳에 있어야 한다.** → ADR-014에서 옮겨옴

> `EXCLUDE` 제약 자체는 `generate`가 정확히 뽑아냈다.
> `CREATE TABLE` 안에 인라인으로 들어가 순서 문제도 없다.

---

## 결정 3: `synchronize`를 **모든 환경에서** 끈다

개발·테스트에도 예외를 두지 않는다.

켜두면 Entity를 고칠 때 `synchronize`가 알아서 맞춰줘,
**마이그레이션을 만들지 않아도 테스트가 통과한다.**
그러면 운영을 지키려고 만든 장치가 한 번도 검증되지 않는다.

```
운영을 지키려고 만든 것이 정작 검증은 한 번도 안 된다
```

E2E가 마이그레이션이 만든 스키마 위에서 돌면, **매 테스트 실행이 곧 마이그레이션의 증명**이 된다.

**대가**: 이제 Entity를 고칠 때마다 마이그레이션 생성이 의무다.
그 대가를 치를 값어치가 있다고 판단했다.

### 기존 DB는 baseline으로 흡수한다

전환 시점에 두 DB에 이미 테이블이 있었다. `migrationsRun`이 "아직 안 돌았네" 하고
`CREATE TABLE`을 실행하면 `already exists`로 죽는다.

| DB | 처리 | 이유 |
|---|---|---|
| 테스트 (5433) | 컨테이너 삭제 후 재생성 | 볼륨이 없어 잃을 것이 없다 |
| 개발 (5432) | **이력만 심는다(baseline)** | 볼륨이 있어 데이터가 살아있다 |

```sql
INSERT INTO migrations(timestamp, name) VALUES (1787713342862, 'Migration1787713342862')
```

"이 마이그레이션은 이미 적용된 것으로 친다"고 기록만 남기는 방식이다.
**마이그레이션 도입 전부터 존재하던 운영 DB에 쓰는 정석**이고,
개발 DB가 딱 그 상황이었다.

---

## 결정 4: CI가 Entity와 마이그레이션의 어긋남을 잡는다

E2E만으로는 부족하다.

```
Entity에 컬럼 추가  →  마이그레이션 생성 깜빡  →  PR
```

**조회에 쓰이지 않는 컬럼이면 테스트가 전부 통과한다.** 그리고 배포하는 순간 터진다.

```yaml
- name: Migration is up to date
  run: NODE_ENV=test npm run migration:check
```

`--check`는 "마이그레이션을 모두 적용한 DB와 Entity 사이에 아직 차이가 있는가"를 묻고,
있으면 종료 코드 1을 낸다. **사람이 기억할 필요가 없어진다.**

`synchronize`를 코드로 막은 것과 같은 원리다. → [[아키텍처#7. 배포]]

### 실제로 잡는지 확인했다

```
정상                                    → 0
users.memo를 DROP (Entity 수정 흉내)    → 1  ← 필요한 마이그레이션까지 출력
되돌림                                  → 0
```

**항상 0이 아니라는 것을 확인해야 이 단계가 의미를 갖는다.**
통과만 보고 넘어가면 아무것도 검사하지 않는 단계를 CI에 넣어둔 셈이 된다.

---

## 결과

- `npm run migration:generate` `run` `revert` `show` `check`
- 초기 마이그레이션 1건: 테이블 12개 · FK 32개 · 인덱스 · ENUM 11개 · EXCLUDE 1개
- `synchronize` 전 환경 비활성. 스키마는 `migrationsRun`이 만든다
- E2E 187개가 마이그레이션이 만든 스키마 위에서 통과
- CLI용 `data-source.ts`는 앱과 **같은 환경변수 검증 스키마**를 통과시킨다 (ADR-016 이전 #39)

### 남은 것

| 항목 | 트리거 |
|---|---|
| 마이그레이션 롤백 리허설 | 운영 배포 직전. `revert`가 실제로 되돌리는지 확인 |
| 운영 DB 백업 절차 | 운영 배포 직전. 마이그레이션 실패 시 복구 경로 |

→ [[향후 과제]]
