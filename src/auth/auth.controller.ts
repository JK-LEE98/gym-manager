import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshDto } from './dto/refresh.dto';
import { LoginResponseDto, UserResponseDto } from './dto/auth-response.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { ErrorCode } from '../common/enums/error-code.enum';

/** 인증 엔드포인트는 1분당 5회로 제한한다. 무차별 대입과 계정 열거를 함께 막는다 @see ADR-008 */
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('signup')
  @ResponseMessage('회원가입이 완료되었습니다')
  @ApiOperation({
    summary: '회원가입',
    description:
      'MEMBER 역할로만 가입할 수 있다. TRAINER는 OWNER가 승격시키고, OWNER는 SUPER_ADMIN이 발급한다.',
  })
  @ApiCommonResponse(UserResponseDto, {
    status: 201,
    message: '회원가입이 완료되었습니다',
  })
  @ApiErrorResponse(
    409,
    [ErrorCode.DUPLICATE_LOGIN_ID],
    '이미 사용 중인 아이디',
  )
  @ApiErrorResponse(404, [ErrorCode.GYM_NOT_FOUND], '존재하지 않는 헬스장')
  signup(@Body() dto: SignupDto): Promise<UserResponseDto> {
    return this.authService.signup(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ResponseMessage('로그인되었습니다')
  @ApiOperation({ summary: '로그인' })
  @ApiCommonResponse(LoginResponseDto, { message: '로그인되었습니다' })
  @ApiErrorResponse(
    401,
    [ErrorCode.INVALID_CREDENTIALS],
    '아이디 미존재와 비밀번호 불일치를 구분하지 않는다',
  )
  login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<LoginResponseDto> {
    return this.authService.login(dto, userAgent);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(200)
  @ResponseMessage('토큰이 갱신되었습니다')
  @ApiOperation({
    summary: '토큰 갱신',
    description:
      '기존 Refresh Token은 폐기되고 새 토큰 쌍이 발급된다(Rotation). ' +
      '이미 폐기된 토큰이 다시 제출되면 탈취로 간주해 해당 계정의 모든 세션을 종료한다.',
  })
  @ApiCommonResponse(LoginResponseDto, { message: '토큰이 갱신되었습니다' })
  @ApiErrorResponse(
    401,
    [
      ErrorCode.INVALID_REFRESH_TOKEN,
      ErrorCode.REFRESH_TOKEN_EXPIRED,
      ErrorCode.TOKEN_REUSE_DETECTED,
    ],
    '갱신 실패. TOKEN_REUSE_DETECTED는 전체 세션이 종료된 상태',
  )
  refresh(
    @Body() dto: RefreshDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<LoginResponseDto> {
    return this.authService.refresh(dto.refreshToken, userAgent);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: '로그아웃',
    description:
      'allDevices=true면 모든 기기의 세션을 종료한다. ' +
      'Access Token은 무효화할 수 없으므로 만료(1시간)까지는 유효하다.',
  })
  logout(
    @CurrentUser('sub') userId: string,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    return this.authService.logout(userId, dto.refreshToken, dto.allDevices);
  }

  @Get('me')
  @ApiOperation({ summary: '내 정보 조회' })
  @ApiCommonResponse(UserResponseDto)
  @ApiErrorResponse(401, [ErrorCode.UNAUTHORIZED], '토큰 없음 또는 만료')
  me(@CurrentUser('sub') userId: string): Promise<UserResponseDto> {
    return this.authService.me(userId);
  }
}
