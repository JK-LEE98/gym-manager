import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { TrainerProfile } from '../trainers/entities/trainer-profile.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, TrainerProfile]),
    // 비밀번호 변경·초기화·삭제 시 세션을 끊기 위해 TokenService가 필요하다
    AuthModule,
    // 회원 조회 시 회원권 요약을 함께 반환한다
    MembershipsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
