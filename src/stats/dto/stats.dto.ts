import { IsDateString, IsOptional } from 'class-validator';
import { PaymentPurpose } from '../../memberships/entities/payment.entity';

/**
 * 통계 조회 기간.
 *
 * 생략하면 최근 12개월(이번 달 포함)을 본다.
 * 데스크가 가장 자주 보는 화면이 "올해 어땠나"라서 기본값을 넓게 잡았다.
 */
export class StatsQueryDto {
  /** `YYYY-MM-DD`. 생략 시 11개월 전 1일 */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** `YYYY-MM-DD`. 생략 시 오늘 */
  @IsOptional()
  @IsDateString()
  to?: string;
}

/**
 * 한 달치 매출.
 *
 * **결제일에 전액 인식한다.** 8월에 55만원짜리 12개월권을 팔면 8월 매출이 55만원이다.
 * 회계상으로는 월 4.5만원씩 나누는 이연 인식이 맞지만,
 * 데스크가 보고 싶은 것은 "이번 달에 얼마 들어왔나"다. → 향후 과제
 */
export class MonthlyRevenueDto {
  /** `YYYY-MM` */
  month: string;

  /** `byPurpose`의 합 */
  total: number;

  /**
   * 목적별 매출. 해당 목적의 결제가 없어도 키는 항상 있고 값이 0이다.
   *
   * **섞이면 어디서 번 돈인지 알 수 없다.** 양도 수수료 5만원이
   * "헬스 12개월" 매출로 잡히던 문제 때문에 `Payment.purpose`를 추가했다. @see ADR-014
   */
  byPurpose: Record<PaymentPurpose, number>;
}

/** 한 달치 신규 회원 수 */
export class MonthlyMemberDto {
  /** `YYYY-MM` */
  month: string;

  /**
   * 그 달에 등록된 `role=MEMBER` 계정 수.
   *
   * **탈퇴(soft delete)한 회원도 센다.** "8월에 12명 등록했다"는
   * 나중에 누가 나가도 바뀌지 않는 사실이다.
   * 제외하면 지난달 숫자가 오늘 달라져 보고서를 다시 만들어야 한다.
   */
  newMembers: number;
}

/**
 * 트레이너별 PT 실적.
 *
 * **완료와 노쇼를 함께 준다.** 노쇼가 많은 트레이너는 일정 관리에 문제가 있을 수 있는데,
 * 완료 건수만 보면 그 신호가 보이지 않는다.
 */
export class TrainerStatsDto {
  trainerId: string;
  trainerName: string;

  /** 기간 내 `COMPLETED` 수업 수 */
  completed: number;

  /** 기간 내 `NO_SHOW` 수업 수. 차감 여부와 무관하게 센다 */
  noShow: number;
}

/**
 * 회원의 이용 일수.
 *
 * **회원권별로 나누지 않는다. 회원 한 명당 하나다.**
 * 출석 기록에는 어느 회원권 때문에 왔는지가 없어 헬스와 락커로 쪼갤 근거가 없다.
 * 회원권 안에 넣으면 락커에도 `4/10`이 찍히는데, 락커는 회원이 오든 안 오든 점유 중이다.
 *
 * 회원권별로 필요한 것은 남은 일수이고, 그것은 `daysUntilExpiry`가 이미 준다.
 */
export class AttendanceSummaryDto {
  /** 이용 중인 회원권 중 가장 이른 시작일 (`YYYY-MM-DD`) */
  from: string;

  /** `min(오늘, 가장 늦은 종료일)` (`YYYY-MM-DD`) */
  to: string;

  /** `from ~ to`의 출석일 수. 같은 날 여러 번 찍어도 1일 */
  attendedDays: number;

  /**
   * `from ~ to` 일수에서 ACTIVE 홀딩 일수를 뺀 값.
   *
   * **퍼센트로 만들지 않는다.** 헬스장 휴무일을 반영하지 않아 100%가 애초에 불가능한데,
   * 퍼센트로 보여주면 "100%가 정상"이라는 착각이 생긴다. → 향후 과제
   */
  usableDays: number;
}
