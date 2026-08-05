import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
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

export class UserQueryDto extends PaginationQueryDto {
  /** 이름 부분 검색 */
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
