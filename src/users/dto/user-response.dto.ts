import { User } from '../entities/user.entity';
import { Role } from '../../common/enums/role.enum';

export class UserDetailResponseDto {
  id: string;
  loginId: string;
  name: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  /** role=TRAINER인 경우에만 존재 */
  trainerProfile?: {
    specialty: string | null;
    bio: string | null;
  };

  static from(user: User): UserDetailResponseDto {
    const dto = new UserDetailResponseDto();
    dto.id = user.id;
    dto.loginId = user.loginId;
    dto.name = user.name;
    dto.phone = user.phone;
    dto.role = user.role;
    dto.isActive = user.isActive;
    dto.createdAt = user.createdAt;

    if (user.trainerProfile) {
      dto.trainerProfile = {
        specialty: user.trainerProfile.specialty,
        bio: user.trainerProfile.bio,
      };
    }
    return dto;
  }
}

/** 비밀번호 초기화 결과. 임시 비밀번호는 이 응답에서 단 한 번만 노출된다 */
export class ResetPasswordResponseDto {
  temporaryPassword: string;
}
