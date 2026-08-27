import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * 헬스장 (테넌트)
 *
 * 멀티테넌시의 기준 단위. 대부분의 테이블이 이 id를 gymId로 참조한다.
 * @see ADR-004
 */
@Entity('gyms')
export class Gym {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  /** 서비스 이용 여부. 구독 해지 시 false → 소속 유저 로그인 차단 */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /**
   * 하루 입장 가능 횟수. null이면 무제한.
   *
   * 헬스장마다 정책이 다르다. 제한 없는 곳, 하루 2회(오전·저녁), 하루 1회가 모두 있다.
   * @see ADR-013
   */
  @Column({ name: 'daily_entry_limit', type: 'int', nullable: true })
  dailyEntryLimit: number | null;

  /**
   * 이 시간(분) 안의 재스캔은 **같은 입장**으로 본다. 0이면 재출입 기능 미사용.
   *
   * QR의 역할이 헬스장마다 다르다.
   * - 0  : 데스크가 있고 QR은 기록용. 매 스캔이 새 입장이다
   * - 30 : QR을 찍어야 문이 열리는 24시 헬스장. 흡연 후 재입장을 인정한다
   *
   * on/off 플래그를 따로 두지 않는다. 0이 곧 "사용 안 함"이며,
   * 불리언을 추가하면 `enabled=false, minutes=30` 같은 모순된 조합이 저장된다.
   * @see ADR-013
   */
  @Column({ name: 'reentry_grace_minutes', type: 'int', default: 0 })
  reentryGraceMinutes: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.gym)
  users: User[];
}
