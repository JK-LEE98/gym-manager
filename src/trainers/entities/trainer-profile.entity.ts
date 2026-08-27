import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * 트레이너 프로필
 *
 * role=TRAINER인 User만 보유한다. MEMBER → TRAINER 승격 시 같은 트랜잭션에서 생성된다.
 *
 * gymId 컬럼이 없는 이유: User와 1:1이라 항상 User를 경유해 접근하므로
 * 테넌트 필터가 중복된다. @see ADR-004
 */
@Entity('trainer_profiles')
export class TrainerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.trainerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** 전문 분야. 예: "웨이트 트레이닝, 체형교정" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  specialty: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
