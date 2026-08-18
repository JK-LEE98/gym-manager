import { SelectQueryBuilder } from 'typeorm';
import { User } from './entities/user.entity';
import {
  EXPIRING_THRESHOLD_DAYS,
  MembershipFilter,
  UserQueryDto,
} from './dto/user-request.dto';
import { addDays, today } from '../common/utils/date.util';

/**
 * 회원 목록의 상태·만료 필터.
 *
 * **모든 조건이 `EXISTS` 서브쿼리다.** 회원 한 명이 회원권을 여러 건 갖기 때문에
 * 조인으로 붙이면 같은 회원이 여러 행으로 나와 페이지네이션이 깨진다.
 *
 * ---
 *
 * **핵심은 카테고리별 "가장 늦은 종료일"을 본다는 것이다.**
 *
 * 이어붙이기(ADR-010) 때문에 개별 회원권의 `endDate`를 그대로 보면 안 된다.
 * ```
 * 헬스 3개월권  ~ D-3     ← 이것만 보면 임박이다
 * 헬스 12개월권 D-2 ~     ← 이어져 있으므로 실제로는 임박이 아니다
 * ```
 * 이 회원에게 "곧 만료됩니다" 문자를 보내면 안 된다.
 *
 * @see ADR-015
 */

/**
 * (회원, 카테고리)별 가장 늦은 종료일.
 *
 * 취소·양도된 회원권은 제외한다. 이용할 수 없는 것이므로 만료 판정의 근거가 아니다.
 */
const CATEGORY_END_DATES = `
  SELECT m.user_id AS user_id,
         t.category AS category,
         MAX(m.end_date) AS end_date
    FROM user_memberships m
    JOIN membership_types t ON t.id = m.membership_type_id
   WHERE m.gym_id = :gymId
     AND m.status = 'ACTIVE'
   GROUP BY m.user_id, t.category
`;

/** 오늘 이용 가능한 회원권이 있는가 (홀딩 여부는 보지 않는다) */
const HAS_USABLE_MEMBERSHIP = `
  EXISTS (
    SELECT 1 FROM user_memberships m
     WHERE m.user_id = "user".id
       AND m.gym_id = :gymId
       AND m.status = 'ACTIVE'
       AND m.start_date <= :today
       AND m.end_date >= :today
  )
`;

/**
 * 오늘이 홀딩 기간 안인가.
 *
 * 홀딩은 `status`에 저장하지 않고 날짜로 판단한다. @see ADR-011
 */
const IS_ON_HOLD = `
  EXISTS (
    SELECT 1 FROM membership_holds h
    JOIN user_memberships m ON m.id = h.user_membership_id
     WHERE m.user_id = "user".id
       AND m.gym_id = :gymId
       AND m.status = 'ACTIVE'
       AND h.status = 'ACTIVE'
       AND h.start_date <= :today
       AND h.end_date >= :today
  )
`;

/** 회원권을 한 번이라도 산 적이 있는가 (취소된 것도 산 것으로 본다) */
const HAS_ANY_MEMBERSHIP = `
  EXISTS (
    SELECT 1 FROM user_memberships m
     WHERE m.user_id = "user".id AND m.gym_id = :gymId
  )
`;

/**
 * 현재 등록 구간의 시작일.
 *
 * "직전 365일 안에 다른 회원권이 없는 시작일" 중 가장 늦은 것이다.
 * 공백이 1년 이상이면 새로 시작한 회원으로 본다. @see 도메인 지식 8장
 *
 * ```
 * 1/1~3/31   4/1~6/30   ···공백 400일···   8/1~
 * └── 같은 구간 ──┘                       └ 새 구간 = 현재 구간 시작일
 * ```
 *
 * **저장하지 않고 계산하는 이유**: 저장하면 재등록마다 "리셋할까?"를 판단해야 하고,
 * 나중에 기준(365일)을 바꿔도 이미 저장된 값은 바뀌지 않는다.
 */
const CURRENT_SEGMENT_START = `
  SELECT MAX(m.start_date)
    FROM user_memberships m
   WHERE m.user_id = "user".id
     AND m.gym_id = :gymId
     AND m.status <> 'CANCELLED'
     AND NOT EXISTS (
       SELECT 1 FROM user_memberships p
        WHERE p.user_id = m.user_id
          AND p.gym_id = m.gym_id
          AND p.status <> 'CANCELLED'
          AND p.start_date < m.start_date
          AND p.end_date >= m.start_date - INTERVAL '365 days'
     )
`;

/** 카테고리 필터를 서브쿼리에 얹는다. 생략하면 전체 카테고리 */
function categoryClause(category?: string): string {
  return category ? 'AND s.category = :category' : '';
}

/** `CATEGORY_END_DATES`에서 조건에 맞는 행이 있는가 */
function endDateExists(condition: string, category?: string): string {
  return `
    EXISTS (
      SELECT 1 FROM (${CATEGORY_END_DATES}) s
       WHERE s.user_id = "user".id
         ${categoryClause(category)}
         AND ${condition}
    )
  `;
}

/**
 * 조회 조건을 QueryBuilder에 적용한다.
 *
 * `today`와 `category`는 여러 서브쿼리가 공유하므로 여기서 한 번만 바인딩한다.
 */
export function applyMemberFilters(
  qb: SelectQueryBuilder<User>,
  query: UserQueryDto,
): void {
  const now = today();
  qb.setParameter('today', now);
  if (query.category) qb.setParameter('category', query.category);

  applyStatusTab(qb, query, now);
  applyExactFilters(qb, query, now);
}

/** ① 화면 탭 — 사람이 훑어보는 용도 */
function applyStatusTab(
  qb: SelectQueryBuilder<User>,
  query: UserQueryDto,
  now: string,
): void {
  switch (query.membershipStatus) {
    case MembershipFilter.ACTIVE:
      // 홀딩 중인 회원은 ON_HOLD 탭에서 본다. 두 탭이 겹치지 않아야
      // "활성 12명 + 홀딩 3명"을 더해 전체를 셀 수 있다
      qb.andWhere(HAS_USABLE_MEMBERSHIP).andWhere(`NOT ${IS_ON_HOLD}`);
      break;

    case MembershipFilter.ON_HOLD:
      qb.andWhere(IS_ON_HOLD);
      break;

    case MembershipFilter.EXPIRING:
      qb.andWhere(
        endDateExists(
          `s.end_date BETWEEN :today AND :expiringUntil`,
          query.category,
        ),
      ).setParameter('expiringUntil', addDays(now, EXPIRING_THRESHOLD_DAYS));
      break;

    case MembershipFilter.EXPIRED:
      // 기간 제한을 두지 않는다. 화면에서 보는 것은 "이 헬스장을 거쳐간 사람"이다.
      // 문자 대상은 expiredWithinDays로 따로 뽑는다
      qb.andWhere(HAS_ANY_MEMBERSHIP).andWhere(`NOT ${HAS_USABLE_MEMBERSHIP}`);
      break;

    case MembershipFilter.NONE:
      qb.andWhere(`NOT ${HAS_ANY_MEMBERSHIP}`);
      break;

    case MembershipFilter.ALL:
    case undefined:
      break;
  }
}

/** ② 문자 대상 — 정확히 뽑는다 */
function applyExactFilters(
  qb: SelectQueryBuilder<User>,
  query: UserQueryDto,
  now: string,
): void {
  if (query.expiringInDays !== undefined) {
    // 범위가 아니라 정확값이다. "7일 이내"로 만들면 D-7·D-5·D-3이 섞여
    // 매일 돌릴 때 한 사람에게 문자가 여러 번 간다
    qb.andWhere(
      endDateExists(`s.end_date = :expiringOn`, query.category),
    ).setParameter('expiringOn', addDays(now, query.expiringInDays));
  }

  if (query.expiredWithinDays !== undefined) {
    // 복귀 홍보용이라 범위가 맞다. 한 명씩 정확히 뽑을 이유가 없다
    qb.andWhere(
      endDateExists(
        `s.end_date BETWEEN :expiredFrom AND :expiredUntil`,
        query.category,
      ),
    )
      .setParameter('expiredFrom', addDays(now, -query.expiredWithinDays))
      .setParameter('expiredUntil', addDays(now, -1));
  }

  if (query.startedWithinDays !== undefined) {
    qb.andWhere(`(${CURRENT_SEGMENT_START}) >= :startedFrom`).setParameter(
      'startedFrom',
      addDays(now, -query.startedWithinDays + 1),
    );
  }
}
