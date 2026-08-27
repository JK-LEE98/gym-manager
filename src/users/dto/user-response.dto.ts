import { User } from '../entities/user.entity';
import { Role } from '../../common/enums/role.enum';
import { UserMembershipResponseDto } from '../../memberships/dto/user-membership.dto';
import { AttendanceSummaryDto } from '../../stats/dto/stats.dto';

export class UserDetailResponseDto {
  id: string;
  loginId: string;
  name: string;
  phone: string | null;
  address: string | null;
  birthDate: string | null;
  /** 회원 전반의 특이사항. 결제 건별 기록은 회원권의 memo에 있다 */
  memo: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;

  /** role=TRAINER인 경우에만 존재 */
  trainerProfile?: {
    specialty: string | null;
    bio: string | null;
  };

  /**
   * 이용 중인 회원권. 카테고리별로 여러 건일 수 있다.
   *
   * 데스크에서 회원을 응대할 때 가장 먼저 보는 정보라 목록·상세 모두에 포함한다.
   * 만료된 것은 제외되며, 전체 이력은 `GET /memberships?userId=` 로 조회한다.
   */
  memberships?: UserMembershipResponseDto[];

  /**
   * 얼마나 나오고 있는가. **상세 조회에만 있다.**
   *
   * 회원권 배열 안이 아니라 밖에 있는 이유: 출석 기록에는 어느 회원권 때문에
   * 왔는지가 없어 헬스와 락커로 쪼갤 수 없다. 안에 넣으면 락커에도 `4/10`이 찍힌다.
   * 회원권별로 필요한 것은 남은 일수이고 그것은 `daysUntilExpiry`가 이미 준다.
   *
   * 목록에 넣지 않는 이유: 회원마다 집계 쿼리가 돌아 N+1이 된다. → 향후 과제
   *
   * 이용 중인 회원권이 없으면 `null`.
   */
  attendance?: AttendanceSummaryDto | null;

  static from(
    user: User,
    memberships?: UserMembershipResponseDto[],
    attendance?: AttendanceSummaryDto | null,
  ): UserDetailResponseDto {
    const dto = new UserDetailResponseDto();
    dto.id = user.id;
    dto.loginId = user.loginId;
    dto.name = user.name;
    dto.phone = user.phone;
    dto.address = user.address;
    dto.birthDate = user.birthDate;
    dto.memo = user.memo;
    dto.role = user.role;
    dto.isActive = user.isActive;
    dto.createdAt = user.createdAt;

    if (user.trainerProfile) {
      dto.trainerProfile = {
        specialty: user.trainerProfile.specialty,
        bio: user.trainerProfile.bio,
      };
    }
    if (memberships) {
      dto.memberships = memberships;
    }
    // 목록 응답에는 필드 자체를 만들지 않는다. null과 "조회하지 않음"은 다르다
    if (attendance !== undefined) {
      dto.attendance = attendance;
    }
    return dto;
  }
}

/** 비밀번호 초기화 결과. 임시 비밀번호는 이 응답에서 단 한 번만 노출된다 */
export class ResetPasswordResponseDto {
  temporaryPassword: string;
}
