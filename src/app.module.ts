import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { GymsModule } from './gyms/gyms.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    // Spring의 @PropertySource + @Value 역할
    // isGlobal: true → 모든 모듈에서 ConfigService 주입 가능
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Spring의 DataSource + JPA 설정 역할
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get('DB_USERNAME'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: config.get('NODE_ENV') === 'development', // 개발 환경에서만 자동 스키마 동기화
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),

    // 전역 기본 한도. 인증 엔드포인트는 @Throttle로 더 엄격하게 덮어쓴다.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    AuthModule,
    GymsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // 전역 Guard. 등록 순서가 곧 실행 순서다.
    // 1) Throttler — 인증 여부와 무관하게 먼저 유량을 제한한다
    // 2) JwtAuthGuard — request.user를 채운다
    // 3) RolesGuard — 채워진 role을 읽어 인가를 판단한다
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
