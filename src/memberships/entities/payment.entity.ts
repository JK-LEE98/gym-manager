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
 * 이 결제가 무엇에 대한 것인지.
 *
 * **매출 통계를 종류별로 나누기 위해 필요하다.**
 * 없으면 PT 계약금과 양도 수수료가 회원권 매출에 섞여 들어간다.
 *
 * `membershipTypeId`는 `MEMBERSHIP`일 때만 채워진다. @see ADR-014
 */
export enum PaymentPurpose {
  /** 회원권 판매 */
  MEMBERSHIP = 'MEMBERSHIP',
  /** PT 계약 */
  PT_CONTRACT = 'PT_CONTRACT',
  /** 회원권 양도 수수료 */
  TRANSFER_FEE = 'TRANSFER_FEE',
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

  /**
   * 회원권 판매일 때만 채워진다. PT 계약·양도 수수료는 null이다.
   *
   * 예전에는 NOT NULL이라 양도 수수료에 원본 회원권의 종류를 넣어 우회했는데,
   * **수수료 5만원이 "헬스 12개월" 매출로 집계되는 문제**가 있었다.
   * 종류를 알아야 하는 것은 `purpose = MEMBERSHIP`인 경우뿐이다.
   */
  @Column({ name: 'membership_type_id', type: 'uuid', nullable: true })
  membershipTypeId: string | null;

  @ManyToOne(() => MembershipType)
  @JoinColumn({ name: 'membership_type_id' })
  membershipType: MembershipType | null;

  @Column({ type: 'enum', enum: PaymentPurpose })
  purpose: PaymentPurpose;

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
