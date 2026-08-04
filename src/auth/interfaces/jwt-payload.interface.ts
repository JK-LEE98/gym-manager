import { Role } from '../../common/enums/role.enum';

/**
 * Access Token의 payload.
 *
 * gymId를 담는 이유: 매 요청마다 DB를 조회하지 않고 테넌트를 식별하기 위함이다.
 * 클라이언트가 보낸 gymId는 절대 신뢰하지 않고 이 값만 사용한다. @see ADR-004
 */
export interface JwtPayload {
  /** userId. JWT 표준 클레임이라 sub를 사용한다 */
  sub: string;
  role: Role;
  /** SUPER_ADMIN만 null */
  gymId: string | null;
}

/** QR 출석용 단기 토큰. Access Token과 용도를 구분하기 위해 type을 둔다 */
export interface QrTokenPayload {
  sub: string;
  gymId: string;
  type: 'ATTENDANCE';
}
