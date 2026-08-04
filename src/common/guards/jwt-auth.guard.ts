import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ErrorCode } from '../enums/error-code.enum';
import { BusinessException } from '../exceptions/business.exception';

/**
 * Access Token 검증 Guard. 전역으로 등록된다.
 *
 * @Public()이 붙은 라우트만 통과시키고, 나머지는 모두 토큰을 요구한다.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // 핸들러 → 컨트롤러 순으로 확인. 컨트롤러 전체를 @Public으로 열 수도 있다.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }

  /**
   * Passport 기본 동작은 UnauthorizedException을 던진다.
   * 응답 포맷을 통일하기 위해 BusinessException으로 바꾼다.
   */
  handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '유효하지 않은 토큰입니다',
      );
    }
    return user;
  }
}
