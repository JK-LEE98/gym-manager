import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from './entities/attendance.entity';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { QrTokenService } from './qr-token.service';
import { Gym } from '../gyms/entities/gym.entity';
import { User } from '../users/entities/user.entity';
import { UserMembership } from '../memberships/entities/user-membership.entity';
import { MembershipHold } from '../memberships/entities/membership-hold.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Attendance,
      Gym,
      User,
      UserMembership,
      MembershipHold,
    ]),
    // 시크릿을 여기서 고정하지 않는다. QrTokenService가 sign/verify마다
    // JWT_QR_SECRET을 직접 지정한다. Access Token과 섞이면
    // type 검증 하나에만 의존하게 되기 때문이다. @see ADR-013
    JwtModule.register({}),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, QrTokenService],
})
export class AttendanceModule {}
