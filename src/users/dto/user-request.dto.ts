import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { PaginationQueryDto } from '../../common/dto/paginated-response.dto';

/**
 * OWNER가 데스크에서 회원을 직접 등록할 때 사용한다.
 *
 * 공개 회원가입(`POST /auth/signup`)과 달리 `gymId`를 받지 않는다.
 * 요청자의 토큰에서 추출하므로 다른 헬스장에 회원을 만들 수 없다. @see ADR-004
 */
export class CreateUserDto {
  @IsString()
  @Length(4, 20)
  @Matches(/^[a-z0-9_]+$/, {
    message: '아이디는 영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다',
  })
  loginId: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @Length(1, 50)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  /** YYYY-MM-DD */
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  /** 회원 전반의 특이사항. 형식을 강제하지 않는다 */
  @IsOptional()
  @IsString()
  memo?: string;

  /** 생략 시 MEMBER. OWNER·SUPER_ADMIN은 지정할 수 없다 */
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdateRoleDto {
  /** MEMBER ↔ TRAINER 만 가능 */
  @IsEnum(Role)
  role: Role;
}

export class ChangePasswordDto {
  /** 세션 탈취 상태에서 비밀번호가 바뀌는 것을 막기 위해 현재 비밀번호를 확인한다 */
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

/**
 * 회원 목록의 상태 탭.
 *
 * 실제 헬스장 소프트웨어의 회원 화면이 이렇게 나뉘어 있다. @see 도메인 지식 10장
 *
 * **어느 값도 `UserMembership.status`에 그대로 대응하지 않는다.**
 * 만료는 `endDate`로, 홀딩은 `MembershipHold`와 날짜로 계산한다. @see ADR-010, ADR-011
 */
export enum MembershipFilter {
  ALL = 'ALL',
  /** 이용 기간 안이고 홀딩 중이 아님 */
  ACTIVE = 'ACTIVE',
  /** 오늘이 홀딩 기간 안 */
  ON_HOLD = 'ON_HOLD',
  /** 만료까지 14일 이내 */
  EXPIRING = 'EXPIRING',
  /** 이용 기간이 지남. 기간 제한 없이 전부 */
  EXPIRED = 'EXPIRED',
  /** 회원권을 한 번도 사지 않았거나 전부 취소됨 */
  NONE = 'NONE',
}

/** `EXPIRING` 탭의 기준. 2주 안에 연락해야 재등록이 붙는다 */
export const EXPIRING_THRESHOLD_DAYS = 14;

export class UserQueryDto extends PaginationQueryDto {
  /** 이름 부분 검색 */
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  /** 화면 탭. 사람이 훑어보는 용도다 */
  @IsOptional()
  @IsEnum(MembershipFilter)
  membershipStatus?: MembershipFilter;

  /**
   * 아래 필터들이 볼 회원권 카테고리. 생략하면 전체.
   *
   * 헬스가 D-3인데 락커가 D-95면, 뭉쳐서 보면 임박 목록에서 빠진다.
   */
  @IsOptional()
  @IsString()
  category?: string;

  /**
   * **정확히** N일 남은 회원. 범위가 아니다.
   *
   * "7일 이내"로 만들면 D-7·D-5·D-3이 섞여
   * 매일 돌릴 때 한 사람에게 문자가 여러 번 간다.
   * 중복 발송 방지가 이 필터의 존재 이유다. @see ADR-015
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expiringInDays?: number;

  /**
   * N일 **이내에** 만료된 회원. 복귀 홍보용이므로 범위가 맞다.
   *
   * 한 명씩 정확히 뽑을 이유가 없다.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiredWithinDays?: number;

  /**
   * 운동을 시작한 지 N일 이내인 회원. 쿠폰·만족도 조사 대상.
   *
   * 공백이 365일 이상이면 새로 시작한 것으로 본다. @see 도메인 지식 8장
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startedWithinDays?: number;
}
