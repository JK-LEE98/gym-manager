import {
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Gym } from '../../gyms/entities/gym.entity';
import { User } from '../../users/entities/user.entity';
import { PTContract } from './pt-contract.entity';

/**
 * PT 수업 상태.
 *
 * **`sessionDeducted`와 분리되어 있다.**
 * 노쇼를 차감할지는 트레이너 재량이라 헬스장·사유마다 다르다.
 * 하나로 합치면 "노쇼였지만 봐준" 경우가 `CANCELLED`로 뭉개져
 * 이 회원이 노쇼를 몇 번 했는지 셀 수 없게 된다. @see ADR-014
 */
export enum PTScheduleStatus {
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
  CANCELLED = 'CANCELLED',
}

/**
 * PT 예약.
 *
 * **행 하나 = 예약 하나. 빈 슬롯이라는 개념이 없다.**
 * 예약은 카톡·전화로 정해지고 트레이너가 입력한다.
 * 회원이 화면에서 빈 시간을 골라 잡는 구조가 아니므로
 * 비어 있는 시간을 미리 저장해둘 이유가 없다. @see ADR-014 결정 1
 */
@Entity('pt_schedules')
// 트레이너의 오늘·이번주 일정
@Index('idx_pt_schedules_gym_trainer_start', ['gymId', 'trainerId', 'startAt'])
// 회원의 다음 수업, 지난 이력
@Index('idx_pt_schedules_gym_member_start', ['gymId', 'memberId', 'startAt'])
// 미확인 목록 — endAt < now AND status = SCHEDULED
@Index('idx_pt_schedules_gym_status_end', ['gymId', 'status', 'endAt'])
/**
 * 같은 트레이너의 시간이 겹치는 예약을 **DB가 거부한다.**
 *
 * UNIQUE가 "값이 같으면 거부"라면 EXCLUDE는 "범위가 겹치면 거부"다.
 * 조회해서 판단하면 조회와 INSERT 사이가 비지만, 제약에는 그 틈이 없다.
 *
 * `[)`는 끝을 포함하지 않는 범위다. 10:00~11:00과 11:00~12:00은 겹치지 않는다.
 * `[]`로 두면 연속된 수업이 서로를 밀어낸다.
 *
 * 취소된 예약은 제외한다. 취소한 자리에 다시 잡을 수 있어야 한다.
 */
@Exclusion(
  'no_trainer_overlap',
  `USING gist (trainer_id WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE (status <> 'CANCELLED')`,
)
export class PTSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gym_id', type: 'uuid' })
  gymId: string;

  @ManyToOne(() => Gym, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gym_id' })
  gym: Gym;

  /** 어느 계약에서 횟수를 차감할지 */
  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @ManyToOne(() => PTContract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: PTContract;

  @Column({ name: 'trainer_id', type: 'uuid' })
  trainerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'trainer_id' })
  trainer: User;

  /** 빈 슬롯이 없으므로 항상 존재한다 */
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'member_id' })
  member: User;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  /**
   * 수업 종료 시각.
   *
   * 소요 시간(분)이 아니라 끝 시각으로 저장하는 이유는
   * **EXCLUDE 제약이 시간 범위를 요구하기 때문**이다.
   * `tstzrange(start_at, end_at)`을 만들려면 두 끝이 컬럼으로 있어야 한다.
   */
  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({
    type: 'enum',
    enum: PTScheduleStatus,
    default: PTScheduleStatus.SCHEDULED,
  })
  status: PTScheduleStatus;

  /** 이 수업으로 잔여 횟수를 깎았는지. 노쇼 시 트레이너가 선택한다 */
  @Column({ name: 'session_deducted', default: false })
  sessionDeducted: boolean;

  /** 완료·노쇼를 확정한 계정. 트레이너가 누르지만 OWNER가 정정할 수 있다 */
  @Column({ name: 'confirmed_by_user_id', type: 'uuid', nullable: true })
  confirmedByUserId: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'confirmed_by_user_id' })
  confirmedBy: User | null;

  @Column({ type: 'text', nullable: true })
  memo: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
