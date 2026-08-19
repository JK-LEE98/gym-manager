import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import {
  MonthlyMemberDto,
  MonthlyRevenueDto,
  StatsQueryDto,
  TrainerStatsDto,
} from './dto/stats.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';

/**
 * 운영 통계. **OWNER 전용이다.**
 *
 * 트레이너에게 열면 동료의 실적을 볼 수 있고, 회원에게는 매출이 보인다.
 */
@ApiTags('Stats')
@Roles(Role.OWNER)
@Controller('stats')
export class StatsController {
  constructor(private readonly service: StatsService) {}

  @Get('revenue')
  @ApiOperation({
    summary: '월별·목적별 매출',
    description:
      '결제일에 전액 인식한다. 8월에 55만원짜리 12개월권을 팔면 8월 매출이 55만원이다. ' +
      '결제가 없는 달도 0으로 채워 반환하므로 차트에 구멍이 나지 않는다.',
  })
  @ApiCommonResponse(MonthlyRevenueDto, { isArray: true })
  @ApiErrorResponse(
    400,
    [ErrorCode.INVALID_DATE_RANGE],
    '시작일이 종료일보다 늦거나 60개월 초과',
  )
  revenue(
    @Query() query: StatsQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<MonthlyRevenueDto[]> {
    return this.service.revenue(query, gymId);
  }

  @Get('members')
  @ApiOperation({
    summary: '월별 신규 회원 수',
    description:
      '탈퇴한 회원도 센다. 등록했다는 사실은 나중에 나가도 바뀌지 않으므로, ' +
      '제외하면 지난달 숫자가 오늘 달라진다.',
  })
  @ApiCommonResponse(MonthlyMemberDto, { isArray: true })
  @ApiErrorResponse(400, [ErrorCode.INVALID_DATE_RANGE], '조회 기간 오류')
  members(
    @Query() query: StatsQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<MonthlyMemberDto[]> {
    return this.service.members(query, gymId);
  }

  @Get('trainers')
  @ApiOperation({
    summary: '트레이너별 PT 완료·노쇼',
    description:
      '기간 내 실적이 0건인 트레이너도 포함한다. ' +
      '노쇼를 함께 주는 이유는 완료 건수만으로는 일정 관리 문제가 보이지 않기 때문이다.',
  })
  @ApiCommonResponse(TrainerStatsDto, { isArray: true })
  @ApiErrorResponse(400, [ErrorCode.INVALID_DATE_RANGE], '조회 기간 오류')
  trainers(
    @Query() query: StatsQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<TrainerStatsDto[]> {
    return this.service.trainers(query, gymId);
  }
}
