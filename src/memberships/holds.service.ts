import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { HoldStatus, MembershipHold } from './entities/membership-hold.entity';
import {
  MembershipStatus,
  UserMembership,
} from './entities/user-membership.entity';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';
import { addDays, daysBetween, today } from '../common/utils/date.util';
import {
  CreateHoldDto,
  HoldResponseDto,
  UpdateHoldDto,
} from './dto/membership-hold.dto';

/** 홀딩 등록 주체의 권한 */
interface Actor {
  userId: string;
  role: Role;
  gymId: string;
}

@Injectable()
export class HoldsService {
  constructor(
    @InjectRepository(MembershipHold)
    private readonly holdRepo: Repository<MembershipHold>,
    @InjectRepository(UserMembership)
    private readonly membershipRepo: Repository<UserMembership>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateHoldDto, actor: Actor): Promise<HoldResponseDto> {
    const membership = await this.getMembership(dto.userMembershipId, actor);

    // 양도권은 원본과 같은 종류를 참조하므로 그 종류의 홀딩 정책이 적용된다.
    // 종류 정책보다 우선하는 개별 제약이다. @see ADR-012
    if (membership.isTransferred) {
      throw new BusinessException(ErrorCode.HOLD_NOT_ALLOWED_FOR_TRANSFERRED);
    }

    this.assertDateOrder(dto.startDate, dto.endDate);
    this.assertActorMayUseDate(dto.startDate, actor);
    this.assertWithinMembership(membership, dto.startDate, dto.endDate);
    this.assertDurationAllowed(membership, dto.startDate, dto.endDate);
    await this.assertCountAllowed(membership, null);
    await this.assertNoOverlap(membership.id, dto.startDate, dto.endDate, null);

    const holdId = await this.dataSource.transaction(async (manager) => {
      const hold = await manager.save(
        manager.create(MembershipHold, {
          gymId: actor.gymId,
          userMembershipId: membership.id,
          startDate: dto.startDate,
          endDate: dto.endDate,
          status: HoldStatus.ACTIVE,
          createdByUserId: actor.userId,
          createdByRole: actor.role,
          reason: dto.reason ?? null,
        }),
      );

      await this.recalculateEndDate(manager, membership.id);
      return hold.id;
    });

    return this.findOne(holdId, actor);
  }

  /**
   * 홀딩 일정 변경.
   *
   * 회원 사정이 바뀌는 것은 일상적이므로 수정을 허용한다.
   * 소급 수정도 허용하되 OWNER만 가능하다 — 막으면 기간 연장으로 우회해
   * 오히려 추적이 어려워진다. @see ADR-011
   */
  async update(
    id: string,
    dto: UpdateHoldDto,
    actor: Actor,
  ): Promise<HoldResponseDto> {
    const hold = await this.getHold(id, actor);
    const membership = await this.getMembership(hold.userMembershipId, actor);

    if (hold.status === HoldStatus.CANCELLED) {
      throw new BusinessException(
        ErrorCode.INVALID_MEMBERSHIP_STATUS,
        '취소된 홀딩은 수정할 수 없습니다',
      );
    }

    const startDate = dto.startDate ?? hold.startDate;
    const endDate = dto.endDate ?? hold.endDate;

    this.assertDateOrder(startDate, endDate);
    if (dto.startDate) this.assertActorMayUseDate(dto.startDate, actor);
    this.assertWithinMembership(membership, startDate, endDate);
    this.assertDurationAllowed(membership, startDate, endDate);
    await this.assertNoOverlap(membership.id, startDate, endDate, hold.id);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MembershipHold, id, {
        startDate,
        endDate,
        reason: dto.reason ?? hold.reason,
      });
      await this.recalculateEndDate(manager, membership.id);
    });

    return this.findOne(id, actor);
  }

  /**
   * 홀딩 취소. 삭제하지 않고 상태만 바꾼다.
   *
   * 회원은 아직 시작되지 않은 홀딩만 취소할 수 있다.
   * 이미 진행 중인 홀딩을 되돌리는 것은 소급 처리이므로 OWNER의 영역이다.
   */
  async cancel(id: string, actor: Actor): Promise<HoldResponseDto> {
    const hold = await this.getHold(id, actor);

    if (hold.status === HoldStatus.CANCELLED) {
      throw new BusinessException(
        ErrorCode.INVALID_MEMBERSHIP_STATUS,
        '이미 취소된 홀딩입니다',
      );
    }

    if (actor.role === Role.MEMBER) {
      this.assertActorMayUseDate(hold.startDate, actor);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MembershipHold, id, {
        status: HoldStatus.CANCELLED,
      });
      await this.recalculateEndDate(manager, hold.userMembershipId);
    });

    return this.findOne(id, actor);
  }

  async findByMembership(
    userMembershipId: string,
    actor: Actor,
  ): Promise<HoldResponseDto[]> {
    await this.getMembership(userMembershipId, actor);

    const holds = await this.holdRepo.find({
      where: { userMembershipId, gymId: actor.gymId },
      order: { startDate: 'ASC' },
    });
    return holds.map((hold) => HoldResponseDto.from(hold));
  }

  /** 현재 홀딩 중인 건. 데스크가 현황을 파악한다 */
  async findInProgress(gymId: string): Promise<HoldResponseDto[]> {
    const now = today();
    const holds = await this.holdRepo
      .createQueryBuilder('hold')
      .where('hold.gymId = :gymId', { gymId })
      .andWhere('hold.status = :active', { active: HoldStatus.ACTIVE })
      .andWhere('hold.startDate <= :now', { now })
      .andWhere('hold.endDate >= :now', { now })
      .orderBy('hold.endDate', 'ASC')
      .getMany();

    return holds.map((hold) => HoldResponseDto.from(hold));
  }

  /**
   * 오늘 종료 예정인 홀딩.
   *
   * 데스크가 아침에 확인해 해제를 깜빡하는 일을 줄인다.
   * 회원이 하루를 손해보는 상황을 시스템이 예방하는 장치다. @see ADR-011
   */
  async findEndingToday(gymId: string): Promise<HoldResponseDto[]> {
    const holds = await this.holdRepo.find({
      where: { gymId, status: HoldStatus.ACTIVE, endDate: today() },
    });
    return holds.map((hold) => HoldResponseDto.from(hold));
  }

  async findOne(id: string, actor: Actor): Promise<HoldResponseDto> {
    return HoldResponseDto.from(await this.getHold(id, actor));
  }

  /**
   * 양도를 위해 진행 중·예정 홀딩을 정리한다.
   *
   * **단순 취소가 아니다.** 이미 지나간 홀딩 일수는 인정해야 한다.
   *
   * ```
   * 30일권 8/1~8/30, 8/5~8/9 홀딩, 8/7에 양도
   *
   * 취소하면      endDate 8/30 → 잔여 24일   ❌ 8/5·8/6 이틀을 손해
   * 조기 종료하면 홀딩을 8/5~8/6으로 단축
   *              endDate 9/1  → 잔여 26일   ✅
   * ```
   *
   * @see ADR-012
   */
  async settleHoldsForTransfer(
    manager: EntityManager,
    userMembershipId: string,
  ): Promise<void> {
    const now = today();
    const holds = await manager.find(MembershipHold, {
      where: { userMembershipId, status: HoldStatus.ACTIVE },
    });

    for (const hold of holds) {
      const alreadyEnded = daysBetween(hold.endDate, now) > 0;
      if (alreadyEnded) continue; // 완료된 홀딩은 이미 반영되어 있다

      const notStartedYet = daysBetween(now, hold.startDate) >= 0;
      if (notStartedYet) {
        // 오늘 시작이거나 미래 예정 → 홀딩된 날이 하루도 없으므로 취소
        await manager.update(MembershipHold, hold.id, {
          status: HoldStatus.CANCELLED,
        });
        continue;
      }

      // 진행 중 → 어제까지로 단축. 지나간 홀딩 일수는 보존된다
      await manager.update(MembershipHold, hold.id, {
        endDate: addDays(now, -1),
      });
    }

    await this.recalculateEndDate(manager, userMembershipId);
  }

  // ---------- 종료일 재계산 ----------

  /**
   * 회원권 종료일을 **처음부터 다시 계산**한다.
   *
   * ```
   * endDate = startDate + durationDays - 1 + (취소되지 않은 홀딩의 총 일수)
   * ```
   *
   * 증분 조정(+10 했다가 -5)을 쓰지 않는 이유:
   * 수정이 반복되거나 중간에 다른 변경이 끼면 숫자가 어긋나고 되돌리기 어렵다.
   * 전체 재계산은 몇 번을 수정해도 결과가 항상 정확하다. @see ADR-011
   */
  async recalculateEndDate(
    manager: EntityManager,
    userMembershipId: string,
  ): Promise<void> {
    const membership = await manager.findOne(UserMembership, {
      where: { id: userMembershipId },
      relations: { membershipType: true },
    });
    if (!membership) return;

    const holds = await manager.find(MembershipHold, {
      where: { userMembershipId, status: HoldStatus.ACTIVE },
    });

    const heldDays = holds.reduce(
      (sum, hold) => sum + daysBetween(hold.startDate, hold.endDate) + 1,
      0,
    );

    const endDate = addDays(
      membership.startDate,
      membership.membershipType.durationDays - 1 + heldDays,
    );

    await manager.update(UserMembership, userMembershipId, { endDate });
  }

  // ---------- 검증 ----------

  private assertDateOrder(startDate: string, endDate: string): void {
    if (daysBetween(startDate, endDate) < 0) {
      throw new BusinessException(
        ErrorCode.HOLD_OUT_OF_RANGE,
        '종료일이 시작일보다 빠릅니다',
      );
    }
  }

  /**
   * 회원은 과거 날짜로 홀딩할 수 없다.
   *
   * 지난주에 나오지 않은 것을 나중에 "그때 홀딩이었다"로 돌려받는 악용을 막는다.
   * 데스크는 "회원이 전화했는데 처리를 깜빡했다" 같은 정당한 소급이 필요하므로 허용한다.
   */
  private assertActorMayUseDate(startDate: string, actor: Actor): void {
    if (actor.role !== Role.MEMBER) return;

    if (daysBetween(today(), startDate) < 0) {
      throw new BusinessException(ErrorCode.HOLD_PAST_DATE_FORBIDDEN);
    }
  }

  private assertWithinMembership(
    membership: UserMembership,
    startDate: string,
    endDate: string,
  ): void {
    // 회원권 시작 전에는 홀딩할 이유가 없다. 시작일을 미루면 될 일이다
    if (daysBetween(membership.startDate, startDate) < 0) {
      throw new BusinessException(
        ErrorCode.HOLD_OUT_OF_RANGE,
        '회원권 시작일 이전에는 홀딩할 수 없습니다',
      );
    }
    if (daysBetween(endDate, membership.endDate) < 0) {
      throw new BusinessException(
        ErrorCode.HOLD_OUT_OF_RANGE,
        '회원권 종료일 이후에는 홀딩할 수 없습니다',
      );
    }
  }

  private assertDurationAllowed(
    membership: UserMembership,
    startDate: string,
    endDate: string,
  ): void {
    const days = daysBetween(startDate, endDate) + 1;
    const max = membership.membershipType.holdingMaxDays;

    if (days > max) {
      throw new BusinessException(
        ErrorCode.HOLD_DURATION_EXCEEDED,
        `1회 최대 ${max}일까지 홀딩할 수 있습니다`,
      );
    }
  }

  private async assertCountAllowed(
    membership: UserMembership,
    excludeHoldId: string | null,
  ): Promise<void> {
    const limit = membership.membershipType.holdingLimit;

    if (limit === 0) {
      throw new BusinessException(
        ErrorCode.HOLD_LIMIT_EXCEEDED,
        '홀딩할 수 없는 회원권입니다',
      );
    }

    const qb = this.holdRepo
      .createQueryBuilder('hold')
      .where('hold.userMembershipId = :id', { id: membership.id })
      .andWhere('hold.status = :active', { active: HoldStatus.ACTIVE });

    if (excludeHoldId) {
      qb.andWhere('hold.id != :excludeId', { excludeId: excludeHoldId });
    }

    const used = await qb.getCount();
    if (used >= limit) {
      throw new BusinessException(
        ErrorCode.HOLD_LIMIT_EXCEEDED,
        `홀딩은 최대 ${limit}회까지 가능합니다`,
      );
    }
  }

  /** 같은 회원권에 기간이 겹치는 홀딩이 있으면 일수 계산이 이중으로 반영된다 */
  private async assertNoOverlap(
    userMembershipId: string,
    startDate: string,
    endDate: string,
    excludeHoldId: string | null,
  ): Promise<void> {
    const qb = this.holdRepo
      .createQueryBuilder('hold')
      .where('hold.userMembershipId = :id', { id: userMembershipId })
      .andWhere('hold.status = :active', { active: HoldStatus.ACTIVE })
      // 겹침 판정: 서로의 시작일이 상대의 종료일 이전인가
      .andWhere('hold.startDate <= :endDate', { endDate })
      .andWhere('hold.endDate >= :startDate', { startDate });

    if (excludeHoldId) {
      qb.andWhere('hold.id != :excludeId', { excludeId: excludeHoldId });
    }

    if (await qb.getExists()) {
      throw new BusinessException(ErrorCode.HOLD_OVERLAPPED);
    }
  }

  // ---------- 조회 ----------

  private async getMembership(
    id: string,
    actor: Actor,
  ): Promise<UserMembership> {
    const membership = await this.membershipRepo.findOne({
      where: { id, gymId: actor.gymId },
      relations: { membershipType: true },
    });
    if (!membership) {
      throw new BusinessException(ErrorCode.MEMBERSHIP_NOT_FOUND);
    }

    // 회원은 본인 회원권만 다룰 수 있다
    if (actor.role === Role.MEMBER && membership.userId !== actor.userId) {
      throw new BusinessException(ErrorCode.MEMBERSHIP_NOT_FOUND);
    }

    if (membership.status === MembershipStatus.CANCELLED) {
      throw new BusinessException(
        ErrorCode.INVALID_MEMBERSHIP_STATUS,
        '취소된 회원권은 홀딩할 수 없습니다',
      );
    }

    return membership;
  }

  private async getHold(id: string, actor: Actor): Promise<MembershipHold> {
    const hold = await this.holdRepo.findOne({
      where: { id, gymId: actor.gymId },
      relations: { userMembership: true },
    });
    if (!hold) throw new BusinessException(ErrorCode.HOLD_NOT_FOUND);

    if (
      actor.role === Role.MEMBER &&
      hold.userMembership.userId !== actor.userId
    ) {
      throw new BusinessException(ErrorCode.HOLD_NOT_FOUND);
    }

    return hold;
  }
}
