import { IsInt, IsOptional, Max, Min } from 'class-validator';
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
  dailyEntryLimit: number | null;
  reentryGraceMinutes: number;
  createdAt: Date;

  static from(gym: Gym): GymResponseDto {
    const dto = new GymResponseDto();
    dto.id = gym.id;
    dto.name = gym.name;
    dto.address = gym.address;
    dto.phone = gym.phone;
    dto.isActive = gym.isActive;
    dto.dailyEntryLimit = gym.dailyEntryLimit;
    dto.reentryGraceMinutes = gym.reentryGraceMinutes;
    dto.createdAt = gym.createdAt;
    return dto;
  }
}

/**
 * 출입 정책 설정.
 *
 * QR의 역할이 헬스장마다 달라 같은 코드로 두 가지를 지원해야 한다.
 * 데스크가 있고 기록용으로만 찍는 곳과, QR을 찍어야 문이 열리는
 * 24시 무인 헬스장은 필요한 동작이 다르다. @see ADR-013
 */
export class UpdateEntryPolicyDto {
  /**
   * 하루 입장 가능 횟수. `null`을 보내면 무제한으로 되돌린다.
   *
   * 생략(`undefined`)과 `null`은 다르다. 생략은 "안 바꿈", null은 "무제한으로".
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyEntryLimit?: number | null;

  /**
   * 재출입 유예 시간(분). `0`이면 재출입 기능을 쓰지 않는다.
   *
   * 길게 잡을수록 그 시간 안에는 다른 사람이 찍어도 통과하므로
   * 짧을수록 안전하다. 상한을 240분으로 둔다.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  reentryGraceMinutes?: number;
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
