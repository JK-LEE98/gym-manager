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
import { Payment } from '../../memberships/entities/payment.entity';

/**
 * PT 계약 상태.
 *
 * 회원권과 같은 원칙이다. **사람이 개입한 사실만 담는다.**
 * `COMPLETED`는 잔여 횟수가 0이 되는 순간 시스템이 확정하는 종착점이라 예외적으로 저장한다.
 */
export enum PTContractStatus {
  ACTIVE = 'ACTIVE',
  /** 잔여 횟수를 모두 소진 */
  COMPLETED = 'COMPLETED',
  /** 환불·착오 등록 등으로 취소 */
  CANCELLED = 'CANCELLED',
}

/**
 * PT 계약.
 *
 * **트레이너와 회원은 1:1 전속이다.** 계약 시 배정되고 이후 고정된다.
 * 변경은 이례적이라 별도 기능으로 두지 않았다. @see ADR-014
 */
@Entity('pt_contracts')
@Index('idx_pt_contracts_gym_member', ['gymId', 'memberId'])
@Index('idx_pt_contracts_gym_trainer', ['gymId', 'trainerId'])
export class PTContract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gym_id', type: 'uuid' })
  gymId: string;

  @ManyToOne(() => Gym, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gym_id' })
  gym: Gym;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: User;

  /** 담당 트레이너. role=TRAINER만 허용된다 */
  @Column({ name: 'trainer_id', type: 'uuid' })
  trainerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'trainer_id' })
  trainer: User;

  /** 계약이 곧 결제다. 예약·완료 처리에는 결제가 없다 */
  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null;

  @OneToOne(() => Payment)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment | null;

  @Column({ name: 'total_sessions', type: 'int' })
  totalSessions: number;

  /**
   * 잔여 횟수.
   *
   * 집계로 계산하면 항상 정확하지만 **조건부 UPDATE의 대상이 사라진다.**
   * ```sql
   * UPDATE … SET remaining_sessions = remaining_sessions - 1 WHERE remaining_sessions > 0
   * ```
   * 집계값에는 이 원자적 검사를 걸 수 없다. 세고 나서 판단하는 사이가 비어 있다.
   *
   * 대신 이력과 어긋날 위험을 떠안으므로 검증 배치로 대응한다. @see ADR-003, ADR-014
   */
  @Column({ name: 'remaining_sessions', type: 'int' })
  remainingSessions: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({
    type: 'enum',
    enum: PTContractStatus,
    default: PTContractStatus.ACTIVE,
  })
  status: PTContractStatus;

  @Column({ type: 'text', nullable: true })
  memo: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
