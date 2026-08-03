import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
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

    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // 전역 Guard. 등록 순서가 곧 실행 순서다.
    // JwtAuthGuard가 request.user를 채운 뒤에야 RolesGuard가 role을 읽을 수 있다.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
