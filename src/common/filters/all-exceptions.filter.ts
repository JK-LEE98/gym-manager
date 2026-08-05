import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ERROR_METADATA, ErrorCode } from '../enums/error-code.enum';
import { BusinessException } from '../exceptions/business.exception';
import { ApiErrorResponse } from '../interfaces/api-response.interface';

/**
 * NestJS 내장 예외를 상태 코드로 ErrorCode에 매핑.
 *
 * 키 타입을 HttpStatus가 아닌 number로 둔 이유:
 * `exception.getStatus()`가 number를 반환하므로, HttpStatus로 좁혀두면
 * 조회할 때마다 단언이 필요해진다. HTTP 상태 코드는 본래 숫자다.
 */
/** 이 값 이상이면 서버 오류로 간주해 스택을 로그에 남긴다 */
const SERVER_ERROR_THRESHOLD = 500;

const STATUS_TO_ERROR_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
};

/**
 * 전역 예외 필터. Spring의 @RestControllerAdvice에 해당한다.
 *
 * 처리 대상
 * 1. BusinessException      → errorCode/status/message 그대로 사용
 * 2. HttpException(내장)     → 상태 코드로 ErrorCode 추론
 * 3. 그 외 모든 예외         → 500. 원본은 로그에만 남기고 클라이언트에는 노출하지 않는다
 *
 * 3번이 중요하다. DB 에러 메시지나 스택 트레이스가 응답에 그대로 나가면
 * 테이블 구조·쿼리·내부 경로가 노출되어 공격의 단서가 된다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, errorCode, message } = this.resolve(exception);

    // status는 number이므로 HttpStatus enum과 직접 비교하지 않는다
    if (status >= SERVER_ERROR_THRESHOLD) {
      // 예상하지 못한 오류만 스택과 함께 남긴다
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} → ${status} ${errorCode}: ${message}`,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      data: null,
      message,
      errorCode,
    };

    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    errorCode: ErrorCode;
    message: string;
  } {
    // 1. 비즈니스 예외
    if (exception instanceof BusinessException) {
      return {
        status: exception.getStatus(),
        errorCode: exception.errorCode,
        message: exception.message,
      };
    }

    // 2. NestJS 내장 예외 (ValidationPipe 포함)
    if (exception instanceof HttpException) {
      const status: number = exception.getStatus();
      const mapped: ErrorCode | undefined = STATUS_TO_ERROR_CODE[status];

      return {
        status,
        errorCode:
          mapped ??
          (status >= SERVER_ERROR_THRESHOLD
            ? ErrorCode.INTERNAL_ERROR
            : ErrorCode.VALIDATION_FAILED),
        message: this.extractMessage(exception),
      };
    }

    // 3. 정의되지 않은 오류 — 내부 정보를 숨긴다
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ErrorCode.INTERNAL_ERROR,
      message: ERROR_METADATA[ErrorCode.INTERNAL_ERROR].message,
    };
  }

  /**
   * ValidationPipe는 검증 실패 메시지를 배열로 담아 던진다.
   * { message: ['email must be an email', 'password too short'], ... }
   */
  private extractMessage(exception: HttpException): string {
    const res = exception.getResponse();

    if (typeof res === 'string') return res;

    if (typeof res === 'object' && res !== null && 'message' in res) {
      const msg: unknown = res.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }

    return exception.message;
  }
}
