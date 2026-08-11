/**
 * 이름의 가운데를 가린다.
 *
 * 출입구 화면은 지나가는 사람에게도 보이므로 풀네임을 띄우면 안 된다.
 * **마스킹은 반드시 서버에서 한다.** 클라이언트가 가리면 서버는 풀네임을 보내는 것이므로
 * 네트워크를 보면 그대로 노출되어 가린 의미가 없다. @see ADR-013
 *
 * @example
 * maskName('이준규')    // '이*규'
 * maskName('남궁민수')  // '남**수'
 * maskName('김철')      // '김*'
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  if (trimmed.length === 2) return `${trimmed[0]}*`;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return `${first}${'*'.repeat(trimmed.length - 2)}${last}`;
}
