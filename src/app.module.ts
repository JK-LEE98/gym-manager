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
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    // Spring의 @PropertySource + @Value 역할
    // isGlobal: true → 모든 모듈에서 ConfigService 주입 가능
    ConfigModule.forRoot({
      isGlobal: true,
      // 테스트는 별도 DB를 바라봐야 개발 데이터를 지우지 않는다
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
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
        // 운영에서는 절대 켜지 않는다. 컬럼 삭제·타입 변경 시 데이터가 소실될 수 있다.
        // 운영 배포 시 마이그레이션으로 전환한다 → 향후 과제
        synchronize: ['development', 'test'].includes(
          config.get<string>('NODE_ENV') ?? '',
        ),
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
