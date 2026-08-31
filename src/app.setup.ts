import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
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
  // 브라우저가 다른 오리진에서 이 API를 부를 수 있게 한다.
  //
  // main.ts가 아니라 여기에 두는 이유는 두 가지다.
  // ① 이 함수의 원칙 — main과 E2E가 같은 설정을 쓴다
  // ② supertest로 프리플라이트 응답 헤더를 검증할 수 있다.
  //    main.ts에 두면 CORS만 테스트 밖에 남는다
  //
  // credentials는 켜지 않는다. 쿠키를 쓰지 않고 토큰을 응답 본문으로 내려
  // Authorization 헤더로 받으므로 필요가 없다. 필요 없는 권한을 열면
  // 오리진이 넓어졌을 때 그대로 취약점이 된다. → 향후 과제
  app.enableCors({
    origin: app
      .get(ConfigService)
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  });

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
