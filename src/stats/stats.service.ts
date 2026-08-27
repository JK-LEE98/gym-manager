import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Payment,
  PaymentPurpose,
  PaymentStatus,
} from '../memberships/entities/payment.entity';
import {
  MembershipStatus,
  UserMembership,
} from '../memberships/entities/user-membership.entity';
import { User } from '../users/entities/user.entity';
import {
  PTSchedule,
  PTScheduleStatus,
} from '../pt/entities/pt-schedule.entity';
import {
  AttendanceSummaryDto,
  MonthlyMemberDto,
  MonthlyRevenueDto,
  StatsQueryDto,
  TrainerStatsDto,
} from './dto/stats.dto';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';
import {
  DateString,
  addDays,
  addMonths,
  daysBetween,
  firstDayOfMonth,
  monthsBetween,
  today,
} from '../common/utils/date.util';

/** 기본 조회 범위. 이번 달 포함 최근 12개월 */
const DEFAULT_MONTHS = 12;

/** 조회 가능한 최대 개월 수. 넘으면 0으로 채울 달이 수천 개가 된다 */
const MAX_MONTHS = 60;

/**
 * **집계 대상 시각을 한국 시간으로 고정한다.**
 *
 * `pt_schedules.start_at`은 `timestamptz`인데 Postgres 컨테이너에 `TZ`가 없어
 * 세션 타임존이 UTC다. 날짜 문자열과 그냥 비교하면 `'2026-08-01'`이
 * UTC 자정(= 한국 오전 9시)으로 해석되어 **오전 수업이 통째로 빠진다.**
 *
 * `AT TIME ZONE`으로 명시하면 세션 설정과 무관하게 같은 결과가 나온다.
 * 헬스장별 타임존이 필요해지면 이 상수를 컬럼으로 바꾼다. → 향후 과제
 */
const GYM_TIMEZONE = 'Asia/Seoul';

/** 한국 시간 기준 벽시계 시각 (`timestamptz` → `timestamp`) */
const SCHEDULE_LOCAL_TIME = `("schedule"."start_at" AT TIME ZONE '${GYM_TIMEZONE}')`;

/**
 * 운영 통계.
 *
 * ---
 *
 * **모든 쿼리가 `WHERE gym_id = ?`로 시작한다.**
 * 집계는 테넌트 격리가 깨졌을 때 가장 티가 안 나는 지점이다.
 * 목록 조회는 남의 회원이 섞이면 이름을 보고 알아채지만,
 * 매출 합계는 숫자가 커진 것을 아무도 눈치채지 못한다. @see ADR-004
 *
 * ---
 *
 * **`created_at`은 `timestamp`(타임존 없음)라 그대로 벽시계 시각이다.**
 * TypeORM의 `@CreateDateColumn` 기본 매핑이 `timestamp`이고,
 * 앱 컨테이너가 `TZ=Asia/Seoul`이므로 저장된 값이 이미 한국 시간이다.
 * `timestamptz`인 `start_at`만 변환이 필요하다.
 */
@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserMembership)
    private readonly membershipRepo: Repository<UserMembership>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 회원 한 명의 이용 일수. 이용 중인 회원권이 없으면 `null`.
   *
   * ---
   *
   * **회원권별로 나누지 않는 이유는 나눌 수가 없기 때문이다.**
   * `attendances`에는 어느 회원권 때문에 왔는지가 없다. QR을 찍으면 "왔다"는 행 하나가 남는다.
   * 헬스와 락커를 함께 끊은 회원의 출석 4건을 둘로 쪼갤 근거가 없어,
   * 회원권별로 붙이면 **락커에도 `4/10`이 찍힌다.** 락커는 회원이 오든 안 오든 점유 중인데도.
   *
   * `category`로 거를 수도 없다. 헬스장이 자유롭게 입력하는 `varchar(50)`이라
   * `'헬스'`를 코드에 박으면 "피트니스"·"GYM"으로 쓰는 헬스장에서 통째로 빠진다.
   *
   * ---
   *
   * **홀딩은 합이 아니라 `DISTINCT` 일수로 센다.**
   * 겹침 검사는 같은 회원권 안에서만 하므로, 헬스와 락커를 같은 기간에 홀딩하면
   * 단순히 더할 경우 같은 날이 두 번 빠져 분모가 음수가 될 수도 있다.
   */
  async attendanceSummary(
    userId: string,
    gymId: string,
  ): Promise<AttendanceSummaryDto | null> {
    const now = today();

    // 이용 중인 회원권들의 합집합 구간.
    // `::text`로 받는 이유: date 컬럼을 그대로 꺼내면 드라이버가 Date 객체로 주기도 해
    // 타임존이 섞여 하루가 밀린다. 문자열로 고정한다
    const window = await this.membershipRepo
      .createQueryBuilder('membership')
      .select(`MIN("membership"."start_date")::text`, 'from')
      .addSelect(`MAX("membership"."end_date")::text`, 'to')
      .where('membership.userId = :userId', { userId })
      .andWhere('membership.gymId = :gymId', { gymId })
      .andWhere('membership.status = :active', {
        active: MembershipStatus.ACTIVE,
      })
      .andWhere('membership.endDate >= :today', { today: now })
      .getRawOne<{ from: string | null; to: string | null }>();

    if (!window?.from || !window.to) return null;

    const from = window.from;
    // 아직 오지 않은 날은 분모에 넣지 않는다.
    // 오늘 30일권을 끊은 회원이 0/30으로 보이면 이탈 신호로 오해한다
    const to = window.to < now ? window.to : now;

    // 이어붙이기로 미래에 시작하는 회원권만 있는 경우. 아직 셀 것이 없다
    if (from > to) {
      return { from, to, attendedDays: 0, usableDays: 0 };
    }

    const [counts] = await this.dataSource.query<
      { attended: number; held: number }[]
    >(ATTENDANCE_SUMMARY_SQL, [userId, gymId, from, to]);

    return {
      from,
      to,
      attendedDays: counts.attended,
      // daysBetween은 차이라서 양끝 포함이 되도록 1을 더한다.
      // 8/1~8/1은 0이 아니라 1일이다
      usableDays: daysBetween(from, to) + 1 - counts.held,
    };
  }

  /**
   * 월별·목적별 매출.
   *
   * **결제일에 전액 인식한다.** 판 달의 매출이지 이용 기간에 나눠 넣지 않는다.
   * 여기서 "결제일"은 `Payment.createdAt`, 즉 **입력한 시각**이다.
   * 헬스장은 현장에서 바로 등록하므로 대부분 일치하지만
   * 월말에 받은 돈을 다음 달에 넣으면 어긋난다. → 향후 과제
   */
  async revenue(
    query: StatsQueryDto,
    gymId: string,
  ): Promise<MonthlyRevenueDto[]> {
    const { from, toExclusive, months } = this.resolveRange(query);

    const rows = await this.paymentRepo
      .createQueryBuilder('payment')
      .select(`to_char("payment"."created_at", 'YYYY-MM')`, 'month')
      .addSelect(`"payment"."purpose"`, 'purpose')
      // amount는 int라 여러 건을 더하면 int4 한계(약 21억)를 넘을 수 있다.
      // bigint로 받으면 드라이버가 문자열로 주므로 JS에서 숫자로 바꾼다
      .addSelect(`SUM("payment"."amount")::bigint`, 'total')
      .where('payment.gymId = :gymId', { gymId })
      // 환불된 결제는 매출이 아니다
      .andWhere('payment.status = :completed', {
        completed: PaymentStatus.COMPLETED,
      })
      .andWhere('payment.createdAt >= :from', { from })
      .andWhere('payment.createdAt < :toExclusive', { toExclusive })
      .groupBy(`to_char("payment"."created_at", 'YYYY-MM')`)
      .addGroupBy(`"payment"."purpose"`)
      .getRawMany<{ month: string; purpose: PaymentPurpose; total: string }>();

    const byMonth = new Map<string, MonthlyRevenueDto>(
      months.map((month) => [month, emptyRevenue(month)]),
    );

    for (const row of rows) {
      const entry = byMonth.get(row.month);
      // 범위 밖의 달이 나올 수 없지만, 나온다면 조용히 버리는 대신 건너뛴다
      if (!entry) continue;

      const amount = Number(row.total);
      entry.byPurpose[row.purpose] = amount;
      entry.total += amount;
    }

    return months.map((month) => byMonth.get(month)!);
  }

  /**
   * 월별 신규 회원 수.
   *
   * **탈퇴한 회원도 센다(`withDeleted`).** "8월에 12명 등록했다"는
   * 나중에 누가 나가도 바뀌지 않는 사실이다. 제외하면 **지난달 숫자가 오늘 달라져**
   * 이미 보고한 값과 어긋난다.
   */
  async members(
    query: StatsQueryDto,
    gymId: string,
  ): Promise<MonthlyMemberDto[]> {
    const { from, toExclusive, months } = this.resolveRange(query);

    const rows = await this.userRepo
      .createQueryBuilder('user')
      .withDeleted()
      .select(`to_char("user"."created_at", 'YYYY-MM')`, 'month')
      .addSelect(`COUNT(*)::int`, 'count')
      .where('user.gymId = :gymId', { gymId })
      // 트레이너·OWNER 계정은 신규 회원이 아니다
      .andWhere('user.role = :member', { member: Role.MEMBER })
      .andWhere('user.createdAt >= :from', { from })
      .andWhere('user.createdAt < :toExclusive', { toExclusive })
      .groupBy(`to_char("user"."created_at", 'YYYY-MM')`)
      .getRawMany<{ month: string; count: number }>();

    const counts = new Map(rows.map((row) => [row.month, row.count]));

    return months.map((month) => ({
      month,
      newMembers: counts.get(month) ?? 0,
    }));
  }

  /**
   * 트레이너별 PT 완료·노쇼.
   *
   * **`User`에서 시작해 `LEFT JOIN`한다.** 예약에서 시작하면
   * 한 건도 없는 트레이너가 목록에서 사라져, 데스크가 가장 확인하고 싶은
   * "이 트레이너 왜 실적이 없지"를 볼 수 없다.
   *
   * **기간 조건은 `ON` 절에 넣는다.** `WHERE`에 넣으면 조인 결과가 NULL인 행이
   * 조건에서 탈락해 `LEFT JOIN`이 사실상 `INNER JOIN`이 된다.
   */
  async trainers(
    query: StatsQueryDto,
    gymId: string,
  ): Promise<TrainerStatsDto[]> {
    const { from, toExclusive } = this.resolveRange(query);

    const rows = await this.userRepo
      .createQueryBuilder('user')
      .leftJoin(
        PTSchedule,
        'schedule',
        `"schedule"."trainer_id" = "user"."id"
         AND "schedule"."gym_id" = "user"."gym_id"
         AND ${SCHEDULE_LOCAL_TIME} >= :from
         AND ${SCHEDULE_LOCAL_TIME} < :toExclusive`,
        { from, toExclusive },
      )
      .select(`"user"."id"`, 'trainerId')
      .addSelect(`"user"."name"`, 'trainerName')
      // FILTER는 조인이 없는 행(status가 NULL)을 세지 않아 0이 된다.
      // COUNT(schedule.id)를 쓰면 상태 구분이 안 되고, CASE SUM보다 의도가 드러난다
      .addSelect(
        `COUNT(*) FILTER (WHERE "schedule"."status" = :completed)::int`,
        'completed',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE "schedule"."status" = :noShow)::int`,
        'noShow',
      )
      .setParameters({
        completed: PTScheduleStatus.COMPLETED,
        noShow: PTScheduleStatus.NO_SHOW,
      })
      .where('user.gymId = :gymId', { gymId })
      .andWhere('user.role = :trainer', { trainer: Role.TRAINER })
      .groupBy(`"user"."id"`)
      .addGroupBy(`"user"."name"`)
      .getRawMany<TrainerStatsDto>();

    // 실적 순으로 본다. 트레이너 수는 많아야 수십 명이라 DB에서 정렬할 이유가 없고,
    // 출력 별칭 정렬은 TypeORM이 엔티티 속성으로 오해할 수 있다
    return rows.sort(
      (a, b) =>
        b.completed - a.completed || a.trainerName.localeCompare(b.trainerName),
    );
  }

  /**
   * 조회 범위를 확정한다.
   *
   * `toExclusive`를 쓰는 이유: `created_at`은 시각까지 있어
   * `<= '2026-08-31'`로 걸면 **8월 31일 00시 이후의 결제가 전부 빠진다.**
   * 다음 날 0시 미만으로 잡아야 그날 하루가 온전히 들어온다.
   */
  private resolveRange(query: StatsQueryDto): {
    from: DateString;
    toExclusive: DateString;
    months: string[];
  } {
    const to = query.to ?? today();
    // 1일로 먼저 맞추고 나서 월을 뺀다. 순서를 바꾸면 31일에 실행할 때
    // `setMonth`가 없는 날짜(9월 31일)를 다음 달로 흘려 한 달이 사라진다
    const from =
      query.from ?? addMonths(firstDayOfMonth(to), -(DEFAULT_MONTHS - 1));

    if (from > to) {
      throw new BusinessException(
        ErrorCode.INVALID_DATE_RANGE,
        '시작일이 종료일보다 늦습니다',
      );
    }

    const months = monthsBetween(from, to);
    if (months.length > MAX_MONTHS) {
      throw new BusinessException(
        ErrorCode.INVALID_DATE_RANGE,
        `조회 기간은 최대 ${MAX_MONTHS}개월입니다`,
      );
    }

    return { from, toExclusive: addDays(to, 1), months };
  }
}

/**
 * 출석일 수와 홀딩 일수를 한 번에 센다.
 *
 * - `attended` — `checked_at`은 `timestamptz`라 한국 시간으로 변환한 뒤 날짜를 뽑는다.
 *   변환하지 않으면 세션 타임존(UTC) 기준이 되어 **오전 9시 이전 출석이 전날로 밀린다.**
 *   재출입(`is_reentry`)은 `DISTINCT`가 알아서 걸러낸다.
 *
 * - `held` — `generate_series`로 홀딩 기간을 날짜로 펼친 뒤 `DISTINCT`로 센다.
 *   회원권마다 따로 홀딩할 수 있어 기간이 겹칠 수 있으므로 단순 합산은 틀린다.
 *   `GREATEST`/`LEAST`로 조회 구간에 맞춰 잘라야 구간 밖의 날이 섞이지 않는다.
 */
const ATTENDANCE_SUMMARY_SQL = `
  SELECT
    (SELECT COUNT(DISTINCT (a.checked_at AT TIME ZONE '${GYM_TIMEZONE}')::date)
       FROM attendances a
      WHERE a.user_id = $1
        AND a.gym_id = $2
        AND (a.checked_at AT TIME ZONE '${GYM_TIMEZONE}')::date BETWEEN $3::date AND $4::date
    )::int AS attended,
    (SELECT COUNT(DISTINCT held_on)
       FROM (
         SELECT generate_series(
                  GREATEST(h.start_date, $3::date),
                  LEAST(h.end_date, $4::date),
                  INTERVAL '1 day')::date AS held_on
           FROM membership_holds h
           JOIN user_memberships m ON m.id = h.user_membership_id
          WHERE m.user_id = $1
            AND m.gym_id = $2
            AND m.status = 'ACTIVE'
            AND h.status = 'ACTIVE'
            AND h.start_date <= $4::date
            AND h.end_date >= $3::date
       ) days
    )::int AS held
`;

/** 목적별 키를 모두 0으로 채운 빈 달. 프론트가 키 존재를 확인하지 않아도 되게 한다 */
function emptyRevenue(month: string): MonthlyRevenueDto {
  return {
    month,
    total: 0,
    byPurpose: {
      [PaymentPurpose.MEMBERSHIP]: 0,
      [PaymentPurpose.PT_CONTRACT]: 0,
      [PaymentPurpose.TRANSFER_FEE]: 0,
    },
  };
}
