import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * 헬스장 (테넌트)
 *
 * 멀티테넌시의 기준 단위. 대부분의 테이블이 이 id를 gymId로 참조한다.
 * @see ADR-004
 */
@Entity('gyms')
export class Gym {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 255, nullable: true })
  address: string | null;

  @Column({ length: 20, nullable: true })
  phone: string | null;

  /** 서비스 이용 여부. 구독 해지 시 false → 소속 유저 로그인 차단 */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.gym)
  users: User[];
}
