import { Role } from '../../common/enums/role.enum';
import { User } from '../../users/entities/user.entity';

/**
 * 응답에 노출할 사용자 정보.
 *
 * Entity를 그대로 반환하지 않는 이유: 지금은 password가 select:false라 안전하지만,
 * 컬럼이 늘어날 때마다 노출 여부를 재검토해야 한다.
 * 노출할 필드를 명시적으로 나열하면 실수로 새는 경로가 없다.
 */
export class UserResponseDto {
  id: string;
  loginId: string;
  name: string;
  phone: string | null;
  role: Role;
  /** SUPER_ADMIN만 null */
  gymId: string | null;

  static from(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.loginId = user.loginId;
    dto.name = user.name;
    dto.phone = user.phone;
    dto.role = user.role;
    dto.gymId = user.gymId;
    return dto;
  }
}

export class LoginResponseDto {
  /** 유효기간 1시간 */
  accessToken: string;
  /** 유효기간 30일. 갱신 시마다 새 값으로 교체된다 */
  refreshToken: string;
  user: UserResponseDto;
}
