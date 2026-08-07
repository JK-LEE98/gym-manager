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
import { MembershipsService } from './memberships.service';
import { TransfersService } from './transfers.service';
import {
  TransferMembershipDto,
  TransferResponseDto,
} from './dto/membership-transfer.dto';
import {
  CreateMembershipTypeDto,
  MembershipTypeQueryDto,
  MembershipTypeResponseDto,
  UpdateMembershipTypeDto,
} from './dto/membership-type.dto';
import {
  ExtendMembershipDto,
  GrantMembershipDto,
  UserMembershipResponseDto,
} from './dto/user-membership.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';

@ApiTags('MembershipTypes')
@Controller('membership-types')
export class MembershipTypesController {
  constructor(private readonly service: MembershipsService) {}

  @Roles(Role.OWNER)
  @Post()
  @ResponseMessage('회원권 종류가 등록되었습니다')
  @ApiOperation({
    summary: '회원권 종류 등록',
    description:
      'category는 자유 문자열이다. 같은 category의 회원권을 추가로 부여하면 기존 종료일 다음날부터 이어진다.',
  })
  @ApiCommonResponse(MembershipTypeResponseDto, { status: 201 })
  create(
    @Body() dto: CreateMembershipTypeDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<MembershipTypeResponseDto> {
    return this.service.createType(dto, gymId);
  }

  @Get()
  @ApiOperation({
    summary: '회원권 종류 목록',
    description: '기본은 판매 중인 것만. includeInactive=true로 전체 조회.',
  })
  @ApiCommonResponse(MembershipTypeResponseDto, { isArray: true })
  findAll(
    @Query() query: MembershipTypeQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<MembershipTypeResponseDto[]> {
    return this.service.findAllTypes(gymId, query.includeInactive);
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  @ResponseMessage('회원권 종류가 수정되었습니다')
  @ApiOperation({
    summary: '회원권 종류 수정',
    description: '이미 판매된 회원권의 기간·가격은 변경되지 않는다.',
  })
  @ApiCommonResponse(MembershipTypeResponseDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipTypeDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<MembershipTypeResponseDto> {
    return this.service.updateType(id, dto, gymId);
  }

  @Roles(Role.OWNER)
  @Patch(':id/deactivate')
  @ResponseMessage('판매가 중지되었습니다')
  @ApiOperation({
    summary: '판매 중지',
    description: '삭제하지 않는다. 이미 판매된 회원권이 참조하고 있다.',
  })
  @ApiCommonResponse(MembershipTypeResponseDto)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<MembershipTypeResponseDto> {
    return this.service.deactivateType(id, gymId);
  }
}

@ApiTags('Memberships')
@Controller('memberships')
export class MembershipsController {
  constructor(
    private readonly service: MembershipsService,
    private readonly transfersService: TransfersService,
  ) {}

  // /memberships/me 는 /memberships/:id 보다 먼저 선언해야 한다.
  // 뒤에 두면 'me'가 :id로 해석되어 ParseUUIDPipe에서 400이 난다.
  @Get('me')
  @ApiOperation({
    summary: '내 회원권',
    description:
      '과거 이력을 포함해 반환한다. 만료 여부는 daysUntilExpiry로 판단.',
  })
  @ApiCommonResponse(UserMembershipResponseDto, { isArray: true })
  findMine(
    @CurrentUser('sub') userId: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserMembershipResponseDto[]> {
    return this.service.findByUser(userId, gymId);
  }

  @Roles(Role.OWNER)
  @Post()
  @ResponseMessage('회원권이 부여되었습니다')
  @ApiOperation({
    summary: '회원권 부여',
    description:
      'Payment를 함께 생성한다(트랜잭션). startDate를 생략하면 같은 category의 ' +
      '마지막 종료일 다음날부터 시작된다.',
  })
  @ApiCommonResponse(UserMembershipResponseDto, { status: 201 })
  @ApiErrorResponse(
    400,
    [ErrorCode.MEMBERSHIP_TYPE_INACTIVE],
    '판매 중지된 회원권',
  )
  @ApiErrorResponse(404, [ErrorCode.USER_NOT_FOUND], '없거나 다른 헬스장 소속')
  grant(
    @Body() dto: GrantMembershipDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserMembershipResponseDto> {
    return this.service.grant(dto, gymId);
  }

  @Roles(Role.OWNER)
  @Get()
  @ApiOperation({
    summary: '특정 회원의 회원권 목록',
    description: '과거 이력을 포함한다.',
  })
  @ApiCommonResponse(UserMembershipResponseDto, { isArray: true })
  findByUser(
    @Query('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserMembershipResponseDto[]> {
    return this.service.findByUser(userId, gymId);
  }

  @Roles(Role.OWNER)
  @Get(':id')
  @ApiOperation({ summary: '회원권 상세' })
  @ApiCommonResponse(UserMembershipResponseDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserMembershipResponseDto> {
    return this.service.findOne(id, gymId);
  }

  @Roles(Role.OWNER)
  @Patch(':id/extend')
  @ResponseMessage('회원권이 연장되었습니다')
  @ApiOperation({
    summary: '기간 연장',
    description:
      '서비스 보상이나 착오 정정용이다. 추가 결제는 새 회원권 부여로 처리해야 결제 이력이 남는다.',
  })
  @ApiCommonResponse(UserMembershipResponseDto)
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendMembershipDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserMembershipResponseDto> {
    return this.service.extend(id, dto, gymId);
  }

  @Roles(Role.OWNER)
  @Post(':id/transfer')
  @ResponseMessage('회원권이 양도되었습니다')
  @ApiOperation({
    summary: '회원권 양도',
    description:
      '경로의 id는 양도인의 회원권이다. 잔여 일수를 양수인에게 이전한다. ' +
      '진행 중인 홀딩은 어제까지로 조기 종료되어 이미 지난 홀딩 일수는 보존된다. ' +
      '양도권은 이후 홀딩할 수 없다.',
  })
  @ApiCommonResponse(TransferResponseDto, {
    status: 201,
    message: '회원권이 양도되었습니다',
  })
  @ApiErrorResponse(400, [ErrorCode.TRANSFER_SAME_USER], '본인에게 양도 시도')
  @ApiErrorResponse(
    409,
    [ErrorCode.TRANSFER_NO_REMAINING_DAYS, ErrorCode.INVALID_MEMBERSHIP_STATUS],
    '잔여 없음 또는 이용 중이 아닌 회원권',
  )
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferMembershipDto,
    @CurrentUser('gymId') gymId: string,
    @CurrentUser('sub') operatorId: string,
  ): Promise<TransferResponseDto> {
    return this.transfersService.transfer(id, dto, gymId, operatorId);
  }

  @Roles(Role.OWNER)
  @Get('transfers/history')
  @ApiOperation({
    summary: '회원의 양도 이력',
    description: '준 것과 받은 것을 모두 포함한다.',
  })
  @ApiCommonResponse(TransferResponseDto, { isArray: true })
  transferHistory(
    @Query('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<TransferResponseDto[]> {
    return this.transfersService.findByUser(userId, gymId);
  }

  @Roles(Role.OWNER)
  @Patch(':id/cancel')
  @ResponseMessage('회원권이 취소되었습니다')
  @ApiOperation({
    summary: '회원권 취소',
    description: '환불·착오 등록 처리. 이력은 남는다.',
  })
  @ApiCommonResponse(UserMembershipResponseDto)
  @ApiErrorResponse(409, [ErrorCode.INVALID_MEMBERSHIP_STATUS], '이미 취소됨')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserMembershipResponseDto> {
    return this.service.cancel(id, gymId);
  }
}
