import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 인증 없이 접근 가능한 라우트로 표시한다.
 *
 * JwtAuthGuard가 전역으로 걸려 있으므로 기본은 "인증 필요"다.
 * Guard를 붙이는 것을 깜빡하면 엔드포인트가 조용히 열리지만,
 * @Public을 깜빡하면 접근이 막혀 즉시 발견된다. 실패하는 방향이 안전한 쪽을 택한 것이다.
 *
 * @example
 * @Public()
 * @Post('login')
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
