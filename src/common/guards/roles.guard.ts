import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { ErrorCode } from '../enums/error-code.enum';
import { BusinessException } from '../exceptions/business.exception';

/**
 * 역할 기반 인가 Guard. 전역으로 등록되며 JwtAuthGuard **다음에** 실행된다.
 *
 * JwtAuthGuard가 request.user를 채워야 여기서 role을 읽을 수 있으므로 순서가 중요하다.
 * AppModule의 APP_GUARD 등록 순서가 곧 실행 순서다.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // @Roles를 지정하지 않았으면 인증된 모든 역할이 접근 가능
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    // @Public과 @Roles를 함께 붙인 경우. 설정 실수이므로 막는다.
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    if (!requiredRoles.includes(user.role)) {
      throw new BusinessException(ErrorCode.FORBIDDEN);
    }

    return true;
  }
}
