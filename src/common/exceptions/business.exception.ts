import { HttpException } from '@nestjs/common';
import { ERROR_METADATA, ErrorCode } from '../enums/error-code.enum';

/**
 * 비즈니스 규칙 위반 예외.
 *
 * NestJS 내장 예외(NotFoundException 등)는 상태 코드만 표현할 수 있어
 * "왜 실패했는지"를 클라이언트에 전달하지 못한다. 이를 errorCode로 보완한다.
 *
 * @example
 * // 기본 메시지 사용
 * throw new BusinessException(ErrorCode.TENANT_MISMATCH);
 *
 * // 맥락이 필요할 때 메시지 덮어쓰기
 * throw new BusinessException(ErrorCode.NOT_FOUND, '존재하지 않는 헬스장입니다');
 */
export class BusinessException extends HttpException {
  readonly errorCode: ErrorCode;

  constructor(errorCode: ErrorCode, message?: string) {
    const meta = ERROR_METADATA[errorCode];
    super(message ?? meta.message, meta.status);
    this.errorCode = errorCode;
  }
}
