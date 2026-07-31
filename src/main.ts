import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Spring의 @Valid + BindingResult 역할
  // DTO에 붙인 class-validator 데코레이터를 전역으로 활성화
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 없는 필드는 자동으로 제거
      forbidNonWhitelisted: true, // DTO에 없는 필드가 오면 400 에러
      transform: true, // 요청 데이터를 DTO 타입으로 자동 변환
    }),
  );

  // 성공 응답 → { success, data, message } 자동 래핑
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  // 모든 예외 → { success, data, message, errorCode } 통일
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger 설정 (Spring의 Springdoc과 동일한 역할)
  const config = new DocumentBuilder()
    .setTitle('Gym Manager API')
    .setDescription('헬스장 회원관리 서비스 API 문서')
    .setVersion('1.0')
    .addBearerAuth() // JWT 인증 헤더 추가
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document); // /api-docs 에서 확인 가능

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📄 Swagger: http://localhost:${port}/api-docs`);
}
bootstrap();
