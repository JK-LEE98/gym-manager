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
import { UserMembership } from './user-membership.entity';
import { Role } from '../../common/enums/role.enum';

/**
 * 홀딩 상태.
 *
 * 진행 여부(예정/진행중/완료)는 **날짜로 판단**하므로 저장하지 않는다.
 * 회원권의 만료를 저장하지 않는 것과 같은 이유다. @see ADR-010, ADR-011
 */
export enum HoldStatus {
  ACTIVE = 'ACTIVE',
  /** 사람이 취소한 것. 종료일 재계산에서 제외된다 */
  CANCELLED = 'CANCELLED',
}

/**
 * 회원권 홀딩(휴회) 이력.
 *
 * 회원권의 종료일은 이 이력의 총 일수를 더해 **항상 전체 재계산**한다.
 * 증분 조정(+10 했다가 -5)은 수정이 반복될 때 어긋나므로 사용하지 않는다. @see ADR-011
 */
@Entity('membership_holds')
// 회원권별 홀딩 조회 — 종료일 재계산 시 매번 사용된다
@Index('idx_holds_membership_status', ['userMembershipId', 'status'])
// "오늘 종료 예정", "현재 홀딩 중" 목록
@Index('idx_holds_gym_dates', ['gymId', 'startDate', 'endDate'])
export class MembershipHold {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gym_id', type: 'uuid' })
  gymId: string;

  @ManyToOne(() => Gym, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gym_id' })
  gym: Gym;

  @Column({ name: 'user_membership_id', type: 'uuid' })
  userMembershipId: string;

  @ManyToOne(() => UserMembership, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_membership_id' })
  userMembership: UserMembership;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  /** 마지막 홀딩일. 이 날까지 정지된다 */
  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ type: 'enum', enum: HoldStatus, default: HoldStatus.ACTIVE })
  status: HoldStatus;

  /**
   * 실제로 등록한 계정.
   *
   * 회원이 앱에서 직접 걸었는지 데스크가 대신 걸었는지 구분해야 한다.
   * 분쟁이 생기면 서로 다른 사실이기 때문이다.
   */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: User;

  /** MEMBER면 셀프 신청, OWNER면 데스크 대행 */
  @Column({ name: 'created_by_role', type: 'enum', enum: Role })
  createdByRole: Role;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
