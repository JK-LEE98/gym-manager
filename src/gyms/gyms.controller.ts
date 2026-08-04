import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GymsService } from './gyms.service';
import { CreateGymDto, UpdateGymDto } from './dto/create-gym.dto';
import {
  CreateGymResponseDto,
  GymResponseDto,
  PublicGymResponseDto,
} from './dto/gym-response.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';

@ApiTags('Gyms')
@Controller('gyms')
export class GymsController {
  constructor(private readonly gymsService: GymsService) {}

  @Public()
  @Get('public')
  @ApiOperation({
    summary: '가입용 헬스장 목록',
    description:
      '회원가입 시 gymId가 필요한데 가입 전에는 토큰이 없다. ' +
      '민감 정보를 제외한 최소 필드만 공개한다.',
  })
  @ApiCommonResponse(PublicGymResponseDto, { isArray: true })
  findAllPublic(): Promise<PublicGymResponseDto[]> {
    return this.gymsService.findAllPublic();
  }

  @Roles(Role.SUPER_ADMIN)
  @Post()
  @ResponseMessage('헬스장이 등록되었습니다')
  @ApiOperation({
    summary: '헬스장 등록',
    description:
      '헬스장과 OWNER 계정을 하나의 트랜잭션으로 생성한다. ' +
      'OWNER는 개인이 아닌 헬스장 공용 운영 계정이다.',
  })
  @ApiCommonResponse(CreateGymResponseDto, {
    status: 201,
    message: '헬스장이 등록되었습니다',
  })
  @ApiErrorResponse(409, [ErrorCode.DUPLICATE_LOGIN_ID], '이미 사용 중인 아이디')
  create(@Body() dto: CreateGymDto): Promise<CreateGymResponseDto> {
    return this.gymsService.create(dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: '전체 헬스장 목록' })
  @ApiCommonResponse(GymResponseDto, { isArray: true })
  findAll(): Promise<GymResponseDto[]> {
    return this.gymsService.findAll();
  }

  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  @Get(':id')
  @ApiOperation({
    summary: '헬스장 상세',
    description: 'OWNER는 본인 소속 헬스장만 조회할 수 있다.',
  })
  @ApiCommonResponse(GymResponseDto)
  @ApiErrorResponse(403, [ErrorCode.TENANT_MISMATCH], '다른 헬스장 접근 시도')
  @ApiErrorResponse(404, [ErrorCode.GYM_NOT_FOUND], '존재하지 않는 헬스장')
  findOne(
    // ParseUUIDPipe가 없으면 잘못된 형식이 DB까지 내려가 22P02 에러 → 500이 된다.
    // 형식 오류는 400으로 돌려주는 것이 맞다.
    @Param('id', ParseUUIDPipe) id: string,
    // 클라이언트가 보낸 값이 아니라 토큰에서 추출한 gymId만 신뢰한다 @see ADR-004
    @CurrentUser('gymId') requesterGymId: string | null,
  ): Promise<GymResponseDto> {
    return this.gymsService.findOne(id, requesterGymId);
  }

  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  @Patch(':id')
  @ResponseMessage('헬스장 정보가 수정되었습니다')
  @ApiOperation({ summary: '헬스장 정보 수정' })
  @ApiCommonResponse(GymResponseDto, { message: '헬스장 정보가 수정되었습니다' })
  @ApiErrorResponse(403, [ErrorCode.TENANT_MISMATCH], '다른 헬스장 접근 시도')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGymDto,
    @CurrentUser('gymId') requesterGymId: string | null,
  ): Promise<GymResponseDto> {
    return this.gymsService.update(id, dto, requesterGymId);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(':id/deactivate')
  @ResponseMessage('헬스장이 비활성화되었습니다')
  @ApiOperation({
    summary: '헬스장 비활성화',
    description:
      '구독 해지 시 사용한다. 회원권·출석 이력이 참조하므로 삭제하지 않는다.',
  })
  @ApiCommonResponse(GymResponseDto, { message: '헬스장이 비활성화되었습니다' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<GymResponseDto> {
    return this.gymsService.deactivate(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(':id/activate')
  @ResponseMessage('헬스장이 활성화되었습니다')
  @ApiOperation({ summary: '헬스장 활성화' })
  @ApiCommonResponse(GymResponseDto, { message: '헬스장이 활성화되었습니다' })
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<GymResponseDto> {
    return this.gymsService.activate(id);
  }
}
