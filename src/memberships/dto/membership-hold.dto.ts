import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { HoldStatus, MembershipHold } from '../entities/membership-hold.entity';
import { Role } from '../../common/enums/role.enum';
import { daysBetween, today } from '../../common/utils/date.util';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateHoldDto {
  @IsUUID()
  userMembershipId: string;

  /** 홀딩 시작일 (YYYY-MM-DD) */
  @IsString()
  @Matches(DATE_PATTERN, {
    message: 'startDate는 YYYY-MM-DD 형식이어야 합니다',
  })
  startDate: string;

  /** 마지막 홀딩일. 이 날까지 정지된다 */
  @IsString()
  @Matches(DATE_PATTERN, { message: 'endDate는 YYYY-MM-DD 형식이어야 합니다' })
  endDate: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateHoldDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, {
    message: 'startDate는 YYYY-MM-DD 형식이어야 합니다',
  })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'endDate는 YYYY-MM-DD 형식이어야 합니다' })
  endDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

/** 홀딩의 진행 상태. 저장하지 않고 날짜로 판단한다 */
export type HoldPhase = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export class HoldResponseDto {
  id: string;
  userMembershipId: string;
  startDate: string;
  endDate: string;
  /** 홀딩 일수 (양끝 포함) */
  days: number;
  /** 날짜로 판단한 진행 상태 */
  phase: HoldPhase;
  /** MEMBER면 회원이 직접, OWNER면 데스크 대행 */
  createdByRole: Role;
  reason: string | null;
  createdAt: Date;

  static from(hold: MembershipHold): HoldResponseDto {
    const dto = new HoldResponseDto();
    dto.id = hold.id;
    dto.userMembershipId = hold.userMembershipId;
    dto.startDate = hold.startDate;
    dto.endDate = hold.endDate;
    dto.days = daysBetween(hold.startDate, hold.endDate) + 1;
    dto.phase = resolvePhase(hold);
    dto.createdByRole = hold.createdByRole;
    dto.reason = hold.reason;
    dto.createdAt = hold.createdAt;
    return dto;
  }
}

function resolvePhase(hold: MembershipHold): HoldPhase {
  if (hold.status === HoldStatus.CANCELLED) return 'CANCELLED';

  const now = today();
  if (daysBetween(now, hold.startDate) > 0) return 'SCHEDULED';
  if (daysBetween(now, hold.endDate) < 0) return 'COMPLETED';
  return 'IN_PROGRESS';
}
