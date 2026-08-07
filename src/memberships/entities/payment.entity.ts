import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Gym } from '../../gyms/entities/gym.entity';
import { User } from '../../users/entities/user.entity';
import { MembershipType } from './membership-type.entity';

/** 결제 수단. PG 연동 시 확장된다 */
export enum PaymentMethod {
  /** 데스크에서 현금·카드로 받고 시스템에는 기록만 남기는 경우 */
  MANUAL = 'MANUAL',
  KAKAO_PAY = 'KAKAO_PAY',
  TOSS = 'TOSS',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

/**
 * 결제 기록.
 *
 * 현재는 PG 연동 없이 MANUAL로만 생성된다.
 * 연동 시 이 테이블 구조를 바꾸지 않고 method와 pgTransactionId만 채우면 되도록 설계했다.
 */
@Entity('payments')
@Index('idx_payments_gym_created', ['gymId', 'createdAt'])
export class Payment {
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

  /**
   * 실제 결제 금액.
   *
   * MembershipType.price를 그대로 쓰지 않고 별도로 저장하는 이유:
   * 할인이 적용될 수 있고, 나중에 종류의 가격이 바뀌어도 과거 결제 기록은 유지되어야 한다.
   */
  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.MANUAL })
  method: PaymentMethod;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.COMPLETED,
  })
  status: PaymentStatus;

  /** PG 연동 시 채워진다. 현재는 항상 null */
  @Column({
    name: 'pg_transaction_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  pgTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
