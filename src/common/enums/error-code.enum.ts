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

  // --- 인증 ---
  /** 로그인 실패. 아이디 미존재와 비밀번호 불일치를 구분하지 않는다 @see ADR-008 */
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  /** 아이디 중복 */
  DUPLICATE_LOGIN_ID = 'DUPLICATE_LOGIN_ID',
  /** Refresh Token이 위조되었거나 DB에 없음 */
  INVALID_REFRESH_TOKEN = 'INVALID_REFRESH_TOKEN',
  /** Refresh Token 만료 */
  REFRESH_TOKEN_EXPIRED = 'REFRESH_TOKEN_EXPIRED',
  /** 이미 폐기된 토큰이 재제출됨. 탈취로 간주하고 전체 세션을 종료한다 @see ADR-006 */
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',

  /** 본인 비밀번호 변경 시 현재 비밀번호 불일치 */
  INVALID_CURRENT_PASSWORD = 'INVALID_CURRENT_PASSWORD',

  // --- 사용자 ---
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  /** 허용되지 않는 역할 변경 (OWNER·SUPER_ADMIN 관련) */
  INVALID_ROLE_CHANGE = 'INVALID_ROLE_CHANGE',

  // --- 회원권 ---
  MEMBERSHIP_TYPE_NOT_FOUND = 'MEMBERSHIP_TYPE_NOT_FOUND',
  /** 판매 중지된 종류로 부여 시도 */
  MEMBERSHIP_TYPE_INACTIVE = 'MEMBERSHIP_TYPE_INACTIVE',
  MEMBERSHIP_NOT_FOUND = 'MEMBERSHIP_NOT_FOUND',
  /** 이미 취소되었거나 정지 상태에서 허용되지 않는 조작 */
  INVALID_MEMBERSHIP_STATUS = 'INVALID_MEMBERSHIP_STATUS',

  // --- 헬스장 ---
  GYM_NOT_FOUND = 'GYM_NOT_FOUND',
  /** 구독 해지 등으로 비활성화된 헬스장 */
  GYM_INACTIVE = 'GYM_INACTIVE',
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
  [ErrorCode.INVALID_CREDENTIALS]: {
    status: HttpStatus.UNAUTHORIZED,
    // 아이디 미존재와 비밀번호 불일치를 구분하지 않는다
    message: '아이디 또는 비밀번호가 올바르지 않습니다',
  },
  [ErrorCode.DUPLICATE_LOGIN_ID]: {
    status: HttpStatus.CONFLICT,
    message: '이미 사용 중인 아이디입니다',
  },
  [ErrorCode.INVALID_REFRESH_TOKEN]: {
    status: HttpStatus.UNAUTHORIZED,
    message: '유효하지 않은 갱신 토큰입니다',
  },
  [ErrorCode.REFRESH_TOKEN_EXPIRED]: {
    status: HttpStatus.UNAUTHORIZED,
    message: '갱신 토큰이 만료되었습니다. 다시 로그인해 주세요',
  },
  [ErrorCode.TOKEN_REUSE_DETECTED]: {
    status: HttpStatus.UNAUTHORIZED,
    // 공격자에게 감지 사실을 알릴 필요는 없으므로 일반적인 문구를 쓴다
    message: '보안상의 이유로 모든 세션이 종료되었습니다. 다시 로그인해 주세요',
  },
  [ErrorCode.INVALID_CURRENT_PASSWORD]: {
    status: HttpStatus.UNAUTHORIZED,
    message: '현재 비밀번호가 올바르지 않습니다',
  },
  [ErrorCode.USER_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: '존재하지 않는 회원입니다',
  },
  [ErrorCode.INVALID_ROLE_CHANGE]: {
    status: HttpStatus.BAD_REQUEST,
    message: '허용되지 않는 역할 변경입니다',
  },
  [ErrorCode.MEMBERSHIP_TYPE_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: '존재하지 않는 회원권 종류입니다',
  },
  [ErrorCode.MEMBERSHIP_TYPE_INACTIVE]: {
    status: HttpStatus.BAD_REQUEST,
    message: '판매가 중지된 회원권입니다',
  },
  [ErrorCode.MEMBERSHIP_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: '존재하지 않는 회원권입니다',
  },
  [ErrorCode.INVALID_MEMBERSHIP_STATUS]: {
    status: HttpStatus.CONFLICT,
    message: '현재 상태에서는 처리할 수 없습니다',
  },
  [ErrorCode.GYM_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: '존재하지 않는 헬스장입니다',
  },
  [ErrorCode.GYM_INACTIVE]: {
    status: HttpStatus.FORBIDDEN,
    message: '현재 이용할 수 없는 헬스장입니다',
  },
};
