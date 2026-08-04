import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/entities/user.entity';
import { Gym } from '../gyms/entities/gym.entity';

/** `.env`에서 읽은 문자열을 expiresIn이 요구하는 타입으로 좁힌다.
 *
 * expiresIn은 `"1h"`, `"30d"` 같은 형태만 허용하는 템플릿 리터럴 타입인데,
 * ConfigService는 임의의 string을 반환하므로 그대로는 할당되지 않는다.
 * 값의 유효성은 런타임에 jsonwebtoken이 검증한다. */
const toExpiresIn = (value: string): JwtSignOptions['expiresIn'] =>
  value as JwtSignOptions['expiresIn'];

@Module({
  imports: [
    PassportModule,
    // 각 모듈이 필요한 Repository만 등록한다.
    // UsersModule/GymsModule은 해당 기능을 구현할 때 만든다.
    TypeOrmModule.forFeature([User, Gym, RefreshToken]),
    // Access Token 발급·검증용 기본 설정.
    // Refresh Token은 시크릿과 만료가 달라 TokenService에서 signAsync 옵션으로 따로 지정한다.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: toExpiresIn(
            config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService, TokenService],
  exports: [JwtModule, PassportModule, TokenService],
})
export class AuthModule {}
