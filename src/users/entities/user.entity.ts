import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { Gym } from '../../gyms/entities/gym.entity';
import { TrainerProfile } from '../../trainers/entities/trainer-profile.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

/**
 * 사용자
 *
 * 모든 역할(SUPER_ADMIN/OWNER/TRAINER/MEMBER)이 이 테이블을 공유한다.
 * OWNER는 개인이 아니라 헬스장 공용 운영 계정이다. @see ADR-005
 */
@Entity('users')
// 헬스장별 역할 조회 (트레이너 목록, 회원 목록)
@Index('idx_users_gym_role', ['gymId', 'role'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 소속 헬스장.
   * SUPER_ADMIN만 null이다. 나머지 역할은 반드시 값이 있어야 한다.
   * (DB 레벨 강제는 불가 — Service 레이어에서 검증)
   */
  @Column({ name: 'gym_id', type: 'uuid', nullable: true })
  gymId: string | null;

  @ManyToOne(() => Gym, (gym) => gym.users, { nullable: true })
  @JoinColumn({ name: 'gym_id' })
  gym: Gym | null;

  /**
   * 로그인 아이디. 4~20자, 영문 소문자·숫자·언더스코어.
   *
   * 이메일을 쓰지 않는 이유: 인증 절차를 두지 않을 것이므로 검증되지 않은 이메일은 의미가 없다.
   * 연락 수단은 phone이 담당한다. @see ADR-009
   *
   * 전역 유니크 — 한 계정 = 한 헬스장
   */
  @Column({ name: 'login_id', length: 50, unique: true })
  loginId: string;

  /** bcrypt 해시. 조회 시 기본 제외 → 명시적으로 addSelect 해야 나옴 */
  @Column({ length: 255, select: false })
  password: string;

  @Column({ length: 50 })
  name: string;

  /** 헬스장에서 실질적인 연락 수단이다 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null;

  /**
   * 회원 전반의 특이사항. 무릎 부상 이력, 응대 시 참고사항 등.
   *
   * 결제 건별 기록은 UserMembership.memo에 둔다. 성격이 다른 정보다. @see ADR-010
   */
  @Column({ type: 'text', nullable: true })
  memo: string | null;

  @Column({ type: 'enum', enum: Role })
  role: Role;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  /** role=TRAINER인 경우에만 존재 */
  @OneToOne(() => TrainerProfile, (profile) => profile.user)
  trainerProfile: TrainerProfile | null;

  /** 기기별로 여러 개 존재 가능 @see ADR-006 */
  @OneToMany(() => RefreshToken, (token) => token.user)
  refreshTokens: RefreshToken[];
}
