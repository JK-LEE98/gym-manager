import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import {
  AttendanceQueryDto,
  AttendanceResponseDto,
  CheckInDto,
  CheckInResponseDto,
  ManualCheckInDto,
  QrTokenResponseDto,
} from './dto/attendance.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';

@ApiTags('Attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  // 고정 경로를 먼저 선언한다
  @Get('qr-token')
  @ApiOperation({
    summary: 'QR 토큰 발급',
    description:
      '유효시간 30초의 단기 토큰이다. 클라이언트가 QR로 렌더링한다. ' +
      'Access Token과 시크릿이 분리되어 있어 이 토큰으로는 다른 API를 호출할 수 없다.',
  })
  @ApiCommonResponse(QrTokenResponseDto)
  async issueQrToken(
    @CurrentUser('sub') userId: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<QrTokenResponseDto> {
    const token = await this.service.issueQrToken(userId, gymId);
    return QrTokenResponseDto.from(token);
  }

  @Get('me')
  @ApiOperation({ summary: '본인 출석 이력' })
  @ApiCommonResponse(AttendanceResponseDto, { isArray: true })
  findMine(
    @CurrentUser('sub') userId: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<AttendanceResponseDto[]> {
    return this.service.findMine(userId, gymId);
  }

  @Roles(Role.OWNER)
  @Post('check-in')
  @ResponseMessage('출석이 완료되었습니다')
  @ApiOperation({
    summary: 'QR 스캔 출석',
    description:
      '입구 단말이 호출한다. 응답에는 마스킹된 이름만 담긴다 — ' +
      '문 앞 화면은 지나가는 사람에게도 보이기 때문이다. ' +
      '재출입 유예 시간 안이면 회원권·횟수 검사를 건너뛰고 기록만 남긴다.',
  })
  @ApiCommonResponse(CheckInResponseDto, {
    status: 201,
    message: '출석이 완료되었습니다',
  })
  @ApiErrorResponse(
    401,
    [ErrorCode.QR_TOKEN_EXPIRED, ErrorCode.INVALID_TOKEN_TYPE],
    'QR 만료 또는 출석용이 아닌 토큰',
  )
  @ApiErrorResponse(
    403,
    [
      ErrorCode.TENANT_MISMATCH,
      ErrorCode.MEMBERSHIP_ON_HOLD,
      ErrorCode.NO_ACTIVE_MEMBERSHIP,
    ],
    '다른 헬스장 QR, 휴회 중, 회원권 없음',
  )
  @ApiErrorResponse(
    409,
    [ErrorCode.DAILY_ENTRY_LIMIT_EXCEEDED],
    '하루 입장 횟수 초과',
  )
  checkIn(
    @Body() dto: CheckInDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<CheckInResponseDto> {
    return this.service.checkInByQr(dto.token, gymId);
  }

  @Roles(Role.OWNER)
  @Post('manual')
  @ResponseMessage('출석이 완료되었습니다')
  @ApiOperation({
    summary: '수동 출석 처리',
    description:
      '배터리 방전 등 QR을 쓸 수 없는 상황에서 데스크가 대신 처리한다. ' +
      '검증은 QR과 동일하다. 수동이 뒷문이 되면 정책 자체가 무의미해진다.',
  })
  @ApiCommonResponse(CheckInResponseDto, {
    status: 201,
    message: '출석이 완료되었습니다',
  })
  checkInManually(
    @Body() dto: ManualCheckInDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<CheckInResponseDto> {
    return this.service.checkInManually(dto, gymId);
  }

  @Roles(Role.OWNER)
  @Get()
  @ApiOperation({
    summary: '출석 이력 조회',
    description:
      '재입장(isReentry=true)도 함께 반환한다. 출입 로그는 온전해야 한다. ' +
      '출석 "일수"를 세려면 isReentry=false만 카운트한다.',
  })
  @ApiCommonResponse(AttendanceResponseDto, { isArray: true })
  findAll(
    @Query() query: AttendanceQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<AttendanceResponseDto[]> {
    return this.service.findAll(query, gymId);
  }
}
