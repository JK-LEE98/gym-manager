import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** 로그인 아이디 */
  @IsString()
  loginId: string;

  /** 비밀번호 */
  @IsString()
  @MinLength(1)
  password: string;
}
