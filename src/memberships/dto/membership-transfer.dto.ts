import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { MembershipTransfer } from '../entities/membership-transfer.entity';

export class TransferMembershipDto {
  /** 양수인(받는 회원) ID */
  @IsUUID()
  toUserId: string;

  /**
   * 양도 수수료. 생략하거나 0이면 결제 기록을 만들지 않는다.
   *
   * 가족 양도는 무료, 지인 양도는 5만원 등 헬스장마다 다르므로 금액을 입력받는다.
   * 무료 양도에 0원짜리 결제가 쌓이면 매출 통계가 지저분해진다. @see ADR-012
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class TransferResponseDto {
  id: string;
  /** 양도인의 원본 회원권 (TRANSFERRED 상태) */
  fromMembershipId: string;
  /** 양수인에게 새로 만들어진 회원권 */
  toMembershipId: string;
  fromUserId: string;
  toUserId: string;
  /** 실제로 넘긴 일수. 홀딩 정리 후 확정된 값 */
  transferredDays: number;
  /** 수수료를 받았으면 금액, 무료면 null */
  fee: number | null;
  memo: string | null;
  createdAt: Date;

  static from(transfer: MembershipTransfer): TransferResponseDto {
    const dto = new TransferResponseDto();
    dto.id = transfer.id;
    dto.fromMembershipId = transfer.fromMembershipId;
    dto.toMembershipId = transfer.toMembershipId;
    dto.fromUserId = transfer.fromUserId;
    dto.toUserId = transfer.toUserId;
    dto.transferredDays = transfer.transferredDays;
    dto.fee = transfer.feePayment?.amount ?? null;
    dto.memo = transfer.memo;
    dto.createdAt = transfer.createdAt;
    return dto;
  }
}
