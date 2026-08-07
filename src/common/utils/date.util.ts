/**
 * 날짜 계산 유틸.
 *
 * DB의 `date` 컬럼은 시각 없이 날짜만 담으므로 `'YYYY-MM-DD'` 문자열로 다룬다.
 * Date 객체로 주고받으면 시각·타임존이 섞여 들어와 하루씩 어긋나는 사고가 난다.
 *
 * "오늘"은 프로세스 타임존 기준이며, 컨테이너는 `TZ=Asia/Seoul`로 고정되어 있다.
 * UTC로 두면 한국 시간 오전 9시 이전에 하루 전으로 계산된다. @see ADR-010
 */

/** `'YYYY-MM-DD'` */
export type DateString = string;

function format(date: Date): DateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `new Date('2026-08-06')`은 UTC 자정으로 해석된다.
 * 타임존에 따라 날짜가 밀릴 수 있으므로 구성요소로 직접 만든다.
 */
function parse(value: DateString): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** 프로세스 타임존 기준 오늘 */
export function today(): DateString {
  return format(new Date());
}

export function addDays(value: DateString, days: number): DateString {
  const date = parse(value);
  date.setDate(date.getDate() + days);
  return format(date);
}

/**
 * `to - from` 을 일 단위로 반환한다.
 *
 * `Date.UTC`로 환산해 계산하는 이유: 로컬 시각으로 빼면 서머타임 전환일에
 * 23시간·25시간이 나와 하루가 어긋난다. 한국은 서머타임이 없지만
 * 날짜 계산을 타임존에 의존시키지 않는 편이 안전하다.
 */
export function daysBetween(from: DateString, to: DateString): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);

  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);

  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * 만료까지 남은 일수. 한국식 D-day 표기와 일치한다.
 *
 * ```
 * 만료일이 오늘   →  0   (D-day, 오늘까지 이용 가능)
 * 만료일이 내일   →  1   (D-1)
 * 이미 만료       → 음수
 * ```
 *
 * "N일 남음"은 당일 포함 여부가 애매해 쓰지 않는다. @see ADR-010
 */
export function daysUntil(endDate: DateString): number {
  return daysBetween(today(), endDate);
}

/** 만료 여부. `status`에 저장하지 않고 매번 계산한다 */
export function isExpired(endDate: DateString): boolean {
  return daysUntil(endDate) < 0;
}
