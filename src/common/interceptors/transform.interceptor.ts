import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { ApiSuccessResponse } from '../interfaces/api-response.interface';

const DEFAULT_MESSAGE = '요청이 처리되었습니다';

/**
 * 성공 응답을 공통 포맷으로 감싼다.
 *
 * Spring의 ResponseBodyAdvice와 같은 역할이다.
 * Controller/Service는 순수 데이터만 반환하고, 포장은 여기서 일괄 처리한다.
 * 컨트롤러마다 손으로 감싸면 반드시 누락되는 곳이 생기기 때문이다.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      DEFAULT_MESSAGE;

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        message,
      })),
    );
  }
}
