import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 전역 파이프·인터셉터·필터. E2E 테스트도 같은 함수를 사용한다
  configureApp(app);

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

// void로 표시해 "의도적으로 결과를 기다리지 않음"을 명시한다.
// 최상위에서 await할 수 없고, 실패 시 Node가 프로세스를 종료시킨다
void bootstrap();
