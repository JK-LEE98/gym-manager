import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { QrTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';

/** QR 유효시간(초). 캡처해서 남에게 보내도 도착하면 이미 죽어 있는 길이 */
export const QR_TOKEN_TTL_SECONDS = 30;

/**
 * QR 출석용 단기 토큰 발급·검증.
 *
 * **Access Token과 시크릿을 분리한다.**
 * 같은 시크릿을 쓰면 `type` 필드 검증이 유일한 방어선이 되어,
 * 한 곳만 빠뜨려도 Access Token으로 출석이 가능해진다.
 * 시크릿을 나누면 서명 검증 단계에서 이미 걸러져 방어가 두 겹이 된다. @see ADR-013
 */
@Injectable()
export class QrTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.getOrThrow<string>('JWT_QR_SECRET');
  }

  async issue(userId: string, gymId: string): Promise<string> {
    const payload: QrTokenPayload = {
      sub: userId,
      gymId,
      type: 'ATTENDANCE',
    };

    return this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: QR_TOKEN_TTL_SECONDS,
    });
  }

  /**
   * 서명·만료·용도를 검증하고 payload를 돌려준다.
   *
   * `type` 검증을 빠뜨리면 30초 만료 설계가 통째로 무의미해진다.
   * 시크릿을 분리했으므로 지금은 서명 단계에서 먼저 걸러지지만,
   * **시크릿 설정이 잘못되는 상황까지 대비해 두 겹으로 확인한다.**
   */
  async verify(token: string): Promise<QrTokenPayload> {
    let payload: QrTokenPayload;

    try {
      payload = await this.jwt.verifyAsync<QrTokenPayload>(token, {
        secret: this.secret,
      });
    } catch {
      // 만료와 위조를 구분하지 않는다.
      // 회원에게는 "다시 발급받으세요"가 유일하게 유용한 안내이고,
      // 구분해서 알려주면 공격자에게 서명 유효 여부를 확인시켜주는 셈이 된다.
      throw new BusinessException(ErrorCode.QR_TOKEN_EXPIRED);
    }

    if (payload.type !== 'ATTENDANCE') {
      throw new BusinessException(ErrorCode.INVALID_TOKEN_TYPE);
    }

    return payload;
  }
}
