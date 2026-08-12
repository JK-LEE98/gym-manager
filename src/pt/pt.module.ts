import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PTContract } from './entities/pt-contract.entity';
import { PTSchedule } from './entities/pt-schedule.entity';
import { PTContractsController } from './pt-contracts.controller';
import { PTSchedulesController } from './pt-schedules.controller';
import { PTContractsService } from './pt-contracts.service';
import { PTSchedulesService } from './pt-schedules.service';
import { User } from '../users/entities/user.entity';
import { Payment } from '../memberships/entities/payment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PTContract, PTSchedule, User, Payment])],
  controllers: [PTContractsController, PTSchedulesController],
  providers: [PTContractsService, PTSchedulesService],
  exports: [PTContractsService],
})
export class PTModule {}
