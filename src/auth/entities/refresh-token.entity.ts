import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Refresh Token
 *
 * 한 User가 기기 수만큼 보유한다. 로그인마다 row 1개가 생성된다.
 *
 * 설계 근거 @see ADR-006
 * - tokenHash는 SHA-256. bcrypt는 인덱스 조회가 불가능해 순회 비교가 필요하지만,
 *   Refresh Token은 서버가 만든 고엔트로피 값이라 느린 해싱의 이점이 없다.
 * - 폐기 시 삭제하지 않고 revokedAt만 기록한다.
 *   삭제하면 "정상 만료"와 "재사용 공격"을 구분할 수 없기 때문이다.
 */
@Entity('refresh_tokens')
// 전체 로그아웃, 로그인된 기기 목록 조회
@Index('idx_refresh_tokens_user_revoked', ['userId', 'revokedAt'])
// 만료분 정리
@Index('idx_refresh_tokens_expires', ['expiresAt'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** SHA-256 hex = 64자 고정 */
  @Column({ name: 'token_hash', length: 64, unique: true })
  tokenHash: string;

  /** User-Agent 요약. 기기 목록 표시용 */
  @Column({ name: 'device_info', type: 'varchar', length: 255, nullable: true })
  deviceInfo: string | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  /** 폐기 시각. null이면 유효. 값이 있는데 재제출되면 재사용 공격 */
  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
