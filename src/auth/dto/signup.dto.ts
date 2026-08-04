import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * 회원가입 요청. MEMBER만 가입할 수 있다.
 *
 * role을 받지 않는 것이 중요하다. 필드가 없으면 ValidationPipe의 whitelist가
 * 클라이언트가 끼워넣은 role을 제거하므로 권한 상승이 원천 차단된다.
 */
export class SignupDto {
  /** 소속 헬스장 ID. GET /gyms/public 에서 조회 */
  @IsUUID()
  gymId: string;

  /** 로그인 아이디. 4~20자, 영문 소문자·숫자·밑줄 */
  @IsString()
  @Length(4, 20)
  @Matches(/^[a-z0-9_]+$/, {
    message: '아이디는 영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다',
  })
  loginId: string;

  /** 최소 8자 */
  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @Length(1, 50)
  name: string;

  /** 헬스장에서 실질적인 연락 수단이다 */
  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;
}
