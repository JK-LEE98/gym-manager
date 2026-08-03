import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';

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
    // Access Token 발급·검증용 기본 설정.
    // Refresh Token은 시크릿과 만료가 달라 서비스에서 signAsync 옵션으로 따로 지정한다.
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
  providers: [JwtStrategy],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
