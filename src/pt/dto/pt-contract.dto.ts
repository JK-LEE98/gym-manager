import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { PTContract, PTContractStatus } from '../entities/pt-contract.entity';
import { PaymentMethod } from '../../memberships/entities/payment.entity';
import { daysUntil } from '../../common/utils/date.util';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePTContractDto {
  @IsUUID()
  memberId: string;

  /** 담당 트레이너. 계약 시 배정되고 1:1로 고정된다 */
  @IsUUID()
  trainerId: string;

  @IsInt()
  @Min(1)
  totalSessions: number;

  /**
   * 실제 결제 금액.
   *
   * PT는 회원권과 달리 정가표가 없다. 횟수·트레이너·협상에 따라 매번 다르므로
   * 항상 입력받는다. 회원권의 `amount`가 선택 입력인 것과 다른 점이다.
   */
  @IsInt()
  @Min(0)
  amount: number;

  @IsString()
  @Matches(DATE_PATTERN, {
    message: 'startDate는 YYYY-MM-DD 형식이어야 합니다',
  })
  startDate: string;

  /** 이용 만료일. 이 날까지 잔여 횟수를 쓸 수 있다 */
  @IsString()
  @Matches(DATE_PATTERN, { message: 'endDate는 YYYY-MM-DD 형식이어야 합니다' })
  endDate: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class PTContractResponseDto {
  id: string;
  memberId: string;
  memberName: string;
  trainerId: string;
  trainerName: string;
  totalSessions: number;
  remainingSessions: number;
  startDate: string;
  endDate: string;
  /** 만료까지 남은 일수. 회원권과 같은 D-day 표기 */
  daysUntilExpiry: number;
  status: PTContractStatus;
  memo: string | null;
  payment: {
    amount: number;
    method: PaymentMethod;
  } | null;

  static from(contract: PTContract): PTContractResponseDto {
    const dto = new PTContractResponseDto();
    dto.id = contract.id;
    dto.memberId = contract.memberId;
    dto.memberName = contract.member?.name ?? '';
    dto.trainerId = contract.trainerId;
    dto.trainerName = contract.trainer?.name ?? '';
    dto.totalSessions = contract.totalSessions;
    dto.remainingSessions = contract.remainingSessions;
    dto.startDate = contract.startDate;
    dto.endDate = contract.endDate;
    dto.daysUntilExpiry = daysUntil(contract.endDate);
    dto.status = contract.status;
    dto.memo = contract.memo;
    dto.payment = contract.payment
      ? {
          amount: contract.payment.amount,
          method: contract.payment.method,
        }
      : null;
    return dto;
  }
}

export class PTContractQueryDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsUUID()
  trainerId?: string;
}
