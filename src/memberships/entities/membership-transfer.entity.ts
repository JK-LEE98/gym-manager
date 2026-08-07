import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Gym } from '../../gyms/entities/gym.entity';
import { User } from '../../users/entities/user.entity';
import { UserMembership } from './user-membership.entity';
import { Payment } from './payment.entity';

/**
 * 회원권 양도 이력.
 *
 * 양도인의 회원권을 TRANSFERRED로 종료하고 양수인에게 새 회원권을 만든 뒤,
 * 두 건을 이 레코드로 연결한다.
 *
 * userId만 바꾸지 않는 이유: 그러면 양도인의 이력에서 회원권이 사라져
 * "12개월 끊었었다"를 나중에 확인할 수 없다. @see ADR-012
 */
@Entity('membership_transfers')
@Index('idx_transfers_gym_created', ['gymId', 'createdAt'])
@Index('idx_transfers_from_user', ['fromUserId'])
@Index('idx_transfers_to_user', ['toUserId'])
export class MembershipTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gym_id', type: 'uuid' })
  gymId: string;

  @ManyToOne(() => Gym, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gym_id' })
  gym: Gym;

  /** 양도인의 원본 회원권 (TRANSFERRED 상태가 된다) */
  @Column({ name: 'from_membership_id', type: 'uuid' })
  fromMembershipId: string;

  @ManyToOne(() => UserMembership)
  @JoinColumn({ name: 'from_membership_id' })
  fromMembership: UserMembership;

  /** 양수인에게 새로 만들어진 회원권 */
  @Column({ name: 'to_membership_id', type: 'uuid' })
  toMembershipId: string;

  @ManyToOne(() => UserMembership)
  @JoinColumn({ name: 'to_membership_id' })
  toMembership: UserMembership;

  @Column({ name: 'from_user_id', type: 'uuid' })
  fromUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'from_user_id' })
  fromUser: User;

  @Column({ name: 'to_user_id', type: 'uuid' })
  toUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'to_user_id' })
  toUser: User;

  /** 실제로 넘긴 일수. 홀딩 정리 후 확정된 값이다 */
  @Column({ name: 'transferred_days', type: 'int' })
  transferredDays: number;

  /**
   * 양도 수수료 결제. 무료 양도면 null.
   *
   * 원본 결제를 복제하지 않는다. 양도는 새로운 매출이 아니므로
   * 복제하면 같은 돈이 두 번 계상된다. 수수료만 별도로 기록한다.
   */
  @Column({ name: 'fee_payment_id', type: 'uuid', nullable: true })
  feePaymentId: string | null;

  @ManyToOne(() => Payment)
  @JoinColumn({ name: 'fee_payment_id' })
  feePayment: Payment | null;

  @Column({ type: 'text', nullable: true })
  memo: string | null;

  /** 처리한 직원 계정 */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
