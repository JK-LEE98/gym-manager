import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MembershipTransfer } from './entities/membership-transfer.entity';
import {
  MembershipStatus,
  UserMembership,
} from './entities/user-membership.entity';
import {
  Payment,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from './entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';
import { addDays, daysBetween, today } from '../common/utils/date.util';
import { HoldsService } from './holds.service';
import {
  TransferMembershipDto,
  TransferResponseDto,
} from './dto/membership-transfer.dto';

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(MembershipTransfer)
    private readonly transferRepo: Repository<MembershipTransfer>,
    @InjectRepository(UserMembership)
    private readonly membershipRepo: Repository<UserMembership>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly holdsService: HoldsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 회원권을 양도한다.
   *
   * 처리 순서가 중요하다.
   * ```
   * ① 홀딩 정리 (조기 종료 / 취소)
   * ② endDate 재계산 → 정확한 잔여 확정
   * ③ 잔여 일수를 양수인에게 이전
   * ④ 원본을 TRANSFERRED로 변경
   * ```
   * ②를 ①보다 먼저 하면 남은 홀딩 일수까지 넘어가 양수인이 이득을 본다. @see ADR-012
   */
  async transfer(
    membershipId: string,
    dto: TransferMembershipDto,
    gymId: string,
    operatorId: string,
  ): Promise<TransferResponseDto> {
    const source = await this.getTransferable(membershipId, gymId);

    if (source.userId === dto.toUserId) {
      throw new BusinessException(ErrorCode.TRANSFER_SAME_USER);
    }

    // 같은 헬스장 소속이어야 한다
    const receiver = await this.userRepo.findOne({
      where: { id: dto.toUserId, gymId },
    });
    if (!receiver) throw new BusinessException(ErrorCode.USER_NOT_FOUND);

    const transferId = await this.dataSource.transaction(async (manager) => {
      // ① 홀딩 정리 + ② 종료일 재계산
      await this.holdsService.settleHoldsForTransfer(manager, source.id);

      // 재계산된 값을 다시 읽는다. 위에서 endDate가 바뀌었을 수 있다
      const settled = await manager.findOne(UserMembership, {
        where: { id: source.id },
      });
      const remainingDays = daysBetween(today(), settled!.endDate) + 1;

      if (remainingDays < 1) {
        throw new BusinessException(ErrorCode.TRANSFER_NO_REMAINING_DAYS);
      }

      // ③ 양수인에게 새 회원권.
      //    시작일은 기존 이어붙이기 규칙을 그대로 적용한다 (ADR-010)
      const startDate = await this.resolveStartDate(
        manager,
        gymId,
        dto.toUserId,
        source.membershipTypeId,
      );

      const created = await manager.save(
        manager.create(UserMembership, {
          gymId,
          userId: dto.toUserId,
          membershipTypeId: source.membershipTypeId,
          // 양도는 새 매출이 아니다. 원본 결제는 양도인에게 남긴다
          paymentId: null,
          startDate,
          endDate: addDays(startDate, remainingDays - 1),
          status: MembershipStatus.ACTIVE,
          isTransferred: true,
          memo: dto.memo ?? null,
        }),
      );

      // ④ 원본 종료. 삭제하지 않아 양도인의 이력에 남는다
      await manager.update(UserMembership, source.id, {
        status: MembershipStatus.TRANSFERRED,
      });

      // 수수료가 있을 때만 결제를 만든다
      let feePaymentId: string | null = null;
      if (dto.fee && dto.fee > 0) {
        const feePayment = await manager.save(
          manager.create(Payment, {
            gymId,
            userId: dto.toUserId,
            // 회원권 판매가 아니므로 종류를 연결하지 않는다.
            // 예전에는 NOT NULL이라 원본의 종류를 넣었는데,
            // 그러면 수수료 5만원이 "헬스 12개월" 매출로 잡혔다.
            membershipTypeId: null,
            purpose: PaymentPurpose.TRANSFER_FEE,
            amount: dto.fee,
            method: PaymentMethod.MANUAL,
            status: PaymentStatus.COMPLETED,
          }),
        );
        feePaymentId = feePayment.id;
      }

      const transfer = await manager.save(
        manager.create(MembershipTransfer, {
          gymId,
          fromMembershipId: source.id,
          toMembershipId: created.id,
          fromUserId: source.userId,
          toUserId: dto.toUserId,
          transferredDays: remainingDays,
          feePaymentId,
          memo: dto.memo ?? null,
          createdByUserId: operatorId,
        }),
      );

      return transfer.id;
    });

    return this.findOne(transferId, gymId);
  }

  async findOne(id: string, gymId: string): Promise<TransferResponseDto> {
    const transfer = await this.transferRepo.findOne({
      where: { id, gymId },
      relations: { feePayment: true },
    });
    if (!transfer) throw new BusinessException(ErrorCode.NOT_FOUND);
    return TransferResponseDto.from(transfer);
  }

  /** 회원의 양도 이력. 준 것과 받은 것을 모두 포함한다 */
  async findByUser(
    userId: string,
    gymId: string,
  ): Promise<TransferResponseDto[]> {
    const transfers = await this.transferRepo.find({
      where: [
        { gymId, fromUserId: userId },
        { gymId, toUserId: userId },
      ],
      relations: { feePayment: true },
      order: { createdAt: 'DESC' },
    });
    return transfers.map((transfer) => TransferResponseDto.from(transfer));
  }

  // ---------- 내부 ----------

  private async getTransferable(
    id: string,
    gymId: string,
  ): Promise<UserMembership> {
    const membership = await this.membershipRepo.findOne({
      where: { id, gymId },
    });
    if (!membership) {
      throw new BusinessException(ErrorCode.MEMBERSHIP_NOT_FOUND);
    }

    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new BusinessException(
        ErrorCode.INVALID_MEMBERSHIP_STATUS,
        '이용 중인 회원권만 양도할 수 있습니다',
      );
    }

    // 홀딩 정리 전이라 여기서는 대략 판단하고, 정확한 검사는 트랜잭션 안에서 한다
    if (daysBetween(today(), membership.endDate) < 0) {
      throw new BusinessException(ErrorCode.TRANSFER_NO_REMAINING_DAYS);
    }

    return membership;
  }

  /**
   * 양수인의 시작일. 회원권 부여와 같은 이어붙이기 규칙을 적용한다.
   *
   * 양도인의 날짜를 그대로 복사하면 양수인이 같은 카테고리 회원권을 가진 경우
   * 기간이 겹쳐 두 건이 동시에 활성이 된다. @see ADR-012
   */
  private async resolveStartDate(
    manager: EntityManager,
    gymId: string,
    userId: string,
    membershipTypeId: string,
  ): Promise<string> {
    const now = today();

    const latest = await manager
      .createQueryBuilder(UserMembership, 'membership')
      .innerJoin('membership.membershipType', 'type')
      .where('membership.gymId = :gymId', { gymId })
      .andWhere('membership.userId = :userId', { userId })
      .andWhere(
        'type.category = (SELECT category FROM membership_types WHERE id = :typeId)',
        { typeId: membershipTypeId },
      )
      .andWhere('membership.status = :active', {
        active: MembershipStatus.ACTIVE,
      })
      .andWhere('membership.endDate >= :now', { now })
      .orderBy('membership.endDate', 'DESC')
      .getOne();

    return latest ? addDays(latest.endDate, 1) : now;
  }
}
