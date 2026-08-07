import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Gym } from '../../gyms/entities/gym.entity';
import { User } from '../../users/entities/user.entity';
import { MembershipType } from './membership-type.entity';
import { Payment } from './payment.entity';

/**
 * 회원권 상태.
 *
 * **만료(EXPIRED)가 없는 것이 의도적이다.**
 * 만료는 `endDate < 오늘`로 계산한다. 여기에는 사람이 개입한 상태만 담는다.
 * 같은 사실을 endDate와 status 두 곳에 저장하면 반드시 어긋난다. @see ADR-010
 */
export enum MembershipStatus {
  ACTIVE = 'ACTIVE',
  /** 홀딩(휴회) */
  SUSPENDED = 'SUSPENDED',
  /** 환불·착오 등록 등으로 취소 */
  CANCELLED = 'CANCELLED',
  /** 다른 회원에게 양도해 종료됨. 이력으로 남는다 @see ADR-012 */
  TRANSFERRED = 'TRANSFERRED',
}

/**
 * 회원이 보유한 회원권.
 *
 * 한 회원이 여러 건을 동시에 가질 수 있다.
 * - 헬스 12개월 + 락커 12개월 (카테고리가 달라 동시 진행)
 * - 헬스 3개월(만료 임박) + 헬스 12개월 (같은 카테고리라 이어붙음)
 */
@Entity('user_memberships')
// 회원별 활성 회원권 조회 — 가장 빈번한 쿼리
@Index('idx_user_memberships_gym_user_status', ['gymId', 'userId', 'status'])
// 만료 임박 회원 조회 (알림용)
@Index('idx_user_memberships_gym_end_date', ['gymId', 'endDate'])
export class UserMembership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gym_id', type: 'uuid' })
  gymId: string;

  @ManyToOne(() => Gym, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gym_id' })
  gym: Gym;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'membership_type_id', type: 'uuid' })
  membershipTypeId: string;

  @ManyToOne(() => MembershipType)
  @JoinColumn({ name: 'membership_type_id' })
  membershipType: MembershipType;

  /** 회원권 부여와 함께 생성된다. 하나의 트랜잭션으로 처리 */
  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null;

  @OneToOne(() => Payment)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment | null;

  /**
   * 이용 시작일.
   *
   * 지정하지 않으면 서버가 계산한다.
   * 같은 카테고리의 아직 끝나지 않은 회원권이 있으면 그 종료일 다음날,
   * 없으면 오늘. @see ADR-010
   */
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  /**
   * 마지막 이용 가능일. **이 날까지 이용할 수 있다.**
   *
   * 항상 서버가 계산한다: `startDate + durationDays - 1`
   * -1이 없으면 1일권이 이틀이 된다.
   */
  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({
    type: 'enum',
    enum: MembershipStatus,
    default: MembershipStatus.ACTIVE,
  })
  status: MembershipStatus;

  /**
   * 결제 건별 자유 기록. 헬스장마다 기입 방식이 다르므로 형식을 강제하지 않는다.
   *
   * 실제 예: `*26.08.06 H12 + 락커12 [카 55만]`
   */
  @Column({ type: 'text', nullable: true })
  memo: string | null;

  /**
   * 양도로 생성된 회원권.
   *
   * **양도권은 홀딩할 수 없다.** 원본과 같은 MembershipType을 참조하므로
   * 그 종류의 holdingLimit이 그대로 적용되는 것을 막기 위한 개별 제약이다. @see ADR-012
   */
  @Column({ name: 'is_transferred', default: false })
  isTransferred: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
