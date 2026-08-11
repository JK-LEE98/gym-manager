import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { PTContract, PTContractStatus } from './entities/pt-contract.entity';
import {
  CreatePTContractDto,
  PTContractQueryDto,
  PTContractResponseDto,
} from './dto/pt-contract.dto';
import { User } from '../users/entities/user.entity';
import {
  Payment,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from '../memberships/entities/payment.entity';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';

@Injectable()
export class PTContractsService {
  constructor(
    @InjectRepository(PTContract)
    private readonly contractRepo: Repository<PTContract>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * PT 계약을 만들고 결제를 함께 기록한다.
   *
   * **하나의 트랜잭션으로 묶는다.** 계약만 만들어지고 결제가 실패하면
   * 매출에 잡히지 않는 계약이 남고, 결제만 생기면 소속 없는 결제가 된다.
   * 회원권 부여와 같은 패턴이다. @see ADR-014
   */
  async create(
    dto: CreatePTContractDto,
    gymId: string,
  ): Promise<PTContractResponseDto> {
    const member = await this.userRepo.findOne({
      where: { id: dto.memberId, gymId },
    });
    if (!member) throw new BusinessException(ErrorCode.USER_NOT_FOUND);

    // 트레이너는 같은 헬스장 소속이면서 role=TRAINER여야 한다.
    // 회원을 담당으로 지정하면 그 회원은 영영 수업을 받을 수 없게 된다.
    const trainer = await this.userRepo.findOne({
      where: { id: dto.trainerId, gymId },
    });
    if (!trainer) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    if (trainer.role !== Role.TRAINER) {
      throw new BusinessException(ErrorCode.INVALID_TRAINER);
    }

    const contractId = await this.dataSource.transaction(async (manager) => {
      const payment = await manager.save(
        manager.create(Payment, {
          gymId,
          userId: dto.memberId,
          // PT는 회원권 종류가 아니다. 연결하면 회원권 매출로 잡힌다
          membershipTypeId: null,
          purpose: PaymentPurpose.PT_CONTRACT,
          amount: dto.amount,
          method: PaymentMethod.MANUAL,
          status: PaymentStatus.COMPLETED,
        }),
      );

      const contract = await manager.save(
        manager.create(PTContract, {
          gymId,
          memberId: dto.memberId,
          trainerId: dto.trainerId,
          paymentId: payment.id,
          totalSessions: dto.totalSessions,
          // 계약 시점에는 아직 아무것도 쓰지 않았다
          remainingSessions: dto.totalSessions,
          startDate: dto.startDate,
          endDate: dto.endDate,
          memo: dto.memo ?? null,
        }),
      );

      return contract.id;
    });

    return this.findOne(contractId, gymId);
  }

  async findOne(id: string, gymId: string): Promise<PTContractResponseDto> {
    const contract = await this.contractRepo.findOne({
      where: { id, gymId },
      relations: { member: true, trainer: true, payment: true },
    });
    if (!contract) {
      throw new BusinessException(ErrorCode.PT_CONTRACT_NOT_FOUND);
    }
    return PTContractResponseDto.from(contract);
  }

  async findAll(
    query: PTContractQueryDto,
    gymId: string,
  ): Promise<PTContractResponseDto[]> {
    const where: FindOptionsWhere<PTContract> = { gymId };
    if (query.memberId) where.memberId = query.memberId;
    if (query.trainerId) where.trainerId = query.trainerId;

    return this.findBy(where);
  }

  /**
   * 본인과 관련된 계약. 역할에 따라 조회 축이 다르다.
   *
   * 회원은 자기가 받는 계약을, 트레이너는 자기가 가르치는 계약을 본다.
   */
  async findMine(
    userId: string,
    role: Role,
    gymId: string,
  ): Promise<PTContractResponseDto[]> {
    const where: FindOptionsWhere<PTContract> =
      role === Role.TRAINER
        ? { gymId, trainerId: userId }
        : { gymId, memberId: userId };

    return this.findBy(where);
  }

  /**
   * 환불·착오 등록 처리. 삭제하지 않는다.
   *
   * 결제 이력과 지난 수업 기록이 이 계약을 참조하고 있다.
   */
  async cancel(id: string, gymId: string): Promise<PTContractResponseDto> {
    const contract = await this.contractRepo.findOne({ where: { id, gymId } });
    if (!contract) {
      throw new BusinessException(ErrorCode.PT_CONTRACT_NOT_FOUND);
    }
    if (contract.status !== PTContractStatus.ACTIVE) {
      throw new BusinessException(ErrorCode.INVALID_CONTRACT_STATUS);
    }

    contract.status = PTContractStatus.CANCELLED;
    await this.contractRepo.save(contract);

    return this.findOne(id, gymId);
  }

  private async findBy(
    where: FindOptionsWhere<PTContract>,
  ): Promise<PTContractResponseDto[]> {
    const contracts = await this.contractRepo.find({
      where,
      relations: { member: true, trainer: true, payment: true },
      order: { createdAt: 'DESC' },
    });
    return contracts.map((contract) => PTContractResponseDto.from(contract));
  }
}
