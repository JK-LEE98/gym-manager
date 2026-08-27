import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PTSchedule, PTScheduleStatus } from '../entities/pt-schedule.entity';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePTScheduleDto {
  @IsUUID()
  contractId: string;

  @IsISO8601()
  startAt: string;

  /** 소요 시간(분). 종료 시각은 서버가 계산한다 */
  @IsInt()
  @Min(10)
  @Max(300)
  durationMinutes: number;

  @IsOptional()
  @IsString()
  memo?: string;
}

/**
 * 반복 예약.
 *
 * PT는 "매주 화·목 19시"처럼 고정 스케줄이 되는 경우가 대부분이라
 * 한 달치를 한 번에 잡는다. @see 도메인 지식 9장
 */
export class CreateRecurringScheduleDto {
  @IsUUID()
  contractId: string;

  /** 0=일 … 6=토. `Date.getDay()`와 같다 */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @Type(() => Number)
  weekdays: number[];

  /** `HH:mm` */
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime은 HH:mm 형식이어야 합니다' })
  startTime: string;

  @IsInt()
  @Min(10)
  @Max(300)
  durationMinutes: number;

  /** `YYYY-MM-DD` */
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from은 YYYY-MM-DD 형식이어야 합니다' })
  from: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'to는 YYYY-MM-DD 형식이어야 합니다' })
  to: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdatePTScheduleDto {
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class PTScheduleResponseDto {
  id: string;
  contractId: string;
  trainerId: string;
  trainerName: string;
  memberId: string;
  memberName: string;
  startAt: Date;
  endAt: Date;
  status: PTScheduleStatus;
  sessionDeducted: boolean;
  memo: string | null;

  static from(schedule: PTSchedule): PTScheduleResponseDto {
    const dto = new PTScheduleResponseDto();
    dto.id = schedule.id;
    dto.contractId = schedule.contractId;
    dto.trainerId = schedule.trainerId;
    dto.trainerName = schedule.trainer?.name ?? '';
    dto.memberId = schedule.memberId;
    dto.memberName = schedule.member?.name ?? '';
    dto.startAt = schedule.startAt;
    dto.endAt = schedule.endAt;
    dto.status = schedule.status;
    dto.sessionDeducted = schedule.sessionDeducted;
    dto.memo = schedule.memo;
    return dto;
  }
}

/** 건너뛴 날짜와 이유 */
export class SkippedScheduleDto {
  startAt: Date;
  reason: string;
}

/**
 * 반복 등록 결과.
 *
 * **하나가 겹쳤다고 전체를 롤백하지 않는다.**
 * 한 달치 9건 중 1건이 겹쳤다고 8건을 버리면 트레이너가 처음부터 다시 입력해야 한다.
 * 건너뛴 것을 알려주고 그것만 따로 잡게 하는 편이 실제 업무에 맞다. @see ADR-014
 */
export class RecurringScheduleResponseDto {
  created: PTScheduleResponseDto[];
  skipped: SkippedScheduleDto[];
}

export class NoShowDto {
  /**
   * 잔여 횟수를 차감할지.
   *
   * 헬스장·사유마다 다르고 트레이너 재량이라 매번 입력받는다.
   * `false`여도 `status`는 `NO_SHOW`로 남아 노쇼 이력이 사라지지 않는다.
   */
  @IsBoolean()
  deductSession: boolean;
}

export class PTScheduleQueryDto {
  @IsOptional()
  @IsUUID()
  trainerId?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  /** `YYYY-MM-DD` */
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  to?: string;
}
