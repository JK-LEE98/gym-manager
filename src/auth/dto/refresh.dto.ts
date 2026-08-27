import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  /** 로그인 시 발급받은 Refresh Token */
  @IsString()
  refreshToken: string;
}

export class LogoutDto {
  /** 현재 기기의 Refresh Token. 생략하고 allDevices만 보낼 수도 있다 */
  @IsOptional()
  @IsString()
  refreshToken?: string;

  /** true면 해당 계정의 모든 기기에서 로그아웃한다 */
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
