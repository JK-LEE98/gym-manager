import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import {
  UserMembership,
  MembershipStatus,
} from '../entities/user-membership.entity';
import { PaymentMethod } from '../entities/payment.entity';
import { daysUntil } from '../../common/utils/date.util';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class GrantMembershipDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  membershipTypeId: string;

  /**
   * 이용 시작일. 생략하면 서버가 계산한다.
   *
   * 같은 카테고리의 아직 끝나지 않은 회원권이 있으면 그 종료일 다음날,
   * 없으면 오늘. "오늘 결제하고 다음 주부터 이용" 같은 경우에만 직접 지정한다.
   */
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, {
    message: 'startDate는 YYYY-MM-DD 형식이어야 합니다',
  })
  startDate?: string;

  /**
   * 실제 결제 금액. 생략하면 회원권 종류의 정가를 사용한다.
   * 할인 판매를 위해 열어둔다.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  /** 결제 건별 자유 기록. 예: `*26.08.06 H12 + 락커12 [카 55만]` */
  @IsOptional()
  @IsString()
  memo?: string;
}

export class ExtendMembershipDto {
  /** 연장할 일수 */
  @IsInt()
  @Min(1)
  days: number;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class UserMembershipResponseDto {
  id: string;
  category: string;
  typeName: string;
  startDate: string;
  /** 마지막 이용 가능일 */
  endDate: string;
  /**
   * 만료까지 남은 일수. D-day 표기와 일치한다.
   * 0이면 오늘까지, 음수면 이미 만료.
   */
  daysUntilExpiry: number;
  status: MembershipStatus;
  memo: string | null;
  payment: {
    amount: number;
    method: PaymentMethod;
  } | null;

  static from(membership: UserMembership): UserMembershipResponseDto {
    const dto = new UserMembershipResponseDto();
    dto.id = membership.id;
    dto.category = membership.membershipType?.category ?? '';
    dto.typeName = membership.membershipType?.name ?? '';
    dto.startDate = membership.startDate;
    dto.endDate = membership.endDate;
    dto.daysUntilExpiry = daysUntil(membership.endDate);
    dto.status = membership.status;
    dto.memo = membership.memo;
    dto.payment = membership.payment
      ? {
          amount: membership.payment.amount,
          method: membership.payment.method,
        }
      : null;
    return dto;
  }
}
