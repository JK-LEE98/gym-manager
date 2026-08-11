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

/** 출석이 기록된 경로 */
export enum AttendanceMethod {
  /** QR 스캔 */
  QR = 'QR',
  /** 데스크가 대신 처리. 배터리 방전 등 QR을 못 쓰는 상황 */
  MANUAL = 'MANUAL',
}

/**
 * 출석(입장) 기록.
 *
 * **입장 이벤트만 쌓는다. 퇴실은 기록하지 않는다.**
 * 퇴실 스캔 기능이 있는 헬스장도 회원 대부분이 그냥 나가기 때문에
 * 재실 인원이 항상 실제보다 많게 나온다. 신뢰할 수 없는 데이터는 없느니만 못하다.
 *
 * `입장 → 입장 → 입장`이 정상이다. @see ADR-013
 */
@Entity('attendances')
// 당일 입장 횟수 계산에 쓰인다. 조회용이 아니라 **스캔할 때마다 타는 쓰기 경로**의 인덱스다.
// 출입구에서의 지연은 곧 대기줄이 된다.
@Index('idx_attendances_gym_user_checked', ['gymId', 'userId', 'checkedAt'])
// 출석률 통계, 일자별 조회
@Index('idx_attendances_gym_checked', ['gymId', 'checkedAt'])
export class Attendance {
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

  /** 실제 입장 시각. 수동 처리 시 데스크가 지정할 수 있다 */
  @Column({ name: 'checked_at', type: 'timestamptz' })
  checkedAt: Date;

  /**
   * 수동 출석이 비정상적으로 많다면 QR 단말에 문제가 있거나
   * 우회가 관행이 된 것이다. 구분되어야 알 수 있다.
   */
  @Column({ type: 'enum', enum: AttendanceMethod })
  method: AttendanceMethod;

  /**
   * 유예 시간 안의 재입장. **입장 횟수에 세지 않는다.**
   *
   * 흡연하러 나갔다 온 회원을 "오늘 횟수를 다 썼다"고 막으면 안 된다.
   * 행을 남기지 않는 방법도 있으나, 무인 24시 헬스장은 사고 발생 시
   * 누가 언제 안에 있었는지가 필요하다. 컬럼 하나로 로그를 온전히 남기면서
   * 횟수는 `isReentry = false`만 세면 정확하다. @see ADR-013
   */
  @Column({ name: 'is_reentry', default: false })
  isReentry: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
