import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MembershipType } from './entities/membership-type.entity';
import { UserMembership } from './entities/user-membership.entity';
import { Payment } from './entities/payment.entity';
import { MembershipHold } from './entities/membership-hold.entity';
import { User } from '../users/entities/user.entity';
import {
  MembershipsController,
  MembershipTypesController,
} from './memberships.controller';
import { HoldsController } from './holds.controller';
import { MembershipsService } from './memberships.service';
import { HoldsService } from './holds.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MembershipType,
      UserMembership,
      Payment,
      MembershipHold,
      User,
    ]),
  ],
  controllers: [
    MembershipTypesController,
    MembershipsController,
    HoldsController,
  ],
  providers: [MembershipsService, HoldsService],
  // UsersService가 회원 목록에 회원권 요약을 붙일 때 사용한다
  exports: [MembershipsService],
})
export class MembershipsModule {}
