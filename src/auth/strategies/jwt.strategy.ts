import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Access Token 검증 전략.
 *
 * Spring Security의 JwtAuthenticationFilter + UserDetailsService에 해당한다.
 * validate()의 반환값이 request.user에 담긴다.
 * (Node는 싱글 스레드라 SecurityContextHolder 같은 ThreadLocal 방식을 쓸 수 없다)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * 서명·만료 검증을 통과한 payload가 전달된다.
   *
   * DB를 조회하지 않는다. Access Token 수명이 1시간이므로
   * 계정 정지 후 최대 1시간까지 토큰이 유효하다는 트레이드오프를 감수한다.
   * 매 요청마다 조회하면 stateless JWT의 이점이 사라진다.
   * 즉시 차단이 필요해지면 Refresh Token 폐기 + 짧은 Access 수명으로 대응한다.
   */
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
