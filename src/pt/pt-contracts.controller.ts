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
import { PTContractsService } from './pt-contracts.service';
import {
  CreatePTContractDto,
  PTContractQueryDto,
  PTContractResponseDto,
} from './dto/pt-contract.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';

@ApiTags('PTContracts')
@Controller('pt/contracts')
export class PTContractsController {
  constructor(private readonly service: PTContractsService) {}

  // 고정 경로를 ':id' 보다 먼저 선언해야 'me'가 UUID로 해석되지 않는다
  @Get('me')
  @ApiOperation({
    summary: '본인 관련 계약',
    description:
      '회원은 자기가 받는 계약을, 트레이너는 자기가 가르치는 계약을 조회한다.',
  })
  @ApiCommonResponse(PTContractResponseDto, { isArray: true })
  findMine(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: Role,
    @CurrentUser('gymId') gymId: string,
  ): Promise<PTContractResponseDto[]> {
    return this.service.findMine(userId, role, gymId);
  }

  @Roles(Role.OWNER)
  @Post()
  @ResponseMessage('PT 계약이 등록되었습니다')
  @ApiOperation({
    summary: 'PT 계약 등록',
    description:
      'Payment를 함께 생성한다(트랜잭션). 트레이너는 계약 시 배정되고 1:1로 고정된다. ' +
      'PT는 정가표가 없어 금액을 항상 입력받는다.',
  })
  @ApiCommonResponse(PTContractResponseDto, { status: 201 })
  @ApiErrorResponse(
    400,
    [ErrorCode.INVALID_TRAINER],
    'role=TRAINER가 아닌 계정 지정',
  )
  @ApiErrorResponse(404, [ErrorCode.USER_NOT_FOUND], '없거나 다른 헬스장 소속')
  create(
    @Body() dto: CreatePTContractDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<PTContractResponseDto> {
    return this.service.create(dto, gymId);
  }

  @Roles(Role.OWNER)
  @Get()
  @ApiOperation({
    summary: '계약 목록',
    description: 'memberId·trainerId로 필터링한다.',
  })
  @ApiCommonResponse(PTContractResponseDto, { isArray: true })
  findAll(
    @Query() query: PTContractQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<PTContractResponseDto[]> {
    return this.service.findAll(query, gymId);
  }

  @Roles(Role.OWNER)
  @Get(':id')
  @ApiOperation({ summary: '계약 상세' })
  @ApiCommonResponse(PTContractResponseDto)
  @ApiErrorResponse(404, [ErrorCode.PT_CONTRACT_NOT_FOUND], '존재하지 않음')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<PTContractResponseDto> {
    return this.service.findOne(id, gymId);
  }

  @Roles(Role.OWNER)
  @Patch(':id/cancel')
  @ResponseMessage('PT 계약이 취소되었습니다')
  @ApiOperation({
    summary: '계약 취소',
    description: '환불·착오 등록 처리. 삭제하지 않고 이력으로 남긴다.',
  })
  @ApiCommonResponse(PTContractResponseDto)
  @ApiErrorResponse(
    409,
    [ErrorCode.INVALID_CONTRACT_STATUS],
    '이미 취소·완료된 계약',
  )
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<PTContractResponseDto> {
    return this.service.cancel(id, gymId);
  }
}
