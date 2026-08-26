import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { GymsModule } from './gyms/gyms.module';
import { UsersModule } from './users/users.module';
import { MembershipsModule } from './memberships/memberships.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PTModule } from './pt/pt.module';
import { StatsModule } from './stats/stats.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import {
  envValidationOptions,
  envValidationSchema,
} from './common/config/env.validation';

@Module({
  imports: [
    // Spring의 @PropertySource + @Value 역할
    // isGlobal: true → 모든 모듈에서 ConfigService 주입 가능
    ConfigModule.forRoot({
      isGlobal: true,
      // 테스트는 별도 DB를 바라봐야 개발 데이터를 지우지 않는다
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      // 형식이 틀린 값은 여기서 막는다. getOrThrow는 존재 여부만 보기 때문이다
      validationSchema: envValidationSchema,
      validationOptions: envValidationOptions,
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
        migrations: [__dirname + '/common/database/migrations/*{.ts,.js}'],

        // **모든 환경에서 끈다.** 컬럼 삭제·타입 변경 시 데이터가 소실된다.
        //
        // 개발·테스트도 예외를 두지 않는 이유: 켜두면 Entity를 고칠 때
        // synchronize가 알아서 맞춰줘 **마이그레이션을 만들지 않아도 테스트가 통과한다.**
        // 그러면 운영을 지키려고 만든 마이그레이션이 한 번도 검증되지 않는다.
        synchronize: false,

        // 스키마는 마이그레이션이 만든다. 이미 적용된 것은 건너뛰므로 매 기동이 안전하다.
        //
        // 확장 설치도 마이그레이션 안으로 들어갔다.
        // 확장은 스키마의 일부이고, 앱이 처음 붙기 전에 이미 있어야 한다.
        migrationsRun: true,

        // 테스트에서는 쿼리 로그가 출력을 뒤덮어 결과를 읽기 어렵다
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),

    // 전역 기본 한도. 인증 엔드포인트는 @Throttle로 더 엄격하게 덮어쓴다.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      // E2E는 한 시나리오에서 로그인·갱신을 여러 번 호출해 인증 한도(1분 5회)에 즉시 걸린다.
      // 유량 제한 자체는 테스트 대상이 아니므로 테스트 환경에서만 건너뛴다.
      //
      // TestingModule의 overrideGuard로는 해결되지 않는다.
      // APP_GUARD를 useClass로 등록하면 ThrottlerGuard 토큰을 거치지 않고
      // 새 인스턴스를 직접 생성하기 때문이다.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),

    AuthModule,
    GymsModule,
    UsersModule,
    MembershipsModule,
    AttendanceModule,
    PTModule,
    StatsModule,
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
