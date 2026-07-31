import { HttpStatus } from '@nestjs/common';

/**
 * 비즈니스 에러 코드
 *
 * 클라이언트가 문자열 비교로 분기할 수 있도록 안정적인 식별자를 제공한다.
 * HTTP 상태 코드만으로는 "왜 403인지"를 구분할 수 없기 때문이다.
 *
 * 도메인별 코드(DUPLICATE_EMAIL, SLOT_NOT_AVAILABLE 등)는
 * 해당 모듈을 구현할 때 추가한다. 지금은 공통 코드만 정의한다.
 */
export enum ErrorCode {
  /** DTO 검증 실패 */
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  /** 토큰 없음 / 만료 / 위조 */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** 인증은 됐으나 권한 부족 */
  FORBIDDEN = 'FORBIDDEN',
  /** 리소스 없음 */
  NOT_FOUND = 'NOT_FOUND',
  /** 다른 헬스장의 리소스 접근 시도 @see ADR-004 */
  TENANT_MISMATCH = 'TENANT_MISMATCH',
  /** 정의되지 않은 서버 오류 */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * 에러 코드별 기본 HTTP 상태와 메시지.
 *
 * 같은 상황에 대해 매번 다른 문구가 나가는 것을 막기 위해 한 곳에서 관리한다.
 * 맥락이 필요한 경우 BusinessException 생성자에서 message를 덮어쓸 수 있다.
 */
export const ERROR_METADATA: Record<
  ErrorCode,
  { status: HttpStatus; message: string }
> = {
  [ErrorCode.VALIDATION_FAILED]: {
    status: HttpStatus.BAD_REQUEST,
    message: '입력값이 올바르지 않습니다',
  },
  [ErrorCode.UNAUTHORIZED]: {
    status: HttpStatus.UNAUTHORIZED,
    message: '인증이 필요합니다',
  },
  [ErrorCode.FORBIDDEN]: {
    status: HttpStatus.FORBIDDEN,
    message: '권한이 없습니다',
  },
  [ErrorCode.NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: '요청한 리소스를 찾을 수 없습니다',
  },
  [ErrorCode.TENANT_MISMATCH]: {
    status: HttpStatus.FORBIDDEN,
    message: '접근할 수 없는 리소스입니다',
  },
  [ErrorCode.INTERNAL_ERROR]: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '서버 오류가 발생했습니다',
  },
};
