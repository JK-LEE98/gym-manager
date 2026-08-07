import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HoldsService } from './holds.service';
import {
  CreateHoldDto,
  HoldResponseDto,
  UpdateHoldDto,
} from './dto/membership-hold.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
// import type이 필요하다. isolatedModules + emitDecoratorMetadata 조합에서
// 데코레이터가 붙은 시그니처에 인터페이스를 쓰면 런타임 참조가 깨진다 → 학습 노트 2-8
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * 홀딩(휴회).
 *
 * 회원과 데스크 모두 사용한다. 권한에 따라 허용 범위가 다르다.
 * - 회원: 미래 날짜만. 본인 회원권만. 시작 전 취소만
 * - OWNER: 과거 소급 가능. 헬스장 전체
 * @see ADR-011
 */
@ApiTags('Holds')
@Controller('holds')
export class HoldsController {
  constructor(private readonly service: HoldsService) {}

  /** 고정 경로를 :id 보다 먼저 선언해야 ParseUUIDPipe에 걸리지 않는다 */
  @Roles(Role.OWNER)
  @Get('in-progress')
  @ApiOperation({ summary: '현재 홀딩 중인 목록' })
  @ApiCommonResponse(HoldResponseDto, { isArray: true })
  findInProgress(
    @CurrentUser('gymId') gymId: string,
  ): Promise<HoldResponseDto[]> {
    return this.service.findInProgress(gymId);
  }

  @Roles(Role.OWNER)
  @Get('ending-today')
  @ApiOperation({
    summary: '오늘 종료 예정인 홀딩',
    description:
      '데스크가 아침에 확인해 해제를 깜빡하는 일을 줄인다. ' +
      '회원이 하루를 손해보는 상황을 예방하는 장치다.',
  })
  @ApiCommonResponse(HoldResponseDto, { isArray: true })
  findEndingToday(
    @CurrentUser('gymId') gymId: string,
  ): Promise<HoldResponseDto[]> {
    return this.service.findEndingToday(gymId);
  }

  @Post()
  @ResponseMessage('홀딩이 등록되었습니다')
  @ApiOperation({
    summary: '홀딩 등록',
    description:
      '회원은 미래 날짜만 가능하다. 과거 소급은 OWNER만 할 수 있다. ' +
      '등록 즉시 회원권 종료일이 홀딩 일수만큼 연장된다.',
  })
  @ApiCommonResponse(HoldResponseDto, { status: 201 })
  @ApiErrorResponse(
    400,
    [ErrorCode.HOLD_DURATION_EXCEEDED, ErrorCode.HOLD_OUT_OF_RANGE],
    '1회 최대 일수 초과 또는 회원권 기간 밖',
  )
  @ApiErrorResponse(
    403,
    [ErrorCode.HOLD_PAST_DATE_FORBIDDEN],
    '회원이 과거 날짜로 시도',
  )
  @ApiErrorResponse(
    409,
    [ErrorCode.HOLD_LIMIT_EXCEEDED, ErrorCode.HOLD_OVERLAPPED],
    '횟수 초과 또는 기간 겹침',
  )
  create(
    @Body() dto: CreateHoldDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<HoldResponseDto> {
    return this.service.create(dto, {
      userId: user.sub,
      role: user.role,
      gymId: user.gymId!,
    });
  }

  @Get()
  @ApiOperation({
    summary: '회원권별 홀딩 이력',
    description: '회원은 본인 회원권만 조회할 수 있다.',
  })
  @ApiCommonResponse(HoldResponseDto, { isArray: true })
  findByMembership(
    @Query('userMembershipId', ParseUUIDPipe) userMembershipId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<HoldResponseDto[]> {
    return this.service.findByMembership(userMembershipId, {
      userId: user.sub,
      role: user.role,
      gymId: user.gymId!,
    });
  }

  @Patch(':id')
  @ResponseMessage('홀딩 일정이 변경되었습니다')
  @ApiOperation({
    summary: '홀딩 일정 변경',
    description:
      '회원 사정이 바뀌는 것은 일상적이므로 수정을 허용한다. ' +
      '변경 시 회원권 종료일이 전체 재계산된다.',
  })
  @ApiCommonResponse(HoldResponseDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHoldDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<HoldResponseDto> {
    return this.service.update(id, dto, {
      userId: user.sub,
      role: user.role,
      gymId: user.gymId!,
    });
  }

  @Patch(':id/cancel')
  @ResponseMessage('홀딩이 취소되었습니다')
  @ApiOperation({
    summary: '홀딩 취소',
    description:
      '회원은 아직 시작되지 않은 홀딩만 취소할 수 있다. ' +
      '진행 중인 홀딩을 되돌리는 것은 소급 처리이므로 OWNER의 영역이다.',
  })
  @ApiCommonResponse(HoldResponseDto)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<HoldResponseDto> {
    return this.service.cancel(id, {
      userId: user.sub,
      role: user.role,
      gymId: user.gymId!,
    });
  }
}
