import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { RefreshToken, RevokeReason } from './entities/refresh-token.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '../users/entities/user.entity';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';

/**
 * 토큰 생명주기 전담 서비스.
 *
 * 발급·해싱·저장·폐기를 담당한다. 가입/로그인 같은 비즈니스 흐름은 AuthService가 맡는다.
 * @see ADR-006
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  /**
   * Access + Refresh 토큰 쌍을 발급하고 Refresh 해시를 저장한다.
   *
   * 저장은 SHA-256 해시로 한다. bcrypt는 결정적이지 않아 인덱스 조회가 불가능하고,
   * Refresh Token은 서버가 만든 고엔트로피 값이라 느린 해싱의 이점이 없다.
   */
  async issueTokenPair(
    user: User,
    deviceInfo?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      gymId: user.gymId,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id },
      this.refreshSignOptions(),
    );

    // 로그인 시점에 만료분을 함께 정리한다. 별도 배치가 필요 없는 수준이다.
    await this.removeExpired(user.id);

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        deviceInfo: deviceInfo?.slice(0, 255) ?? null,
        expiresAt: this.refreshExpiresAt(),
      }),
    );

    return { accessToken, refreshToken };
  }

  /**
   * Refresh Token을 검증하고 폐기한 뒤 소유자 ID를 반환한다 (Rotation).
   *
   * 이 메서드를 통과한 토큰은 더 이상 사용할 수 없다.
   * 호출부는 반환된 userId로 사용자를 조회해 새 토큰 쌍을 발급한다.
   * (역할·소속이 바뀌었을 수 있으므로 토큰이 아닌 DB의 최신 값을 써야 한다)
   */
  async consumeRefreshToken(token: string): Promise<string> {
    // 1. 서명·만료 검증. 위조된 토큰은 여기서 걸러진다
    try {
      await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new BusinessException(ErrorCode.INVALID_REFRESH_TOKEN);
    }

    // 2. 저장된 해시로 조회. 서명이 유효해도 DB에 없으면 우리가 발급한 토큰이 아니다
    const stored = await this.findByToken(token);
    if (!stored) {
      throw new BusinessException(ErrorCode.INVALID_REFRESH_TOKEN);
    }

    // 3. 재사용 감지 — 폐기 사유에 따라 다르게 판단한다.
    if (stored.revokedAt) {
      // 정상 회전으로 교체된 토큰이 다시 왔다 = 누군가 옛 토큰을 들고 있다는 뜻.
      // 정상 사용자와 공격자 중 누가 보냈는지 알 수 없으므로 양쪽 모두 끊는다.
      if (stored.revokedReason === RevokeReason.ROTATED) {
        await this.revokeAllByUser(stored.userId, RevokeReason.REUSE_DETECTED);
        throw new BusinessException(ErrorCode.TOKEN_REUSE_DETECTED);
      }
      // 로그아웃·일괄 폐기된 토큰의 재제출은 클라이언트의 단순 재시도일 수 있다.
      // 이미 무효한 토큰이므로 거부만 하고 추가 조치는 하지 않는다.
      throw new BusinessException(ErrorCode.INVALID_REFRESH_TOKEN);
    }

    // 4. DB 기준 만료 확인 (JWT 만료와 별개로 이중 확인)
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new BusinessException(ErrorCode.REFRESH_TOKEN_EXPIRED);
    }

    // 5. 폐기 표시. 삭제하지 않아야 3번의 재사용 감지가 동작한다
    await this.revoke(stored.id, RevokeReason.ROTATED);

    return stored.userId;
  }

  /**
   * 특정 기기의 세션만 종료한다.
   * 토큰이 요청자 본인의 것인지 확인해 남의 세션을 끊지 못하게 한다.
   */
  async revokeByToken(token: string, userId: string): Promise<void> {
    const stored = await this.findByToken(token);
    if (!stored || stored.userId !== userId) return;
    if (stored.revokedAt) return;
    await this.revoke(stored.id, RevokeReason.LOGOUT);
  }

  /** SHA-256 hex. 결정적이라 tokenHash 인덱스로 단일 조회가 가능하다 */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  findByToken(token: string): Promise<RefreshToken | null> {
    return this.refreshTokenRepo.findOne({
      where: { tokenHash: this.hash(token) },
    });
  }

  /**
   * 폐기 표시. 삭제하지 않는다.
   * 삭제하면 "정상 만료"와 "재사용 공격"을 구분할 수 없기 때문이다.
   */
  async revoke(id: string, reason: RevokeReason): Promise<void> {
    await this.refreshTokenRepo.update(id, {
      revokedAt: new Date(),
      revokedReason: reason,
    });
  }

  /** 해당 유저의 모든 세션 종료. 재사용 감지·비밀번호 변경·계정 정지 시 사용한다 */
  async revokeAllByUser(userId: string, reason: RevokeReason): Promise<void> {
    // IsNull()로 미폐기 건만 대상으로 한다.
    // undefined를 쓰면 TypeORM이 조건에서 무시해 이미 폐기된 건의 시각·사유까지 덮어쓴다.
    await this.refreshTokenRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  private async removeExpired(userId: string): Promise<void> {
    await this.refreshTokenRepo.delete({
      userId,
      expiresAt: LessThan(new Date()),
    });
  }

  private refreshSignOptions(): JwtSignOptions {
    return {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    };
  }

  /** JWT 자체 만료와 별개로, DB에서도 만료를 판단할 수 있어야 정리·검증이 가능하다 */
  private refreshExpiresAt(): Date {
    const days = Number(
      this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN').replace('d', ''),
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    return expiresAt;
  }
}
