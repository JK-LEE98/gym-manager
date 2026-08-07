import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MembershipType } from './entities/membership-type.entity';
import {
  MembershipStatus,
  UserMembership,
} from './entities/user-membership.entity';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
} from './entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';
import { addDays, today } from '../common/utils/date.util';
import {
  CreateMembershipTypeDto,
  MembershipTypeResponseDto,
  UpdateMembershipTypeDto,
} from './dto/membership-type.dto';
import {
  ExtendMembershipDto,
  GrantMembershipDto,
  UserMembershipResponseDto,
} from './dto/user-membership.dto';

@Injectable()
export class MembershipsService {
  constructor(
    @InjectRepository(MembershipType)
    private readonly typeRepo: Repository<MembershipType>,
    @InjectRepository(UserMembership)
    private readonly membershipRepo: Repository<UserMembership>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- 회원권 종류 ----------

  async createType(
    dto: CreateMembershipTypeDto,
    gymId: string,
  ): Promise<MembershipTypeResponseDto> {
    const type = await this.typeRepo.save(
      this.typeRepo.create({ ...dto, gymId }),
    );
    return MembershipTypeResponseDto.from(type);
  }

  async findAllTypes(
    gymId: string,
    includeInactive = false,
  ): Promise<MembershipTypeResponseDto[]> {
    const types = await this.typeRepo.find({
      where: includeInactive ? { gymId } : { gymId, isActive: true },
      order: { category: 'ASC', durationDays: 'ASC' },
    });
    return types.map((type) => MembershipTypeResponseDto.from(type));
  }

  async updateType(
    id: string,
    dto: UpdateMembershipTypeDto,
    gymId: string,
  ): Promise<MembershipTypeResponseDto> {
    const type = await this.getTypeInGym(id, gymId);
    Object.assign(type, dto);
    return MembershipTypeResponseDto.from(await this.typeRepo.save(type));
  }

  /**
   * 판매 중지. 삭제하지 않는다.
   * 이미 판매된 UserMembership이 참조하고 있어 물리 삭제가 불가능하다.
   */
  async deactivateType(
    id: string,
    gymId: string,
  ): Promise<MembershipTypeResponseDto> {
    const type = await this.getTypeInGym(id, gymId);
    type.isActive = false;
    return MembershipTypeResponseDto.from(await this.typeRepo.save(type));
  }

  // ---------- 회원권 부여 ----------

  /**
   * 회원에게 회원권을 부여하고 결제 기록을 함께 남긴다.
   *
   * **하나의 트랜잭션으로 처리한다.** 회원권만 생기고 결제 기록이 없으면
   * 매출 통계가 어긋나고, 결제만 남고 회원권이 없으면 회원이 이용할 수 없다.
   */
  async grant(
    dto: GrantMembershipDto,
    gymId: string,
  ): Promise<UserMembershipResponseDto> {
    const type = await this.getTypeInGym(dto.membershipTypeId, gymId);
    if (!type.isActive) {
      throw new BusinessException(ErrorCode.MEMBERSHIP_TYPE_INACTIVE);
    }

    // 다른 헬스장 회원에게 부여할 수 없다
    const user = await this.userRepo.findOne({
      where: { id: dto.userId, gymId },
    });
    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND);

    const startDate =
      dto.startDate ?? (await this.resolveStartDate(gymId, dto.userId, type));
    const endDate = addDays(startDate, type.durationDays - 1);

    const membershipId = await this.dataSource.transaction(async (manager) => {
      const payment = await manager.save(
        manager.create(Payment, {
          gymId,
          userId: dto.userId,
          membershipTypeId: type.id,
          // 할인 판매를 허용한다. 생략하면 정가
          amount: dto.amount ?? type.price,
          // PG 연동 전까지는 데스크에서 받고 기록만 남긴다
          method: PaymentMethod.MANUAL,
          status: PaymentStatus.COMPLETED,
        }),
      );

      const membership = await manager.save(
        manager.create(UserMembership, {
          gymId,
          userId: dto.userId,
          membershipTypeId: type.id,
          paymentId: payment.id,
          startDate,
          endDate,
          status: MembershipStatus.ACTIVE,
          memo: dto.memo ?? null,
        }),
      );

      return membership.id;
    });

    return this.findOne(membershipId, gymId);
  }

  /**
   * 시작일을 결정한다.
   *
   * 만료가 임박한 상태에서 추가 결제하면 **기존 회원권 뒤에 이어붙는다.**
   * 잔여 기간을 버리지 않기 위함이다.
   *
   * ```
   * 헬스권이 8/6에 만료(3일 남음) + 헬스 12개월 결제 → 8/7부터 시작
   * 헬스권 보유 + 락커 12개월 결제                  → 오늘부터 시작 (카테고리가 다름)
   * ```
   *
   * @see ADR-010
   */
  private async resolveStartDate(
    gymId: string,
    userId: string,
    type: MembershipType,
  ): Promise<string> {
    const now = today();

    // 같은 카테고리에서 아직 끝나지 않은 회원권 중 가장 늦은 종료일.
    // CANCELLED는 제외한다 — 취소된 회원권 뒤에 이어붙일 이유가 없다.
    const latest = await this.membershipRepo
      .createQueryBuilder('membership')
      .innerJoin('membership.membershipType', 'type')
      .where('membership.gymId = :gymId', { gymId })
      .andWhere('membership.userId = :userId', { userId })
      .andWhere('type.category = :category', { category: type.category })
      .andWhere('membership.status != :cancelled', {
        cancelled: MembershipStatus.CANCELLED,
      })
      .andWhere('membership.endDate >= :today', { today: now })
      .orderBy('membership.endDate', 'DESC')
      .getOne();

    return latest ? addDays(latest.endDate, 1) : now;
  }

  // ---------- 회원권 조회·변경 ----------

  async findOne(id: string, gymId: string): Promise<UserMembershipResponseDto> {
    return UserMembershipResponseDto.from(await this.getInGym(id, gymId));
  }

  /** 특정 회원의 회원권 전체. 과거 이력까지 포함해 데스크에서 한눈에 본다 */
  async findByUser(
    userId: string,
    gymId: string,
  ): Promise<UserMembershipResponseDto[]> {
    const memberships = await this.membershipRepo.find({
      where: { userId, gymId },
      relations: { membershipType: true, payment: true },
      order: { endDate: 'DESC' },
    });
    return memberships.map((m) => UserMembershipResponseDto.from(m));
  }

  /**
   * 기간 연장. 종료일을 뒤로 민다.
   *
   * 서비스 차원의 보상이나 착오 정정에 사용한다.
   * 추가 결제는 `grant`로 새 회원권을 부여하는 것이 맞다. (결제 이력이 남아야 한다)
   */
  async extend(
    id: string,
    dto: ExtendMembershipDto,
    gymId: string,
  ): Promise<UserMembershipResponseDto> {
    const membership = await this.getInGym(id, gymId);
    this.assertNotCancelled(membership);

    membership.endDate = addDays(membership.endDate, dto.days);
    if (dto.memo) membership.memo = dto.memo;

    await this.membershipRepo.save(membership);
    return this.findOne(id, gymId);
  }

  /** 환불·착오 등록 등으로 무효화한다. 이력은 남긴다 */
  async cancel(id: string, gymId: string): Promise<UserMembershipResponseDto> {
    const membership = await this.getInGym(id, gymId);
    this.assertNotCancelled(membership);

    membership.status = MembershipStatus.CANCELLED;
    await this.membershipRepo.save(membership);
    return this.findOne(id, gymId);
  }

  // ---------- 내부 ----------

  private async getTypeInGym(
    id: string,
    gymId: string,
  ): Promise<MembershipType> {
    const type = await this.typeRepo.findOne({ where: { id, gymId } });
    if (!type) {
      throw new BusinessException(ErrorCode.MEMBERSHIP_TYPE_NOT_FOUND);
    }
    return type;
  }

  /**
   * gymId를 WHERE에 넣어 다른 헬스장의 회원권이 애초에 조회되지 않게 한다.
   * "찾은 뒤 비교"하면 조건을 빠뜨렸을 때 데이터가 샌다. @see ADR-004
   */
  private async getInGym(id: string, gymId: string): Promise<UserMembership> {
    const membership = await this.membershipRepo.findOne({
      where: { id, gymId },
      relations: { membershipType: true, payment: true },
    });
    if (!membership) {
      throw new BusinessException(ErrorCode.MEMBERSHIP_NOT_FOUND);
    }
    return membership;
  }

  private assertNotCancelled(membership: UserMembership): void {
    if (membership.status === MembershipStatus.CANCELLED) {
      throw new BusinessException(
        ErrorCode.INVALID_MEMBERSHIP_STATUS,
        '취소된 회원권은 변경할 수 없습니다',
      );
    }
  }

  /**
   * 회원 목록에 붙일 카테고리별 요약.
   *
   * 회원마다 따로 조회하면 N+1이 되므로 여러 회원을 한 번에 처리한다.
   * UsersService에서 호출한다.
   */
  async summarizeByUsers(
    userIds: string[],
    gymId: string,
  ): Promise<Map<string, UserMembershipResponseDto[]>> {
    if (userIds.length === 0) return new Map();

    const memberships = await this.membershipRepo
      .createQueryBuilder('membership')
      .innerJoinAndSelect('membership.membershipType', 'type')
      .where('membership.gymId = :gymId', { gymId })
      .andWhere('membership.userId IN (:...userIds)', { userIds })
      .andWhere('membership.status = :active', {
        active: MembershipStatus.ACTIVE,
      })
      // 만료된 것은 목록 요약에서 제외한다. 상세 조회에서는 이력으로 보인다
      .andWhere('membership.endDate >= :today', { today: today() })
      .orderBy('membership.endDate', 'DESC')
      .getMany();

    const grouped = new Map<string, UserMembershipResponseDto[]>();
    for (const membership of memberships) {
      const list = grouped.get(membership.userId) ?? [];
      list.push(UserMembershipResponseDto.from(membership));
      grouped.set(membership.userId, list);
    }
    return grouped;
  }
}
