import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { PTSchedule, PTScheduleStatus } from './entities/pt-schedule.entity';
import { PTContract, PTContractStatus } from './entities/pt-contract.entity';
import {
  CreatePTScheduleDto,
  CreateRecurringScheduleDto,
  PTScheduleQueryDto,
  PTScheduleResponseDto,
  RecurringScheduleResponseDto,
  SkippedScheduleDto,
  UpdatePTScheduleDto,
} from './dto/pt-schedule.dto';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';

/** PostgreSQL exclusion_violation. EXCLUDE 제약을 어겼을 때 올라온다 */
const PG_EXCLUSION_VIOLATION = '23P01';

/** 요청자 컨텍스트. 토큰에서만 추출한다 @see ADR-004 */
export interface Actor {
  userId: string;
  role: Role;
  gymId: string;
}

@Injectable()
export class PTSchedulesService {
  constructor(
    @InjectRepository(PTSchedule)
    private readonly scheduleRepo: Repository<PTSchedule>,
    @InjectRepository(PTContract)
    private readonly contractRepo: Repository<PTContract>,
  ) {}

  /**
   * 예약 등록.
   *
   * 시간 겹침은 검사하지 않는다. **`EXCLUDE` 제약이 DB에서 막는다.**
   * 조회해서 판단하면 조회와 INSERT 사이가 비지만 제약에는 그 틈이 없다. @see ADR-014
   */
  async create(
    dto: CreatePTScheduleDto,
    actor: Actor,
  ): Promise<PTScheduleResponseDto> {
    const contract = await this.getContractForWrite(dto.contractId, actor);

    const startAt = new Date(dto.startAt);
    const endAt = addMinutes(startAt, dto.durationMinutes);
    this.assertWithinContract(contract, startAt);

    const saved = await this.insert(contract, startAt, endAt, dto.memo ?? null);
    return this.findOne(saved.id, actor);
  }

  /**
   * 반복 예약 일괄 등록.
   *
   * **하나가 겹쳤다고 전체를 롤백하지 않는다.**
   * 한 달치 9건 중 1건이 겹쳤다고 8건을 버리면 트레이너가 처음부터 다시 입력해야 한다.
   * 각 건을 독립적으로 넣고 건너뛴 것을 함께 돌려준다. @see ADR-014
   */
  async createRecurring(
    dto: CreateRecurringScheduleDto,
    actor: Actor,
  ): Promise<RecurringScheduleResponseDto> {
    const contract = await this.getContractForWrite(dto.contractId, actor);

    const created: PTScheduleResponseDto[] = [];
    const skipped: SkippedScheduleDto[] = [];

    for (const startAt of expandWeekdays(dto)) {
      if (!withinContract(contract, startAt)) {
        skipped.push({
          startAt,
          reason: ErrorCode.SCHEDULE_OUT_OF_CONTRACT_RANGE,
        });
        continue;
      }

      const endAt = addMinutes(startAt, dto.durationMinutes);
      try {
        const saved = await this.insert(
          contract,
          startAt,
          endAt,
          dto.memo ?? null,
        );
        created.push(await this.findOne(saved.id, actor));
      } catch (error) {
        if (
          error instanceof BusinessException &&
          error.errorCode === ErrorCode.SCHEDULE_OVERLAPPED
        ) {
          skipped.push({ startAt, reason: ErrorCode.SCHEDULE_OVERLAPPED });
          continue;
        }
        throw error;
      }
    }

    return { created, skipped };
  }

  /** 일정 이동. 트레이너에게 급한 일이 생기는 것은 일상적이다 */
  async update(
    id: string,
    dto: UpdatePTScheduleDto,
    actor: Actor,
  ): Promise<PTScheduleResponseDto> {
    const schedule = await this.getOrThrow(id, actor.gymId);
    this.assertTrainerOwns(schedule, actor);

    // 이미 확정된 수업은 옮길 수 없다. 지난 사실을 바꾸는 것이기 때문이다
    if (schedule.status !== PTScheduleStatus.SCHEDULED) {
      throw new BusinessException(ErrorCode.INVALID_SCHEDULE_STATUS);
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : schedule.startAt;
    const duration =
      dto.durationMinutes ??
      Math.round(
        (schedule.endAt.getTime() - schedule.startAt.getTime()) / 60_000,
      );
    const endAt = addMinutes(startAt, duration);

    const contract = await this.getContractForWrite(schedule.contractId, actor);
    this.assertWithinContract(contract, startAt);

    schedule.startAt = startAt;
    schedule.endAt = endAt;
    if (dto.memo !== undefined) schedule.memo = dto.memo;

    await this.save(schedule);
    return this.findOne(id, actor);
  }

  /**
   * 예약 취소.
   *
   * 회원도 본인 수업은 취소할 수 있다. 취소된 자리는 `EXCLUDE` 제약에서 제외되어
   * 같은 시간에 다시 예약할 수 있다.
   */
  async cancel(id: string, actor: Actor): Promise<PTScheduleResponseDto> {
    const schedule = await this.getOrThrow(id, actor.gymId);

    if (actor.role === Role.TRAINER && schedule.trainerId !== actor.userId) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }
    if (actor.role === Role.MEMBER && schedule.memberId !== actor.userId) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }
    if (schedule.status !== PTScheduleStatus.SCHEDULED) {
      throw new BusinessException(ErrorCode.INVALID_SCHEDULE_STATUS);
    }

    schedule.status = PTScheduleStatus.CANCELLED;
    await this.scheduleRepo.save(schedule);

    return this.findOne(id, actor);
  }

  async findOne(id: string, actor: Actor): Promise<PTScheduleResponseDto> {
    const schedule = await this.getOrThrow(id, actor.gymId);
    return PTScheduleResponseDto.from(schedule);
  }

  async findAll(
    query: PTScheduleQueryDto,
    gymId: string,
  ): Promise<PTScheduleResponseDto[]> {
    const where: FindOptionsWhere<PTSchedule> = { gymId };
    if (query.trainerId) where.trainerId = query.trainerId;
    if (query.memberId) where.memberId = query.memberId;
    if (query.from && query.to) {
      where.startAt = Between(dayStart(query.from), dayEnd(query.to));
    }

    return this.findBy(where);
  }

  /** 본인 일정. 트레이너는 가르치는 것, 회원은 받는 것 */
  async findMine(
    actor: Actor,
    query: PTScheduleQueryDto,
  ): Promise<PTScheduleResponseDto[]> {
    const where: FindOptionsWhere<PTSchedule> =
      actor.role === Role.TRAINER
        ? { gymId: actor.gymId, trainerId: actor.userId }
        : { gymId: actor.gymId, memberId: actor.userId };

    if (query.from && query.to) {
      where.startAt = Between(dayStart(query.from), dayEnd(query.to));
    }

    return this.findBy(where);
  }

  private async insert(
    contract: PTContract,
    startAt: Date,
    endAt: Date,
    memo: string | null,
  ): Promise<PTSchedule> {
    return this.save(
      this.scheduleRepo.create({
        gymId: contract.gymId,
        contractId: contract.id,
        trainerId: contract.trainerId,
        memberId: contract.memberId,
        startAt,
        endAt,
        memo,
      }),
    );
  }

  /**
   * EXCLUDE 제약 위반을 도메인 에러로 바꾼다.
   *
   * 제약 위반은 애플리케이션 예외가 아니라 `QueryFailedError`로 올라온다.
   * 그대로 두면 500이 되므로 PostgreSQL 코드 `23P01`을 잡아 409로 변환한다.
   * `23505`(unique_violation)를 다루는 것과 같은 방식이다.
   */
  private async save(schedule: PTSchedule): Promise<PTSchedule> {
    try {
      return await this.scheduleRepo.save(schedule);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code ===
          PG_EXCLUSION_VIOLATION
      ) {
        throw new BusinessException(ErrorCode.SCHEDULE_OVERLAPPED);
      }
      throw error;
    }
  }

  private async getContractForWrite(
    contractId: string,
    actor: Actor,
  ): Promise<PTContract> {
    const contract = await this.contractRepo.findOne({
      where: { id: contractId, gymId: actor.gymId },
    });
    if (!contract) {
      throw new BusinessException(ErrorCode.PT_CONTRACT_NOT_FOUND);
    }
    if (contract.status !== PTContractStatus.ACTIVE) {
      throw new BusinessException(ErrorCode.INVALID_CONTRACT_STATUS);
    }
    // 담당 트레이너만 자기 회원의 일정을 잡는다. 1:1 전속이라 대리 등록이 없다
    if (actor.role === Role.TRAINER && contract.trainerId !== actor.userId) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }
    return contract;
  }

  private assertWithinContract(contract: PTContract, startAt: Date): void {
    if (!withinContract(contract, startAt)) {
      throw new BusinessException(ErrorCode.SCHEDULE_OUT_OF_CONTRACT_RANGE);
    }
  }

  private assertTrainerOwns(schedule: PTSchedule, actor: Actor): void {
    if (actor.role === Role.TRAINER && schedule.trainerId !== actor.userId) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }
  }

  private async getOrThrow(id: string, gymId: string): Promise<PTSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id, gymId },
      relations: { trainer: true, member: true },
    });
    if (!schedule) {
      throw new BusinessException(ErrorCode.PT_SCHEDULE_NOT_FOUND);
    }
    return schedule;
  }

  private async findBy(
    where: FindOptionsWhere<PTSchedule>,
  ): Promise<PTScheduleResponseDto[]> {
    const rows = await this.scheduleRepo.find({
      where,
      relations: { trainer: true, member: true },
      order: { startAt: 'ASC' },
    });
    return rows.map((row) => PTScheduleResponseDto.from(row));
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** 계약 기간(날짜) 안인지. 시각은 보지 않는다 */
function withinContract(contract: PTContract, startAt: Date): boolean {
  const day = formatDate(startAt);
  return day >= contract.startDate && day <= contract.endDate;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayStart(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function dayEnd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/**
 * 요일 패턴을 실제 날짜로 펼친다.
 *
 * `from`부터 `to`까지 하루씩 훑으며 지정된 요일만 고른다.
 * 주 단위로 건너뛰지 않는 이유는 **월 경계와 서머타임을 신경 쓸 필요가 없기 때문**이다.
 * 한 달치라야 31번 반복이라 성능도 문제되지 않는다.
 */
function expandWeekdays(dto: CreateRecurringScheduleDto): Date[] {
  const [hour, minute] = dto.startTime.split(':').map(Number);
  const result: Date[] = [];

  const cursor = dayStart(dto.from);
  const last = dayStart(dto.to);

  while (cursor <= last) {
    if (dto.weekdays.includes(cursor.getDay())) {
      result.push(
        new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          hour,
          minute,
        ),
      );
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}
