import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

/**
 * JwtStrategy.validate()가 반환해 request.user에 담긴 값을 꺼낸다.
 * Spring의 @AuthenticationPrincipal에 해당한다.
 *
 * 인자로 키를 주면 해당 필드만 반환한다.
 * 테넌트 식별에는 반드시 이 경로로 gymId를 얻는다.
 * 클라이언트가 body/query로 보낸 gymId는 신뢰하지 않는다. @see ADR-004
 *
 * @example
 * getMe(@CurrentUser() user: JwtPayload) { ... }
 * findAll(@CurrentUser('gymId') gymId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (key: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) return undefined;
    return key ? user[key] : user;
  },
);
