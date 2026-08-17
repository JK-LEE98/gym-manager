# API 명세 — gym-manager

> 작성일: 2026-07-27
> 관련 문서: [[기능 명세]], [[DB 모델링]], ADR-004(멀티테넌시), ADR-005(OWNER 계정)

---

## 공통 규약

### Base URL
```
http://localhost:3000
```

### 응답 포맷

**성공**
```json
{
  "success": true,
  "data": { },
  "message": "요청이 처리되었습니다"
}
```

**실패**
```json
{
  "success": false,
  "data": null,
  "message": "회원권이 만료되었습니다",
  "errorCode": "MEMBERSHIP_EXPIRED"
}
```

### 인증
```
Authorization: Bearer {accessToken}
```

### 공통 에러 코드

| HTTP | errorCode | 설명 |
|------|-----------|------|
| 400 | VALIDATION_FAILED | DTO 검증 실패 |
| 401 | UNAUTHORIZED | 토큰 없음/만료/유효하지 않음 |
| 403 | FORBIDDEN | 권한 부족 |
| 403 | TENANT_MISMATCH | 다른 헬스장의 리소스 접근 시도 |
| 404 | NOT_FOUND | 리소스 없음 |
| 409 | DUPLICATE_LOGIN_ID | 아이디 중복 |
| 401 | INVALID_CREDENTIALS | 로그인 실패 (아이디·비밀번호 구분하지 않음) |
| 401 | QR_TOKEN_EXPIRED | QR 토큰 만료 (30초) |
| 401 | INVALID_TOKEN_TYPE | Access Token을 QR로 제출 |
| 403 | MEMBERSHIP_ON_HOLD | 휴회 중 입장 시도 |
| 403 | NO_ACTIVE_MEMBERSHIP | 유효한 회원권 없음 |
| 409 | DAILY_ENTRY_LIMIT_EXCEEDED | 하루 입장 횟수 초과 |
| 400 | INVALID_TRAINER | role=TRAINER가 아닌 계정 지정 |
| 409 | SCHEDULE_OVERLAPPED | 트레이너 일정 겹침 (EXCLUDE 제약 위반) |
| 409 | ALREADY_CONFIRMED | 이미 완료·노쇼 처리된 수업 |
| 409 | NO_REMAINING_SESSIONS | PT 잔여 횟수 없음 |

### 페이지네이션 (목록 API 공통)

**요청**: `?page=1&limit=20`

**응답**
```json
{
  "success": true,
  "data": {
    "items": [],
    "total": 137,
    "page": 1,
    "limit": 20,
    "totalPages": 7
  }
}
```

### 테넌트 격리 원칙

SUPER_ADMIN을 제외한 모든 요청은 **토큰의 `gymId` 범위 안에서만** 동작한다.
클라이언트가 `gymId`를 body/query로 보내도 무시하고, 토큰 값을 신뢰한다.
(클라이언트가 보낸 `gymId`를 신뢰하면 다른 헬스장 데이터 접근이 가능해짐)

---

## 권한 매트릭스

| 모듈 | SUPER_ADMIN | OWNER | TRAINER | MEMBER |
|------|:-----------:|:-----:|:-------:|:------:|
| 헬스장 관리 | O | 본인 헬스장 조회만 | - | - |
| 회원 등록/관리 | - | O | - | - |
| 역할 변경 | - | O | - | - |
| 회원권 종류 설정 | - | O | - | - |
| 회원권 부여/연장/취소 | - | O | - | - |
| 회원권 조회 | - | 전체 | - | 본인 |
| 홀딩 등록/수정/취소 | - | 전체·소급 가능 | - | 본인·미래만 |
| 홀딩 현황 조회 | - | O | - | - |
| 회원권 양도 | - | O | - | - |
| QR 토큰 발급 | - | - | - | 본인 |
| 출석 체크(스캔) | - | O | - | - |
| 수동 출석 처리 | - | O | - | - |
| 출석 이력 조회 | - | 전체 | - | 본인 |
| 헬스장 출입 정책 설정 | - | O | - | - |
| PT 계약 등록 | - | O | - | - |
| PT 예약 등록/이동 | - | - | 담당 회원 | - |
| PT 예약 취소 | - | O | 담당 회원 | 본인 |
| PT 완료·노쇼 처리 | - | 정정 | 담당 회원 | - |
| 통계 | 전체 헬스장 | 본인 헬스장 | - | - |

---

## 1. Auth `/auth`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| POST | `/auth/signup` | 공개 | MEMBER 회원가입 |
| POST | `/auth/login` | 공개 | 로그인 |
| POST | `/auth/refresh` | 공개(Refresh Token) | Access Token 재발급 |
| POST | `/auth/logout` | 인증 | 로그아웃 |
| GET | `/auth/me` | 인증 | 내 정보 조회 |

### POST /auth/signup

회원가입은 **MEMBER만 가능**하다. TRAINER는 MEMBER로 가입 후 OWNER가 승격시킨다.
OWNER는 SUPER_ADMIN이 헬스장 등록 시 발급한다.

**Request**
```json
{
  "gymId": "uuid",
  "loginId": "hong_gd",
  "password": "password1234",
  "name": "홍길동",
  "phone": "010-1234-5678"
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "loginId": "hong_gd",
    "name": "홍길동",
    "role": "MEMBER",
    "gymId": "uuid"
  },
  "message": "회원가입이 완료되었습니다"
}
```

**검증 규칙**
- `loginId`: 4~20자, 영문 소문자·숫자·`_`만 허용, 전역 유니크
- `password`: 최소 8자
- `gymId`: 존재하고 `isActive=true`인 헬스장

**에러**
| HTTP | errorCode | 조건 |
|------|-----------|------|
| 409 | DUPLICATE_LOGIN_ID | 이미 사용 중인 아이디 |
| 404 | GYM_NOT_FOUND | 존재하지 않는 헬스장 |
| 403 | GYM_INACTIVE | 비활성 헬스장 |

> 중복 아이디를 명확히 안내하는 것은 열거 위험을 인지한 **의도적 선택**이다. → ADR-008

### POST /auth/login

**Request**
```json
{ "loginId": "hong_gd", "password": "password1234" }
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": {
      "id": "uuid",
      "name": "홍길동",
      "role": "MEMBER",
      "gymId": "uuid"
    }
  }
}
```

**실패 시** — 아이디가 없든 비밀번호가 틀리든 **동일하게 응답**한다. → ADR-008

```json
{
  "success": false,
  "data": null,
  "message": "아이디 또는 비밀번호가 올바르지 않습니다",
  "errorCode": "INVALID_CREDENTIALS"
}
```

> **타이밍 보정**: 유저를 찾지 못한 경우에도 더미 해시와 bcrypt 비교를 수행한다.
> 즉시 반환하면 해싱 소요 시간 차이로 계정 존재 여부가 드러난다.

**JWT Payload**
```json
{ "sub": "userId", "role": "MEMBER", "gymId": "uuid" }
```
> `gymId`를 payload에 담아 매 요청마다 DB 조회 없이 테넌트를 식별한다.

### POST /auth/refresh

**Request**
```json
{ "refreshToken": "eyJ..." }
```

**Response `200`** — 새 Access/Refresh Token 쌍 발급 (Rotation)

**처리 순서** → ADR-006
1. 제출된 토큰을 SHA-256 해시 → `RefreshToken.tokenHash`로 단일 조회
2. row 없음 → `401 INVALID_REFRESH_TOKEN`
3. `revokedAt != null` → **재사용 공격으로 판단.** 해당 userId의 모든 토큰 폐기 후 `401 TOKEN_REUSE_DETECTED`
4. `expiresAt < now` → `401 REFRESH_TOKEN_EXPIRED`
5. 기존 row에 `revokedAt = now` 표시 (삭제하지 않음)
6. 새 RefreshToken row 생성 + 새 Access Token 발급

### POST /auth/logout

**Request** (선택)
```json
{ "allDevices": false }
```

- `false`(기본): 현재 기기의 RefreshToken만 폐기
- `true`: 해당 유저의 모든 RefreshToken 폐기

Response `204`.

> 비밀번호 변경 시에는 `allDevices: true`와 동일하게 전체 폐기한다.

---

## 2. Gyms `/gyms`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/gyms/public` | 공개 | 가입용 헬스장 목록 (id, name, address만) |
| POST | `/gyms` | SUPER_ADMIN | 헬스장 등록 + OWNER 계정 동시 발급 |
| GET | `/gyms` | SUPER_ADMIN | 전체 헬스장 목록 |
| GET | `/gyms/:id` | SUPER_ADMIN, OWNER(본인) | 헬스장 상세 |
| PATCH | `/gyms/:id` | SUPER_ADMIN, OWNER(본인) | 정보 수정 |
| PATCH | `/gyms/:id/deactivate` | SUPER_ADMIN | 비활성화 (구독 해지) |

### GET /gyms/public

회원가입 시 `gymId`가 필요하므로, 가입 전에 헬스장을 선택할 수 있어야 한다.
민감 정보를 제외한 최소 필드만 노출한다.

**Response `200`**
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "name": "강남 피트니스", "address": "서울시 강남구..." }
  ]
}
```

### POST /gyms

헬스장 등록과 OWNER 계정 발급을 **하나의 트랜잭션**으로 처리한다.
헬스장만 만들어지고 계정이 없는 상태를 방지하기 위함이다.

**Request**
```json
{
  "name": "강남 피트니스",
  "address": "서울시 강남구 테헤란로 123",
  "phone": "02-1234-5678",
  "ownerLoginId": "gangnam_gym",
  "ownerPassword": "initial1234",
  "ownerName": "강남점 운영계정"
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "gym": { "id": "uuid", "name": "강남 피트니스" },
    "owner": { "id": "uuid", "loginId": "gangnam_gym", "role": "OWNER" }
  }
}
```

---

## 3. Users `/users`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| POST | `/users` | OWNER | 회원 직접 등록 (프론트 데스크) |
| GET | `/users` | OWNER | 회원 목록 + 검색/필터 |
| GET | `/users/:id` | OWNER | 회원 상세 |
| PATCH | `/users/:id` | OWNER | 이름/전화번호 수정 |
| PATCH | `/users/:id/role` | OWNER | 역할 변경 |
| PATCH | `/users/:id/reset-password` | OWNER, SUPER_ADMIN | 비밀번호 초기화 |
| PATCH | `/users/me` | 인증 | 본인 정보 수정 |
| PATCH | `/users/me/password` | 인증 | 본인 비밀번호 변경 |
| DELETE | `/users/:id` | OWNER | 회원 삭제 (soft delete) |

### GET /users

**Query Parameters**

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `name` | string | 이름 부분 검색 |
| `role` | enum | OWNER \| TRAINER \| MEMBER |
| `membershipStatus` | enum | ACTIVE \| EXPIRED \| NONE |
| `category` | string | 아래 만료 필터의 대상 카테고리 (`헬스` `락커` …) |
| `expiringInDays` | number | **정확히** N일 남은 회원 |
| `expiredWithinDays` | number | N일 **이내에** 만료된 회원 |
| `startedWithinDays` | number | 운동을 시작한 지 N일 이내인 회원 |
| `page`, `limit` | number | 페이지네이션 |

**만료 연락 대상 뽑기**

```
GET /users?category=헬스&expiringInDays=3       D-3 알림 문자 대상
GET /users?category=헬스&expiredWithinDays=30   복귀 홍보 대상
GET /users?startedWithinDays=7                  쿠폰·만족도 조사 대상
```

> **`expiringInDays`가 범위가 아니라 정확값인 것이 핵심이다.**
>
> ```
> ❌ 7일 이내     D-7·D-5·D-3이 섞인다 → 매일 돌리면 한 사람에게 문자가 여러 번
> ✅ 정확히 3일   오늘 D-3인 사람만    → 매일 돌려도 한 사람당 한 번
> ```
>
> 중복 발송 방지가 이 기능의 존재 이유다. 범위로 만들면 쓸 수 없다.
> 반대로 복귀 홍보(`expiredWithinDays`)는 "지난 30일 전부"가 자연스러워 범위가 맞다. → ADR-015

> **`category`가 필요한 이유**: 헬스가 D-3인데 락커가 D-95면
> 가장 늦은 종료일로 뭉쳤을 때 임박 목록에서 빠진다.
> 같은 카테고리를 여러 건 보유(이어붙이기)한 경우 **그 카테고리의 가장 늦은 `endDate`** 를 본다.

> **응답에 이름·전화번호가 이미 있어 별도 엔드포인트를 만들지 않았다.**
> 새로 파면 페이지네이션·검색·정렬을 다시 구현해야 한다.

> **문자 발송은 범위 밖이다.** 우리는 대상 목록까지 만든다. → [[향후 과제]]

**Response `200`**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "홍길동",
        "phone": "010-1234-5678",
        "role": "MEMBER",
        "memberships": [
          {
            "category": "헬스",
            "typeName": "헬스 12개월",
            "startDate": "2026-08-01",
            "endDate": "2027-07-31",
            "daysUntilExpiry": 358,
            "status": "ACTIVE"
          }
        ]
      }
    ],
    "total": 137, "page": 1, "limit": 20, "totalPages": 7
  }
}
```

> **배열이다.** 헬스 + 락커처럼 동시 보유가 흔하다.
> **만료된 것은 제외**한다. 전체 이력은 `GET /memberships?userId=`로 조회한다.

> **N+1 주의**: 회원 목록에 회원권 정보를 함께 노출하므로,
> `QueryBuilder`로 `leftJoinAndSelect` 하여 단일 쿼리로 조회한다.

### PATCH /users/:id/role

MEMBER를 TRAINER로 승격하거나 되돌린다.
**TRAINER로 승격 시 `TrainerProfile`을 같은 트랜잭션에서 자동 생성**한다.

**Request**
```json
{ "role": "TRAINER" }
```

**제약**
- OWNER로의 변경 불가 (OWNER는 SUPER_ADMIN만 발급)
- TRAINER → MEMBER 강등 시, 진행 중인 `PTContract`가 있으면 `409 TRAINER_HAS_ACTIVE_CONTRACT`

### PATCH /users/:id/reset-password

비밀번호 분실 시 **상위 역할이 초기화**한다. 셀프 복구 수단이 없는 구조를 보완한다. → ADR-009

```
MEMBER / TRAINER  분실 → OWNER가 초기화
OWNER             분실 → SUPER_ADMIN이 초기화
SUPER_ADMIN       분실 → DB 직접 수정 / 스크립트
```

**권한 범위**

| 요청자 | 대상 |
|--------|------|
| OWNER | 자기 헬스장의 MEMBER / TRAINER만 |
| SUPER_ADMIN | 제한 없음 (OWNER 포함) |

**Request** — 본문 없음

**Response `200`**
```json
{
  "success": true,
  "data": { "temporaryPassword": "Gx7k2mQp" },
  "message": "비밀번호가 초기화되었습니다"
}
```

> **임시 비밀번호는 서버가 생성**한다. 관리자가 직접 입력하게 하면 `1234` 같은 값을 넣게 된다.
> 응답에 **1회만** 노출되며 저장된 값은 bcrypt 해시다.

> **알려진 한계**: 초기화한 관리자가 해당 비밀번호를 알게 된다.
> `mustChangePassword` 플래그로 첫 로그인 시 변경을 강제하는 것이 정석이나 Phase 1 범위를 넘어 보류한다.

### PATCH /users/me/password

본인이 직접 변경한다. **현재 비밀번호 확인이 필요하다.**

**Request**
```json
{ "currentPassword": "old1234!", "newPassword": "new5678!" }
```

> 비밀번호 변경 시 해당 유저의 **모든 RefreshToken을 폐기**한다.
> 탈취된 세션을 끊는 것이 비밀번호 변경의 주요 목적 중 하나이기 때문이다. → ADR-006

---

## 4. Trainers `/trainers`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/trainers` | 인증 | 헬스장 트레이너 목록 |
| GET | `/trainers/:id` | 인증 | 트레이너 상세 |
| PATCH | `/trainers/me/profile` | TRAINER | 본인 프로필 수정 |
| GET | `/trainers/me/members` | TRAINER | 담당 회원 목록 |

### PATCH /trainers/me/profile

**Request**
```json
{ "specialty": "웨이트 트레이닝, 체형교정", "bio": "10년 경력..." }
```

### GET /trainers/me/members

진행 중인 `PTContract` 기준으로 담당 회원을 조회한다.

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "memberId": "uuid",
      "name": "홍길동",
      "contractId": "uuid",
      "totalSessions": 20,
      "remainingSessions": 13,
      "endDate": "2026-12-31"
    }
  ]
}
```

---

## 5. MembershipTypes `/membership-types`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| POST | `/membership-types` | OWNER | 회원권 종류 등록 |
| GET | `/membership-types` | 인증 | 목록 조회 |
| PATCH | `/membership-types/:id` | OWNER | 수정 |
| PATCH | `/membership-types/:id/deactivate` | OWNER | 판매 중지 |

### POST /membership-types

**Request**
```json
{
  "name": "헬스 12개월",
  "category": "헬스",
  "durationDays": 365,
  "price": 550000,
  "holdingLimit": 5,
  "holdingMaxDays": 14
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| category | ✅ | 회원권 성격. 헬스장이 자유롭게 정한다 |
| holdingLimit | | 홀딩 가능 횟수. 생략 시 **0 (홀딩 불가)** |
| holdingMaxDays | | 1회 최대 일수. 생략 시 **14** |

> **`category`가 이어붙이기의 기준이다.** 같은 카테고리의 회원권을 추가로 부여하면
> 기존 종료일 다음날부터 시작된다. 카테고리가 다르면 동시에 진행된다.
> 헬스 + 락커를 함께 끊는 경우가 실제로 흔하다.

> **`holdingLimit`을 종류마다 두는 이유**: 실제 정책이 기간에 따라 갈린다.
> 6개월 미만 불가 / 6~12개월 3회 / 12개월 이상 5회 → 도메인 지식.md

### GET /membership-types

기본은 **판매 중인 것만** 반환한다. `?includeInactive=true`로 전체 조회.

> 쿼리스트링은 항상 문자열이라 `@Type(() => Boolean)`이 동작하지 않는다.
> `Boolean('false')`가 `true`이기 때문이다. → 학습 노트

> **삭제 대신 비활성화**: 이미 판매된 회원권이 참조하고 있으므로 물리 삭제하지 않는다.
> `isActive=false`로 신규 판매만 막는다.

---

## 6. Memberships `/memberships`

### 6-1. 회원권

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| POST | `/memberships` | OWNER | 회원에게 회원권 부여 |
| GET | `/memberships?userId=` | OWNER | 특정 회원의 회원권 목록 |
| GET | `/memberships/me` | 인증 | 본인 회원권 목록 |
| GET | `/memberships/:id` | OWNER | 회원권 상세 |
| PATCH | `/memberships/:id/extend` | OWNER | 기간 연장 |
| PATCH | `/memberships/:id/cancel` | OWNER | 취소 (환불·착오 등록) |
| POST | `/memberships/:id/transfer` | OWNER | 양도 |
| GET | `/memberships/transfers/history?userId=` | OWNER | 양도 이력 |

> **정지/해제(`suspend`·`resume`) API는 없다.** 설계 초기에 두려 했으나
> `MembershipHold`가 그 역할을 가져갔다. 정지는 "언제부터 언제까지"가 있어야
> 종료일을 정확히 밀 수 있는데, 상태 토글로는 그 기간이 남지 않는다. → ADR-011

### POST /memberships

**Payment 레코드를 함께 생성**한다. 현재는 `method=MANUAL`, `status=COMPLETED`로 고정하며,
추후 PG 연동 시 이 지점에서 분기한다. → 두 레코드는 **하나의 트랜잭션**으로 처리.

**Request**
```json
{
  "userId": "uuid",
  "membershipTypeId": "uuid",
  "startDate": "2026-08-01",
  "amount": 500000,
  "memo": "*26.08.06 H12 + 락커12 [카 55만]"
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| startDate | | 생략 시 서버 계산 (이어붙이기) |
| amount | | 생략 시 회원권 종류의 정가. **할인 판매용** |
| memo | | 결제 건별 자유 기록 |

**Response `201`**
```json
{
  "success": true,
  "message": "회원권이 부여되었습니다",
  "data": {
    "id": "uuid",
    "category": "헬스",
    "typeName": "헬스 12개월",
    "startDate": "2026-08-01",
    "endDate": "2027-07-31",
    "daysUntilExpiry": 358,
    "status": "ACTIVE",
    "memo": "*26.08.06 H12 + 락커12 [카 55만]",
    "payment": { "amount": 500000, "method": "MANUAL" }
  }
}
```

> **`endDate`는 클라이언트가 보내지 않는다.** `startDate + durationDays - 1`로 서버가 계산한다.
> `-1`이 없으면 1일권이 이틀이 된다.

> **`amount`를 열어둔 이유**: 현장에서 정가 그대로 파는 경우가 드물다.
> 카드/계좌 차등, 이벤트가, 기존 회원 할인이 일상적이다.
> 정가는 **기본값 제안**이지 고정값이 아니다. → 도메인 지식.md

### GET /memberships/me

**배열을 반환한다.** 한 회원이 여러 건을 동시에 보유할 수 있다.

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "category": "헬스",
      "typeName": "헬스 12개월",
      "startDate": "2026-08-01",
      "endDate": "2027-07-31",
      "daysUntilExpiry": 358,
      "status": "ACTIVE",
      "memo": null,
      "payment": { "amount": 500000, "method": "MANUAL" }
    }
  ]
}
```

> **`daysUntilExpiry`는 저장하지 않고 조회 시 계산한다.**
> `0`이면 오늘까지, 음수면 이미 만료. 현장의 D-day 표기와 같다.
> 매일 갱신하는 배치는 불필요한 복잡도다.

> **만료된 것도 함께 반환한다.** 과거 이력 조회가 데스크의 실제 업무다.
> 필터링은 클라이언트가 `daysUntilExpiry`로 한다.

### PATCH /memberships/:id/extend

```json
{ "days": 7, "reason": "설비 교체로 3층 휴관" }
```

> **`reason`이 필수다.** 홀딩이 제대로 동작하면 이 API는
> "귀찮으니 며칠 더 주자"의 우회 경로가 되기 쉽다.
> 시설 휴관 보상처럼 홀딩으로 표현할 수 없는 정당한 용도를 위해 남긴다. → ADR-011

---

### 6-2. 홀딩(휴회) `/holds`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| POST | `/holds` | MEMBER·OWNER | 홀딩 등록 |
| GET | `/holds?userMembershipId=` | MEMBER·OWNER | 회원권별 홀딩 이력 |
| GET | `/holds/in-progress` | OWNER | 현재 홀딩 중인 목록 |
| GET | `/holds/ending-today` | OWNER | 오늘 종료 예정 |
| PATCH | `/holds/:id` | MEMBER·OWNER | 일정 변경 |
| PATCH | `/holds/:id/cancel` | MEMBER·OWNER | 취소 |

**같은 엔드포인트를 역할에 따라 다르게 허용한다.**

| | MEMBER | OWNER |
|---|--------|-------|
| 대상 | 본인 회원권만 | 헬스장 전체 |
| 날짜 | 미래만 | 과거 소급 가능 |
| 취소 | 시작 전만 | 진행 중도 가능 |

> 진행 중인 홀딩을 되돌리는 것은 **소급 처리**다. 회원이 스스로 할 일이 아니다.

### POST /holds

```json
{
  "userMembershipId": "uuid",
  "startDate": "2026-08-10",
  "endDate": "2026-08-20",
  "reason": "출장"
}
```

**Response `201`**
```json
{
  "success": true,
  "message": "홀딩이 등록되었습니다",
  "data": {
    "id": "uuid",
    "userMembershipId": "uuid",
    "startDate": "2026-08-10",
    "endDate": "2026-08-20",
    "days": 11,
    "phase": "SCHEDULED",
    "createdByRole": "MEMBER",
    "reason": "출장",
    "createdAt": "2026-08-07T10:00:00.000Z"
  }
}
```

**에러**

| 상태 | 코드 | 상황 |
|------|------|------|
| 400 | `HOLD_DURATION_EXCEEDED` | 1회 최대 일수 초과 |
| 400 | `HOLD_OUT_OF_RANGE` | 회원권 기간 밖 |
| 403 | `HOLD_PAST_DATE_FORBIDDEN` | 회원이 과거 날짜로 시도 |
| 409 | `HOLD_LIMIT_EXCEEDED` | 횟수 초과 |
| 409 | `HOLD_OVERLAPPED` | 기간 겹침 |
| 409 | `HOLD_NOT_ALLOWED_FOR_TRANSFERRED` | 양도권 |

> **`days`는 양끝 포함이다.** 8/10~8/20은 11일. 회원권 `endDate`와 같은 원리다.

> **`phase`는 저장하지 않는다.** `status`와 날짜로 계산한다.
> `CANCELLED`만 사람이 개입한 상태이고, 예정/진행중/완료는 오늘이 며칠이냐의 문제다.
> 저장하면 매일 갱신하는 배치가 필요해지고, 배치가 실패하면 사실이 어긋난다. → ADR-011

> **`/holds/ending-today`가 있는 이유**: 데스크가 해제를 깜빡하면
> 회원이 하루를 손해본다. 아침에 확인할 목록을 API로 제공한다.

**등록 즉시 회원권 종료일이 재계산된다.**

```
endDate = startDate + durationDays - 1 + (ACTIVE 홀딩의 총 일수)
```

증분 조정(+10 했다가 -5)이 아니라 **매번 처음부터 다시 계산**한다.
수정이 반복되면 증분은 반드시 어긋난다.

---

### 6-3. 양도

### POST /memberships/:id/transfer

**경로의 `:id`는 양도인의 회원권이다.**

```json
{
  "toUserId": "uuid",
  "fee": 50000,
  "memo": "지인 양도"
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| toUserId | ✅ | 양수인 |
| fee | | 수수료. 생략하거나 `0`이면 **결제 기록을 만들지 않는다** |
| memo | | |

**Response `201`**
```json
{
  "success": true,
  "message": "회원권이 양도되었습니다",
  "data": {
    "id": "uuid",
    "fromMembershipId": "uuid",
    "toMembershipId": "uuid",
    "fromUserId": "uuid",
    "toUserId": "uuid",
    "transferredDays": 26,
    "fee": 50000,
    "memo": "지인 양도",
    "createdAt": "2026-08-07T10:00:00.000Z"
  }
}
```

**에러**

| 상태 | 코드 | 상황 |
|------|------|------|
| 400 | `TRANSFER_SAME_USER` | 본인에게 양도 |
| 404 | `MEMBERSHIP_NOT_FOUND` | 원본 회원권 없음 |
| 404 | `USER_NOT_FOUND` | 양수인이 없거나 다른 헬스장 |
| 409 | `TRANSFER_NO_REMAINING_DAYS` | 잔여 일수 없음 |
| 409 | `INVALID_MEMBERSHIP_STATUS` | `ACTIVE`가 아닌 회원권 |

**처리 순서** — 전부 한 트랜잭션이다.

```
① 진행 중인 홀딩을 어제까지로 단축  (취소가 아니다)
② 회원권 종료일 재계산
③ 잔여 일수 확정
④ 양수인에게 새 회원권 발급 (isTransferred = true)
⑤ 원본을 TRANSFERRED로 종료
⑥ fee > 0이면 Payment 생성
⑦ MembershipTransfer 기록
```

> **①이 이 API의 핵심이다.** 홀딩을 그냥 취소하면
> **이미 지나간 홀딩 일수가 사라져 양도인이 손해를 본다.**
>
> ```
> 30일권 8/1 시작, 8/5~8/9 홀딩, 8/7에 양도
>
> 취소  →  홀딩 5일 소멸,      종료일 8/30, 잔여 24일
> 종료  →  8/5~8/6(2일) 인정,  종료일 9/1,  잔여 26일
> ```
>
> 양도인은 8/5, 8/6 이틀을 실제로 안 나왔다. 그 이틀은 인정받아야 한다.

| 홀딩 상태 | 처리 |
|-----------|------|
| 완료 | 건드리지 않음 (이미 종료일에 반영됨) |
| 예정 | `CANCELLED` (홀딩된 날이 0일) |
| 진행 중 | `endDate = 어제` |

> **③을 먼저 하면 틀린다.** 아직 정리되지 않은 홀딩 일수까지 넘어간다.

> **양수인의 회원권에 `paymentId`를 연결하지 않는다.**
> 양도는 새로운 매출이 아니다. 연결하면 같은 돈이 매출에 두 번 잡힌다.
> 수수료 `Payment`는 `MembershipTransfer.feePaymentId`로만 참조한다.

> **양도권은 홀딩할 수 없다.** 원본과 같은 `MembershipType`을 참조하므로
> 그 종류의 `holdingLimit`이 그대로 적용되는 것을 막는다. → ADR-012

> **재양도는 허용한다.** A→B→C를 막을 현실적 이유가 없고
> `MembershipTransfer`가 체인으로 남는다.
> **양도 취소(되돌리기)는 없다.** 잘못 양도했으면 반대로 다시 양도한다. → ADR-012

### GET /memberships/transfers/history?userId=

준 것과 받은 것을 **모두** 반환한다. 응답 형식은 위와 같다.

---

## 7. Attendance `/attendance`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/attendance/qr-token` | MEMBER | QR용 단기 토큰 발급 |
| POST | `/attendance/check-in` | OWNER | QR 스캔 후 출석 처리 |
| POST | `/attendance/manual` | OWNER | 수동 출석 처리 |
| GET | `/attendance` | OWNER | 출석 이력 조회 |
| GET | `/attendance/me` | MEMBER | 본인 출석 이력 |

### GET /attendance/qr-token

**유효시간 30초**의 단기 JWT를 발급한다. 클라이언트는 이 문자열을 QR로 렌더링한다.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "token": "eyJ...",
    "expiresIn": 30,
    "expiresAt": "2026-07-27T10:30:30.000Z"
  }
}
```

**QR 토큰 payload**
```json
{ "sub": "userId", "gymId": "uuid", "type": "ATTENDANCE", "exp": 1234567890 }
```

> **보안 설계**: 회원 ID를 그대로 QR에 넣으면 캡처 후 무한 재사용이 가능하다.
> 30초 만료 + `type` 필드로 일반 Access Token과 용도를 분리한다.
> `type` 검증을 빠뜨리면 Access Token을 QR로 제출해 출석이 가능해지므로 반드시 확인한다.

### POST /attendance/check-in

입구의 스캔 단말(OWNER 계정으로 로그인된 웹 페이지)이 호출한다.

**Request**
```json
{ "token": "eyJ..." }
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "maskedName": "이*규",
    "checkedAt": "2026-08-10T10:30:12.000Z",
    "isReentry": false,
    "memberships": [
      { "category": "헬스", "daysUntilExpiry": 87 },
      { "category": "락커", "daysUntilExpiry": 3 }
    ]
  },
  "message": "출석이 완료되었습니다"
}
```

출입구 화면은 이 두 줄을 띄운다.

```
이*규 회원님 반갑습니다
헬스 87일 · 락커 3일 남았습니다
```

> **카테고리별로 나누는 이유**: 하나로 뭉치면 가장 늦게 끝나는 회원권 기준이라
> **락커가 3일 남아도 87로 표시된다.**
>
> 락커 만료는 현장에서 문자를 보내지 않고 구두로 전한다.
> 여기에 띄우면 **회원이 직접 보게 되어 데스크가 말할 필요가 없어진다.** → ADR-015

> **풀네임을 보내지 않는다.** 문 앞 화면은 지나가는 사람에게도 보인다.
> 마스킹은 **서버에서** 한다. 클라이언트가 가리면 서버는 풀네임을 보내는 것이므로
> 네트워크를 보면 그대로 노출된다.
>
> 데스크 응대에 풀네임이 필요하면 `GET /users`를 쓴다.
> **용도가 다른 화면을 한 응답으로 만족시키려 하면 항상 더 넓은 쪽에 맞춰지고,
> 보안은 좁은 쪽 기준으로 무너진다.** → ADR-013 결정 6

```
이준규     → 이*규      가운데
남궁민수   → 남**수     가운데 전부
김철       → 김*        2글자는 뒤를
```

**검증 순서**

```
1. 토큰 서명·만료          → 401 QR_TOKEN_EXPIRED
2. type === 'ATTENDANCE'   → 401 INVALID_TOKEN_TYPE
3. gymId 일치              → 403 TENANT_MISMATCH
4. 재출입 유예 안?         → 기록만. isReentry=true. 이하 건너뜀
5. 홀딩 중?                → 403 MEMBERSHIP_ON_HOLD
6. 유효한 회원권 없음?     → 403 NO_ACTIVE_MEMBERSHIP
7. 오늘 입장 횟수 초과?    → 409 DAILY_ENTRY_LIMIT_EXCEEDED
```

> **4번이 5·6·7보다 먼저인 것이 핵심이다.**
> 흡연하고 돌아온 회원을 "오늘 횟수를 다 썼다"고 막으면 안 된다.
> 유예 시간 안의 재스캔은 **이미 통과한 입장의 연장**이므로 다시 검사하지 않는다.

**안내 문구**

| 코드 | 문구 |
|------|------|
| `MEMBERSHIP_ON_HOLD` | 현재 휴회중인 회원입니다. 휴회를 철회한 후 이용해주세요 |
| `NO_ACTIVE_MEMBERSHIP` | 이용 가능한 회원권이 없습니다. 데스크에 문의해주세요 |
| `DAILY_ENTRY_LIMIT_EXCEEDED` | 오늘 입장 가능 횟수를 초과했습니다. 문제가 있으면 헬스장에 문의해주세요 |

> **문구가 스펙이다.** 출입 통제형 헬스장에서는 이 문장이 회원이 보는 유일한 화면이다.
> "권한이 없습니다"로는 회원이 무엇을 해야 할지 알 수 없다.

**헬스장 설정에 따라 동작이 달라진다**

| 설정 | 의미 |
|------|------|
| `Gym.dailyEntryLimit` | 하루 입장 횟수. `null`이면 무제한 |
| `Gym.reentryGraceMinutes` | 이 시간 안의 재스캔은 같은 입장. `0`이면 재출입 미사용 |

```
reentryGraceMinutes = 0     형식적 스캔형. 매 스캔이 새 입장
reentryGraceMinutes = 30    출입 통제형. 흡연 후 재입장을 인정
```

### POST /attendance/manual

QR을 못 찍는 상황(폰 배터리 방전, 앱 오류)에서 데스크가 대신 처리한다.

```json
{ "userId": "uuid", "checkedAt": "2026-08-10T10:30:00.000Z" }
```

`method = MANUAL`로 기록된다. 검증 순서는 `check-in`의 5~7번과 같다.

> **`method`를 남기는 이유**: 수동 출석이 비정상적으로 많다면
> QR 단말에 문제가 있거나 우회가 관행이 된 것이다. 구분되어야 알 수 있다.

### GET /attendance

**Query**: `userId`, `startDate`, `endDate`, `page`, `limit`

> 재입장(`isReentry=true`)도 함께 반환한다. 출입 로그는 온전해야 한다.
> **출석 "일수"를 세려면 `isReentry = false`만 카운트**한다.

---

## 8. PT `/pt`

### 8-1. 계약 `/pt/contracts`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| POST | `/pt/contracts` | OWNER | PT 계약 등록 |
| GET | `/pt/contracts` | OWNER | 계약 목록 |
| GET | `/pt/contracts/:id` | OWNER, 당사자 | 계약 상세 |
| GET | `/pt/contracts/me` | MEMBER, TRAINER | 본인 계약 목록 |
| PATCH | `/pt/contracts/:id/cancel` | OWNER | 계약 취소 |

**POST /pt/contracts Request**
```json
{
  "memberId": "uuid",
  "trainerId": "uuid",
  "totalSessions": 20,
  "amount": 1200000,
  "startDate": "2026-08-01",
  "endDate": "2026-12-31"
}
```

**제약**
- `trainerId`는 role=TRAINER인 User만 허용 → `400 INVALID_TRAINER`
- 생성 시 `remainingSessions = totalSessions`
- **`Payment`를 함께 생성한다 (한 트랜잭션).** 회원권 부여와 같은 패턴이다

> **계약이 곧 결제다.** 예약과 완료 처리에는 결제가 없다. 횟수만 움직인다.

> **트레이너는 계약 시 배정되고 1:1로 고정된다.**
> 변경은 이례적이라 별도 기능으로 두지 않았다. → 향후 과제

### 8-2. 예약 `/pt/schedules`

**빈 슬롯이라는 개념이 없다. 행 하나가 예약 하나다.**

현장에서 예약은 카톡·전화로 정해지고 트레이너가 시스템에 입력한다.
회원이 화면에서 빈 시간을 골라 잡는 구조가 아니다. → ADR-014 결정 1

```
SCHEDULED ──(완료 확인)──> COMPLETED
    │
    ├────(노쇼 처리)────> NO_SHOW      차감 여부는 트레이너가 선택
    └────(취소)────────> CANCELLED
```

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| POST | `/pt/schedules` | TRAINER | 예약 등록 |
| POST | `/pt/schedules/recurring` | TRAINER | **반복 예약 일괄 등록** |
| GET | `/pt/schedules` | OWNER | 헬스장 전체 현황 |
| GET | `/pt/schedules/me` | TRAINER, MEMBER | 본인 일정 |
| GET | `/pt/schedules/unconfirmed` | TRAINER, OWNER | **미확인 목록** |
| PATCH | `/pt/schedules/:id` | TRAINER | 일정 이동 |
| PATCH | `/pt/schedules/:id/complete` | TRAINER, OWNER | 완료 확정 |
| PATCH | `/pt/schedules/:id/no-show` | TRAINER, OWNER | 노쇼 처리 |
| PATCH | `/pt/schedules/:id/cancel` | TRAINER, MEMBER | 취소 |

### POST /pt/schedules

```json
{
  "contractId": "uuid",
  "startAt": "2026-09-01T19:00:00.000Z",
  "durationMinutes": 60
}
```

> `trainerId`·`memberId`·`gymId`는 계약과 토큰에서 가져온다. 클라이언트 값을 신뢰하지 않는다.

**시간이 겹치면 `409 SCHEDULE_OVERLAPPED`.**
애플리케이션이 검사하지 않는다. **PostgreSQL `EXCLUDE` 제약이 INSERT를 거부**하고,
그 위반을 잡아 에러 코드로 변환한다.

```sql
EXCLUDE USING gist (trainer_id WITH =, tstzrange(start_at, end_at) WITH &&)
  WHERE (status <> 'CANCELLED')
```

> 조회해서 판단하면 조회와 INSERT 사이가 비지만, **제약은 그 틈이 없다.**

### POST /pt/schedules/recurring

PT는 "매주 화·목 19시"처럼 고정 스케줄이 되는 경우가 대부분이다.

```json
{
  "contractId": "uuid",
  "weekdays": [2, 4],
  "startTime": "19:00",
  "durationMinutes": 60,
  "from": "2026-09-01",
  "to": "2026-09-30"
}
```

**Response `201`** — 생성된 예약과 **겹쳐서 건너뛴 날짜**를 함께 반환한다.

```json
{
  "success": true,
  "data": {
    "created": [ /* … */ ],
    "skipped": [
      { "startAt": "2026-09-09T19:00:00.000Z", "reason": "SCHEDULE_OVERLAPPED" }
    ]
  }
}
```

> **하나가 겹쳤다고 전체를 롤백하지 않는다.**
> 한 달치 9건 중 1건이 겹쳤다고 8건을 버리면 트레이너가 다시 다 입력해야 한다.
> 건너뛴 것을 알려주고 그것만 따로 잡게 하는 편이 실제 업무에 맞다.

### GET /pt/schedules/unconfirmed

```
endAt < now  AND  status = 'SCHEDULED'
```

수업 시간이 지났는데 아무도 확인하지 않은 예약이다.

> **배치가 아니라 조회다.** 자정에 일괄 완료 처리하지 않는다.
> 시스템은 수업이 실제로 진행됐는지 알 수 없다 — 출석과 달리 QR 같은 증거가 없다.
> 일괄 처리하면 **하지 않은 수업도 차감된다.**
>
> `GET /holds/ending-today`와 같은 패턴이다.
> **놓치지 않게 보여주되 누르는 것은 사람이다.** → ADR-014 결정 3

### PATCH /pt/schedules/:id/complete

**한 트랜잭션에서 조건부 UPDATE 두 번.**

```sql
UPDATE pt_schedules
   SET status = 'COMPLETED', session_deducted = true, confirmed_by_user_id = :userId
 WHERE id = :id AND status = 'SCHEDULED';
-- affected = 0 → 이미 처리됨 → 409 ALREADY_CONFIRMED

UPDATE pt_contracts
   SET remaining_sessions = remaining_sessions - 1
 WHERE id = :contractId AND remaining_sessions > 0;
-- affected = 0 → 잔여 없음 → 409 NO_REMAINING_SESSIONS
```

**락도 재시도도 없다.** `UPDATE`가 행 락을 잡은 뒤 `WHERE`를 다시 평가하므로,
`SELECT` → `UPDATE` 사이에 생기는 틈이 없다. → ADR-014 결정 5

`remainingSessions`가 0이 되면 `PTContract.status`를 `COMPLETED`로 바꾼다.

### PATCH /pt/schedules/:id/no-show

```json
{ "deductSession": true }
```

**노쇼 처리와 차감 여부가 분리되어 있다.** 헬스장·사유마다 다르고 트레이너 재량이다.

| 조합 | 상황 |
|------|------|
| `deductSession: true` | 규정대로 차감 |
| `deductSession: false` | 봐줬다. **노쇼 이력은 남는다** |

> 이걸 `CANCELLED`로 뭉개면 "이 회원이 노쇼를 몇 번 했나"를 셀 수 없다.

### 권한 정리

| | 등록·이동 | 완료·노쇼 | 취소 | 조회 |
|---|:---:|:---:|:---:|:---:|
| TRAINER | 담당 회원 | 담당 회원 | O | 본인 일정 |
| MEMBER | ✗ | ✗ | 본인 | 본인 일정 |
| OWNER | ✗ | **정정** | O | 전체 |

> **OWNER에게 완료·노쇼 권한을 주는 이유**: 트레이너도 실적이라는 이해관계가 있다.
> 회원이 이의를 제기했을 때 정정할 경로가 데스크에 있어야 한다.

> **회원이 직접 예약하지 않는 이유**: 선착순은 경쟁 범위가 열려 있어야 성립한다.
> 담당 트레이너가 정해져 있으면 놓쳐도 대안이 없어
> **특정 시간대만 가능한 회원이 계속 밀린다.** → ADR-014 결정 1

---

## ~~9. Notifications~~ — 제거됨

**SSE 알림 기능은 구현하지 않는다.** → ADR-015

원래 트리거 셋을 구현 직전에 다시 검사했더니 근거가 사라져 있었다.

| 트리거 | 판정 |
|--------|------|
| PT 슬롯 예약됨 → 트레이너 | ❌ **회원이 예약하지 않는다.** 트레이너가 직접 등록한다(ADR-014) |
| PT 예약 취소됨 → 상대방 | △ 유효하나 현장에서는 카톡으로 먼저 말한다 |
| 회원권 만료 임박 → 회원 | ❌ **수신자에게 클라이언트가 없다.** 원래 데스크가 하는 일이다 |

> **Pull은 클라이언트 부재를 견디고 Push는 못 견딘다.**
> `GET /memberships/me` 같은 MEMBER API들은 화면이 없어도 설계가 성립하지만,
> SSE는 "지금 연결되어 있는가"에 기능의 존재 자체가 걸려 있다.
> 앱이 생겨도 백그라운드에서는 동작하지 않아 FCM으로 대체해야 한다.

필요했던 것은 실시간 통지가 아니라 **대상을 뽑아내는 조회**였고,
`GET /users`의 만료 필터로 대체했다. → 3장

---

## 10. Stats `/stats`

| Method | Endpoint | 권한 | 설명 |
|--------|----------|------|------|
| GET | `/stats/members` | OWNER | 월별 신규 회원 수 |
| GET | `/stats/attendance` | OWNER | 월별 출석률 |
| GET | `/stats/revenue` | OWNER | 회원권 종류별 매출 |
| GET | `/stats/pt` | OWNER | 트레이너별 PT 완료 횟수 |

**Query 공통**: `year`, `month` (미지정 시 최근 12개월)

**GET /stats/revenue Response**
```json
{
  "success": true,
  "data": {
    "totalRevenue": 12400000,
    "byType": [
      { "typeName": "3개월권", "count": 24, "revenue": 6480000 },
      { "typeName": "1개월권", "count": 51, "revenue": 5100000 }
    ]
  }
}
```

> 모든 통계 쿼리는 `WHERE gym_id = ?` 로 시작한다.
> `gymId`를 각 테이블에 비정규화한 이유가 여기에 있다. → ADR-004

---

## 구현 순서

| 순서 | 모듈 | 비고 |
|------|------|------|
| 1 | Auth + Gym + User | ✅ 완료. 최초 SUPER_ADMIN은 시드로 생성 |
| 2-1 | MembershipType + Membership | ✅ 완료. Payment 트랜잭션 포함 (#16) |
| 2-2 | 홀딩(휴회) | ✅ 완료 (#18) |
| 2-3 | 양도 | ✅ 완료 (#20) |
| 3 | Attendance (QR) | ✅ 완료 (#24) |
| 4-1 | PT 계약 | ✅ 완료 (#26) |
| 4-2 | PT 예약 | ✅ 완료 (#28). EXCLUDE 제약, 반복 등록 |
| 4-3 | PT 완료·노쇼 | ✅ 완료 (#30). 조건부 UPDATE 동시성 |
| 5-1 | 만료 관리 (회원 필터) | **다음 차례.** 정확값 필터, 카테고리 구분 |
| 5-2 | Stats | 매출·출석률 집계 |
| 6 | 배포 | 마이그레이션 도입이 선행되어야 함 |

> ~~Notification (SSE)~~ — **제거됨.** → ADR-015

---

## 미결정 사항

전체 백로그는 [[향후 과제]] 참고.

- [x] ~~최초 SUPER_ADMIN 생성 방법~~ → **시드 스크립트**로 결정. 개발 환경에서는 테스트용 Gym도 함께 생성
- [x] ~~회원권 만료 자동 처리~~ → **조회 시 `endDate` 비교**로 결정. `EXPIRED` 상태값을 두지 않는다 → ADR-010
- [ ] PT 슬롯의 수업 시간(duration): 현재 시각만 저장. 1시간 고정 가정인지 명시 필요
- [ ] 예약 취소 시 위약 정책 (당일 취소도 횟수 차감할지)
