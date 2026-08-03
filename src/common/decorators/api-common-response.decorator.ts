import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorCode } from '../enums/error-code.enum';

/**
 * 성공 응답을 공통 포맷으로 문서화한다.
 *
 * TransformInterceptor가 런타임에 응답을 { success, data, message }로 감싸지만,
 * Swagger는 그 사실을 알지 못해 raw DTO만 표시한다. 이 데코레이터로 문서를 실제 응답과 맞춘다.
 *
 * @example
 * @Post('signup')
 * @ApiCommonResponse(UserResponseDto, { status: 201 })
 * async signup() { ... }
 */
export function ApiCommonResponse<TModel extends Type<unknown>>(
  model: TModel,
  options?: {
    status?: number;
    description?: string;
    isArray?: boolean;
    message?: string;
  },
) {
  return applyDecorators(
    // $ref로 참조할 모델을 Swagger 문서에 등록한다.
    // 컨트롤러가 직접 반환하지 않는 타입은 이 선언이 없으면 스키마에 포함되지 않는다.
    ApiExtraModels(model),
    ApiResponse({
      status: options?.status ?? 200,
      description: options?.description,
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          data: options?.isArray
            ? { type: 'array', items: { $ref: getSchemaPath(model) } }
            : { $ref: getSchemaPath(model) },
          message: {
            type: 'string',
            example: options?.message ?? '요청이 처리되었습니다',
          },
        },
      },
    }),
  );
}

/**
 * 실패 응답을 공통 포맷으로 문서화한다.
 *
 * 어떤 errorCode가 나올 수 있는지 명시해 클라이언트가 분기를 준비할 수 있게 한다.
 *
 * @example
 * @ApiErrorResponse(409, [ErrorCode.DUPLICATE_EMAIL], '이미 가입된 이메일')
 */
export function ApiErrorResponse(
  status: number,
  errorCodes: ErrorCode[],
  description?: string,
) {
  return ApiResponse({
    status,
    description: description ?? errorCodes.join(' | '),
    schema: {
      properties: {
        success: { type: 'boolean', example: false },
        data: { type: 'object', nullable: true, example: null },
        message: { type: 'string', example: '요청을 처리할 수 없습니다' },
        errorCode: {
          type: 'string',
          enum: errorCodes,
          example: errorCodes[0],
        },
      },
    },
  });
}
