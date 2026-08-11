import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { Attendance, AttendanceMethod } from '../entities/attendance.entity';
import { maskName } from '../../common/utils/mask.util';
import { QR_TOKEN_TTL_SECONDS } from '../qr-token.service';

export class QrTokenResponseDto {
  /** 클라이언트가 이 문자열을 QR로 렌더링한다 */
  token: string;
  expiresIn: number;
  expiresAt: Date;

  static from(token: string): QrTokenResponseDto {
    const dto = new QrTokenResponseDto();
    dto.token = token;
    dto.expiresIn = QR_TOKEN_TTL_SECONDS;
    dto.expiresAt = new Date(Date.now() + QR_TOKEN_TTL_SECONDS * 1000);
    return dto;
  }
}

export class CheckInDto {
  @IsString()
  token: string;
}

export class ManualCheckInDto {
  @IsUUID()
  userId: string;

  /** 생략하면 현재 시각. 지난 시간을 놓쳤을 때 데스크가 지정한다 */
  @IsOptional()
  @IsISO8601()
  checkedAt?: string;
}

/**
 * 출입구 화면에 그대로 뿌려지는 응답.
 *
 * **풀네임을 담지 않는다.** 문 앞 화면은 지나가는 사람에게도 보인다.
 * 데스크 응대에 실명이 필요하면 `GET /users`를 쓴다.
 * 용도가 다른 화면을 한 응답으로 만족시키려 하면 항상 더 넓은 쪽에 맞춰지고,
 * 보안은 좁은 쪽 기준으로 무너진다. @see ADR-013
 */
export class CheckInResponseDto {
  /** `이*규` */
  maskedName: string;
  checkedAt: Date;
  /** 유예 시간 안의 재입장이면 true. 입장 횟수에 세지 않았다는 뜻 */
  isReentry: boolean;
  /**
   * 만료까지 남은 일수. 재입장이면 회원권 검사를 건너뛰므로 null.
   *
   * 화면: `회원권이 87일 후에 만료됩니다`
   */
  daysUntilExpiry: number | null;

  static from(
    attendance: Attendance,
    name: string,
    daysUntilExpiry: number | null,
  ): CheckInResponseDto {
    const dto = new CheckInResponseDto();
    dto.maskedName = maskName(name);
    dto.checkedAt = attendance.checkedAt;
    dto.isReentry = attendance.isReentry;
    dto.daysUntilExpiry = daysUntilExpiry;
    return dto;
  }
}

/** 데스크·회원의 이력 조회용. 여기서는 실명을 그대로 노출한다 */
export class AttendanceResponseDto {
  id: string;
  userId: string;
  userName: string;
  checkedAt: Date;
  method: AttendanceMethod;
  isReentry: boolean;

  static from(attendance: Attendance): AttendanceResponseDto {
    const dto = new AttendanceResponseDto();
    dto.id = attendance.id;
    dto.userId = attendance.userId;
    dto.userName = attendance.user?.name ?? '';
    dto.checkedAt = attendance.checkedAt;
    dto.method = attendance.method;
    dto.isReentry = attendance.isReentry;
    return dto;
  }
}

export class AttendanceQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** `YYYY-MM-DD` */
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
