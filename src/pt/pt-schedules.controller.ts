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
import { Actor, PTSchedulesService } from './pt-schedules.service';
import {
  CreatePTScheduleDto,
  CreateRecurringScheduleDto,
  PTScheduleQueryDto,
  PTScheduleResponseDto,
  RecurringScheduleResponseDto,
  UpdatePTScheduleDto,
} from './dto/pt-schedule.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
// isolatedModules + emitDecoratorMetadata 조합에서 데코레이터가 붙은
// 시그니처에 인터페이스를 쓰면 런타임 참조가 깨진다 → 학습 노트 2-8
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

function toActor(user: JwtPayload): Actor {
  return { userId: user.sub, role: user.role, gymId: user.gymId! };
}

@ApiTags('PTSchedules')
@Controller('pt/schedules')
export class PTSchedulesController {
  constructor(private readonly service: PTSchedulesService) {}

  // 고정 경로를 ':id' 보다 먼저 선언해야 UUID로 해석되지 않는다
  @Get('me')
  @ApiOperation({
    summary: '본인 일정',
    description: '트레이너는 가르치는 수업을, 회원은 받는 수업을 조회한다.',
  })
  @ApiCommonResponse(PTScheduleResponseDto, { isArray: true })
  findMine(
    @Query() query: PTScheduleQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PTScheduleResponseDto[]> {
    return this.service.findMine(toActor(user), query);
  }

  @Roles(Role.TRAINER)
  @Post()
  @ResponseMessage('예약이 등록되었습니다')
  @ApiOperation({
    summary: '예약 등록',
    description:
      '카톡·전화로 정한 시간을 트레이너가 입력한다. 회원이 직접 예약하지 않는다. ' +
      '시간 겹침은 PostgreSQL EXCLUDE 제약이 막는다.',
  })
  @ApiCommonResponse(PTScheduleResponseDto, { status: 201 })
  @ApiErrorResponse(
    400,
    [ErrorCode.SCHEDULE_OUT_OF_CONTRACT_RANGE],
    '계약 기간 밖',
  )
  @ApiErrorResponse(
    409,
    [ErrorCode.SCHEDULE_OVERLAPPED, ErrorCode.INVALID_CONTRACT_STATUS],
    '시간 겹침 또는 이용 중이 아닌 계약',
  )
  create(
    @Body() dto: CreatePTScheduleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PTScheduleResponseDto> {
    return this.service.create(dto, toActor(user));
  }

  @Roles(Role.TRAINER)
  @Post('recurring')
  @ResponseMessage('반복 예약이 등록되었습니다')
  @ApiOperation({
    summary: '반복 예약 일괄 등록',
    description:
      '"매주 화·목 19시, 9월 한 달"처럼 고정 스케줄을 한 번에 잡는다. ' +
      '겹치는 날은 건너뛰고 skipped로 알려준다. 하나가 겹쳤다고 전체를 롤백하지 않는다.',
  })
  @ApiCommonResponse(RecurringScheduleResponseDto, { status: 201 })
  createRecurring(
    @Body() dto: CreateRecurringScheduleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RecurringScheduleResponseDto> {
    return this.service.createRecurring(dto, toActor(user));
  }

  @Roles(Role.OWNER)
  @Get()
  @ApiOperation({
    summary: '헬스장 전체 일정',
    description: 'trainerId·memberId·기간으로 필터링한다.',
  })
  @ApiCommonResponse(PTScheduleResponseDto, { isArray: true })
  findAll(
    @Query() query: PTScheduleQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<PTScheduleResponseDto[]> {
    return this.service.findAll(query, gymId);
  }

  @Roles(Role.TRAINER)
  @Patch(':id')
  @ResponseMessage('일정이 변경되었습니다')
  @ApiOperation({
    summary: '일정 이동',
    description:
      '트레이너에게 급한 일이 생기는 것은 일상적이다. 이미 확정된 수업은 옮길 수 없다.',
  })
  @ApiCommonResponse(PTScheduleResponseDto)
  @ApiErrorResponse(409, [ErrorCode.SCHEDULE_OVERLAPPED], '옮긴 시간이 겹침')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePTScheduleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PTScheduleResponseDto> {
    return this.service.update(id, dto, toActor(user));
  }

  @Patch(':id/cancel')
  @ResponseMessage('예약이 취소되었습니다')
  @ApiOperation({
    summary: '예약 취소',
    description:
      '회원도 본인 수업은 취소할 수 있다. 취소된 자리에는 다시 예약할 수 있다.',
  })
  @ApiCommonResponse(PTScheduleResponseDto)
  @ApiErrorResponse(
    409,
    [ErrorCode.INVALID_SCHEDULE_STATUS],
    '이미 처리된 수업',
  )
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<PTScheduleResponseDto> {
    return this.service.cancel(id, toActor(user));
  }
}
