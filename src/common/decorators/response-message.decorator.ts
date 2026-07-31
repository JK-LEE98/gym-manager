import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/**
 * 성공 응답의 message를 지정한다. 생략하면 기본 문구가 사용된다.
 *
 * Interceptor는 컨트롤러가 무슨 일을 하는지 알 수 없으므로,
 * 핸들러에 메타데이터로 남겨두고 Reflector로 꺼내 쓴다.
 *
 * @example
 * @Post('signup')
 * @ResponseMessage('회원가입이 완료되었습니다')
 * async signup() { ... }
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
