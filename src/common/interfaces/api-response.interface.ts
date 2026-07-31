import { ErrorCode } from '../enums/error-code.enum';

/**
 * 모든 API 응답의 공통 포맷.
 *
 * 성공/실패를 success 플래그로 판별하는 판별 유니온(discriminated union)이다.
 * 클라이언트는 success만 보고 data와 errorCode 중 무엇을 읽을지 결정할 수 있다.
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  data: null;
  message: string;
  errorCode: ErrorCode;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
