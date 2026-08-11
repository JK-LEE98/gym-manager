import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PTContract } from './entities/pt-contract.entity';
import { PTContractsController } from './pt-contracts.controller';
import { PTContractsService } from './pt-contracts.service';
import { User } from '../users/entities/user.entity';
import { Payment } from '../memberships/entities/payment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PTContract, User, Payment])],
  controllers: [PTContractsController],
  providers: [PTContractsService],
  exports: [PTContractsService],
})
export class PTModule {}
