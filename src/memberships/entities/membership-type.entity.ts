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

/**
 * 헬스장이 판매하는 회원권 종류. 예: "헬스 3개월", "락커 12개월"
 */
@Entity('membership_types')
@Index('idx_membership_types_gym_active', ['gymId', 'isActive'])
export class MembershipType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gym_id', type: 'uuid' })
  gymId: string;

  @ManyToOne(() => Gym, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gym_id' })
  gym: Gym;

  /** 판매 명칭. 예: "헬스 3개월" */
  @Column({ length: 100 })
  name: string;

  /**
   * 회원권 성격. 예: "헬스", "락커", "운동복", "PT"
   *
   * **자동 이어붙이기의 판단 기준이다.** 같은 카테고리의 회원권을 추가로 부여하면
   * 기존 종료일 다음날부터 시작된다. 헬스와 락커는 카테고리가 달라 동시에 진행된다.
   *
   * enum이 아닌 이유: 헬스장마다 취급 종류가 다르다.
   * "운동복과 수건을 나눌지 합칠지"도 각 헬스장이 정한다. @see ADR-010
   */
  @Column({ length: 50 })
  category: string;

  /** 유효 기간(일) */
  @Column({ name: 'duration_days', type: 'int' })
  durationDays: number;

  /** 판매 가격(원) */
  @Column({ type: 'int' })
  price: number;

  /**
   * 판매 여부. 삭제 대신 이 값을 false로 둔다.
   * 이미 판매된 UserMembership이 참조하고 있어 물리 삭제할 수 없다.
   */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
