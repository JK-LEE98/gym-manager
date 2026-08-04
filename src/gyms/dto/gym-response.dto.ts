import { Gym } from '../entities/gym.entity';
import { User } from '../../users/entities/user.entity';
import { Role } from '../../common/enums/role.enum';

/** 인증된 사용자에게 노출하는 헬스장 정보 */
export class GymResponseDto {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;

  static from(gym: Gym): GymResponseDto {
    const dto = new GymResponseDto();
    dto.id = gym.id;
    dto.name = gym.name;
    dto.address = gym.address;
    dto.phone = gym.phone;
    dto.isActive = gym.isActive;
    dto.createdAt = gym.createdAt;
    return dto;
  }
}

/**
 * 회원가입 화면에서 헬스장을 고를 때 쓰는 공개 정보.
 *
 * 인증 없이 접근 가능하므로 필드를 최소로 제한한다.
 * 전화번호나 활성 상태는 가입자가 알 필요가 없고, 노출하면 영업 정보가 된다.
 */
export class PublicGymResponseDto {
  id: string;
  name: string;
  address: string | null;

  static from(gym: Gym): PublicGymResponseDto {
    const dto = new PublicGymResponseDto();
    dto.id = gym.id;
    dto.name = gym.name;
    dto.address = gym.address;
    return dto;
  }
}

export class GymOwnerResponseDto {
  id: string;
  loginId: string;
  name: string;
  role: Role;

  static from(user: User): GymOwnerResponseDto {
    const dto = new GymOwnerResponseDto();
    dto.id = user.id;
    dto.loginId = user.loginId;
    dto.name = user.name;
    dto.role = user.role;
    return dto;
  }
}

/** 헬스장 등록 결과. 생성된 OWNER 계정을 함께 반환해 발급 정보를 전달할 수 있게 한다 */
export class CreateGymResponseDto {
  gym: GymResponseDto;
  owner: GymOwnerResponseDto;
}
