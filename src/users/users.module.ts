import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { TrainerProfile } from '../trainers/entities/trainer-profile.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { StatsModule } from '../stats/stats.module';
import { PTModule } from '../pt/pt.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, TrainerProfile]),
    // 비밀번호 변경·초기화·삭제 시 세션을 끊기 위해 TokenService가 필요하다
    AuthModule,
    // 회원 조회 시 회원권 요약을 함께 반환한다
    MembershipsModule,
    // 회원 상세에 이용 일수를 함께 반환한다
    StatsModule,
    // 강등·삭제 전에 미이행 PT 계약을 확인한다
    PTModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
