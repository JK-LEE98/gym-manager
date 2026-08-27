import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { Payment } from '../memberships/entities/payment.entity';
import { UserMembership } from '../memberships/entities/user-membership.entity';
import { User } from '../users/entities/user.entity';
import { PTSchedule } from '../pt/entities/pt-schedule.entity';

/**
 * 통계는 **읽기 전용이고 여러 도메인을 가로지른다.**
 *
 * 각 도메인 모듈에 흩어 두면 매출 계산이 memberships와 pt 양쪽에 생겨
 * 정의가 갈라진다. 집계 정의를 한 곳에 모으기 위해 별도 모듈로 둔다.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, User, UserMembership, PTSchedule]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
  // 회원 상세가 이용 일수를 함께 반환한다
  exports: [StatsService],
})
export class StatsModule {}
