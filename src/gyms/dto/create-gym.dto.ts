import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * 헬스장 등록 요청. SUPER_ADMIN만 호출한다.
 *
 * 헬스장과 OWNER 계정을 함께 받는 이유: 둘은 분리해서 만들 수 없다.
 * 계정 없는 헬스장은 아무도 운영할 수 없고, 소속 없는 OWNER는 존재할 수 없다.
 */
export class CreateGymDto {
  /** 헬스장 이름 */
  @IsString()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;

  /**
   * OWNER 계정 아이디.
   * 개인 계정이 아니라 헬스장 공용 운영 계정이므로 `gangnam_gym` 같은 형태를 권장한다. @see ADR-005
   */
  @IsString()
  @Length(4, 20)
  @Matches(/^[a-z0-9_]+$/, {
    message: '아이디는 영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다',
  })
  ownerLoginId: string;

  /** 초기 비밀번호. 최초 로그인 후 변경을 권장한다 */
  @IsString()
  @MinLength(8)
  ownerPassword: string;

  /** 예: "강남점 운영계정" */
  @IsString()
  @Length(1, 50)
  ownerName: string;
}

export class UpdateGymDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;
}
