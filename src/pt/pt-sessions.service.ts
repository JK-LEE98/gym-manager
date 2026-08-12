import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';
import { PTSchedule, PTScheduleStatus } from './entities/pt-schedule.entity';
import { PTContract, PTContractStatus } from './entities/pt-contract.entity';
import { Actor } from './pt-schedules.service';
import { NoShowDto, PTScheduleResponseDto } from './dto/pt-schedule.dto';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';

/**
 * 수업 확정 처리.
 *
 * **잔여 횟수 차감이 일어나는 유일한 지점이다.**
 * 시스템은 수업이 실제로 진행됐는지 알 수 없어(출석과 달리 QR 같은 증거가 없다)
 * 사람이 확인 버튼을 눌러야만 차감된다. 자정 일괄 처리는 하지 않는다. @see ADR-014 결정 3
 *
 * ---
 *
 * **동시성은 조건부 UPDATE로 푼다. 락도 재시도도 없다.**
 *
 * 읽고(SELECT) → 판단하고 → 쓰는(UPDATE) 방식은 그 사이가 비어 있다.
 * ```
 * A: 읽음 remaining=1
 * B: 읽음 remaining=1     ← A가 아직 안 썼다
 * A: 1 > 0 통과 → 0 저장
 * B: 1 > 0 통과 → 0 저장  ← A의 갱신을 덮어쓴다 (lost update)
 * → 수업 2회가 소진됐는데 차감은 1회
 * ```
 *
 * 조건을 UPDATE 안에 넣으면 그 틈이 사라진다.
 * ```
 * UPDATE는 실행되는 순간 행에 배타 락을 잡고,
 * 락을 잡은 뒤에 WHERE 조건을 다시 평가한다.
 *
 * A: UPDATE … WHERE remaining > 0  → 락 획득, 조건 참  → 1 row
 * B: UPDATE … WHERE remaining > 0  → A 커밋 대기 → 재평가 → 거짓 → 0 row
 * ```
 * @see ADR-014 결정 5
 */
@Injectable()
export class PTSessionsService {
  constructor(
    @InjectRepository(PTSchedule)
    private readonly scheduleRepo: Repository<PTSchedule>,
    private readonly dataSource: DataSource,
  ) {}

  /** 수업 완료 확정 → 잔여 횟수 1 차감 */
  async complete(id: string, actor: Actor): Promise<PTScheduleResponseDto> {
    const schedule = await this.getForConfirm(id, actor);

    await this.dataSource.transaction(async (manager) => {
      await this.claim(manager, schedule.id, {
        status: PTScheduleStatus.COMPLETED,
        sessionDeducted: true,
        confirmedByUserId: actor.userId,
      });

      await this.deduct(manager, schedule.contractId);
    });

    return this.findOne(id, actor.gymId);
  }

  /**
   * 노쇼 처리.
   *
   * **차감 여부를 트레이너가 정한다.** 헬스장·사유마다 다르기 때문이다.
   * `status`와 `sessionDeducted`를 분리해 "노쇼였지만 봐준" 경우에도
   * 노쇼 이력이 남게 한다. @see ADR-014 결정 4
   */
  async noShow(
    id: string,
    dto: NoShowDto,
    actor: Actor,
  ): Promise<PTScheduleResponseDto> {
    const schedule = await this.getForConfirm(id, actor);

    await this.dataSource.transaction(async (manager) => {
      await this.claim(manager, schedule.id, {
        status: PTScheduleStatus.NO_SHOW,
        sessionDeducted: dto.deductSession,
        confirmedByUserId: actor.userId,
      });

      if (dto.deductSession) {
        await this.deduct(manager, schedule.contractId);
      }
    });

    return this.findOne(id, actor.gymId);
  }

  /**
   * 미확인 목록 — 수업 시간이 지났는데 아무도 확인하지 않은 예약.
   *
   * **배치가 아니라 조회다.** 자정에 일괄 완료 처리하면 하지 않은 수업도 차감된다.
   * `GET /holds/ending-today`와 같은 패턴으로, 놓치지 않게 보여주되 누르는 것은 사람이다.
   */
  async findUnconfirmed(actor: Actor): Promise<PTScheduleResponseDto[]> {
    const rows = await this.scheduleRepo.find({
      where: {
        gymId: actor.gymId,
        status: PTScheduleStatus.SCHEDULED,
        endAt: LessThan(new Date()),
        // 트레이너는 본인 수업만, OWNER는 헬스장 전체를 본다
        ...(actor.role === Role.TRAINER ? { trainerId: actor.userId } : {}),
      },
      relations: { trainer: true, member: true },
      order: { startAt: 'ASC' },
    });

    return rows.map((row) => PTScheduleResponseDto.from(row));
  }

  /**
   * 수업을 선점한다. **먼저 잡고 나서 차감한다.**
   *
   * `WHERE status = 'SCHEDULED'`가 중복 클릭을 막는다.
   * 두 번째 요청은 첫 번째의 커밋을 기다렸다가 조건을 다시 평가해 0 row를 얻는다.
   *
   * 차감을 먼저 하면 차감은 됐는데 수업이 이미 처리된 상태일 수 있어
   * 롤백 범위가 넓어진다. 선점이 앞이다.
   */
  private async claim(
    manager: EntityManager,
    scheduleId: string,
    changes: Partial<PTSchedule>,
  ): Promise<void> {
    const result = await manager.update(
      PTSchedule,
      { id: scheduleId, status: PTScheduleStatus.SCHEDULED },
      changes,
    );

    if (result.affected === 0) {
      throw new BusinessException(ErrorCode.INVALID_SCHEDULE_STATUS);
    }
  }

  /**
   * 잔여 횟수 1 차감. 다 쓰면 계약을 종료한다.
   *
   * `remaining_sessions - 1`을 **애플리케이션이 계산하지 않는다.**
   * 값을 읽어와 빼면 읽은 시점의 값으로 계산하게 되어 다른 갱신을 덮어쓴다.
   * SQL 안에서 빼면 DB가 현재 값을 기준으로 계산한다.
   */
  private async deduct(
    manager: EntityManager,
    contractId: string,
  ): Promise<void> {
    const result = await manager.update(
      PTContract,
      { id: contractId, remainingSessions: MoreThan(0) },
      { remainingSessions: () => '"remaining_sessions" - 1' },
    );

    if (result.affected === 0) {
      throw new BusinessException(ErrorCode.NO_REMAINING_SESSIONS);
    }

    // 잔여가 0이 되면 계약을 종료한다.
    // COMPLETED는 사람이 누르는 상태가 아니라 잔여 소진의 종착점이라
    // 예외적으로 시스템이 확정한다. 조건이 SQL 안에 있어 여기도 경합이 없다.
    await manager.update(
      PTContract,
      {
        id: contractId,
        remainingSessions: 0,
        status: PTContractStatus.ACTIVE,
      },
      { status: PTContractStatus.COMPLETED },
    );
  }

  /**
   * 권한·존재 확인.
   *
   * 상태 검사도 하지만 **여기서의 검사는 빠른 실패용일 뿐이다.**
   * 실제 보증은 `claim`의 조건부 UPDATE가 한다.
   */
  private async getForConfirm(id: string, actor: Actor): Promise<PTSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id, gymId: actor.gymId },
    });
    if (!schedule) {
      throw new BusinessException(ErrorCode.PT_SCHEDULE_NOT_FOUND);
    }
    // 담당 트레이너만 확정한다. OWNER는 분쟁 시 정정할 수 있다
    if (actor.role === Role.TRAINER && schedule.trainerId !== actor.userId) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }
    if (schedule.status !== PTScheduleStatus.SCHEDULED) {
      throw new BusinessException(ErrorCode.INVALID_SCHEDULE_STATUS);
    }
    return schedule;
  }

  private async findOne(
    id: string,
    gymId: string,
  ): Promise<PTScheduleResponseDto> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id, gymId },
      relations: { trainer: true, member: true },
    });
    if (!schedule) {
      throw new BusinessException(ErrorCode.PT_SCHEDULE_NOT_FOUND);
    }
    return PTScheduleResponseDto.from(schedule);
  }
}
