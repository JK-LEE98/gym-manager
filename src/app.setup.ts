import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * 전역 파이프·인터셉터·필터 설정.
 *
 * main.ts와 E2E 테스트가 **같은 함수**를 쓴다.
 * 각자 설정하면 테스트가 실제 동작과 다른 환경을 검증하게 되고,
 * 설정을 하나 추가할 때 한쪽만 고치는 실수가 생긴다.
 */
export function configureApp(app: INestApplication): void {
  // Spring의 @Valid + BindingResult 역할
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 없는 필드는 자동 제거 (권한 상승 차단)
      forbidNonWhitelisted: true, // DTO에 없는 필드가 오면 400
      transform: true, // 쿼리스트링 등을 DTO 타입으로 변환
    }),
  );

  // 성공 응답 → { success, data, message }
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  // 모든 예외 → { success, data, message, errorCode }
  app.useGlobalFilters(new AllExceptionsFilter());
}
