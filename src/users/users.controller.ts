import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateRoleDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user-request.dto';
import {
  ResetPasswordResponseDto,
  UserDetailResponseDto,
} from './dto/user-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import {
  ApiCommonResponse,
  ApiErrorResponse,
  ApiPaginatedResponse,
} from '../common/decorators/api-common-response.decorator';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // --- 본인 ---
  // /users/me 는 /users/:id 보다 먼저 선언해야 한다.
  // 뒤에 두면 'me'가 :id로 해석되어 ParseUUIDPipe에서 400이 난다.

  @Patch('me')
  @ResponseMessage('정보가 수정되었습니다')
  @ApiOperation({ summary: '내 정보 수정' })
  @ApiCommonResponse(UserDetailResponseDto, {
    message: '정보가 수정되었습니다',
  })
  updateMe(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDetailResponseDto> {
    return this.usersService.updateMe(userId, dto);
  }

  @Patch('me/password')
  @HttpCode(204)
  @ApiOperation({
    summary: '내 비밀번호 변경',
    description:
      '변경 시 모든 기기의 RefreshToken이 폐기된다. 탈취된 세션을 끊기 위함이다.',
  })
  @ApiErrorResponse(
    401,
    [ErrorCode.INVALID_CURRENT_PASSWORD],
    '현재 비밀번호 불일치',
  )
  changeMyPassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.usersService.changeMyPassword(userId, dto);
  }

  // --- 관리 (OWNER) ---

  @Roles(Role.OWNER)
  @Post()
  @ResponseMessage('회원이 등록되었습니다')
  @ApiOperation({
    summary: '회원 등록',
    description:
      '데스크에서 직접 등록할 때 사용한다. gymId는 토큰에서 추출하므로 다른 헬스장에 등록할 수 없다.',
  })
  @ApiCommonResponse(UserDetailResponseDto, {
    status: 201,
    message: '회원이 등록되었습니다',
  })
  @ApiErrorResponse(
    409,
    [ErrorCode.DUPLICATE_LOGIN_ID],
    '이미 사용 중인 아이디',
  )
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserDetailResponseDto> {
    return this.usersService.create(dto, gymId);
  }

  @Roles(Role.OWNER)
  @Get()
  @ApiOperation({
    summary: '회원 목록',
    description: '이름·역할 필터, 페이지네이션. 본인 헬스장 소속만 조회된다.',
  })
  @ApiPaginatedResponse(UserDetailResponseDto)
  findAll(
    @Query() query: UserQueryDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<PaginatedResponseDto<UserDetailResponseDto>> {
    return this.usersService.findAll(query, gymId);
  }

  @Roles(Role.OWNER)
  @Get(':id')
  @ApiOperation({ summary: '회원 상세' })
  @ApiCommonResponse(UserDetailResponseDto)
  @ApiErrorResponse(404, [ErrorCode.USER_NOT_FOUND], '없거나 다른 헬스장 소속')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserDetailResponseDto> {
    return this.usersService.findOne(id, gymId);
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  @ResponseMessage('회원 정보가 수정되었습니다')
  @ApiOperation({ summary: '회원 정보 수정' })
  @ApiCommonResponse(UserDetailResponseDto, {
    message: '회원 정보가 수정되었습니다',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserDetailResponseDto> {
    return this.usersService.update(id, dto, gymId);
  }

  @Roles(Role.OWNER)
  @Patch(':id/role')
  @ResponseMessage('역할이 변경되었습니다')
  @ApiOperation({
    summary: '역할 변경',
    description:
      'MEMBER ↔ TRAINER 만 가능하다. TRAINER 승격 시 프로필이 자동 생성되고, 강등 시 삭제된다.',
  })
  @ApiCommonResponse(UserDetailResponseDto, {
    message: '역할이 변경되었습니다',
  })
  @ApiErrorResponse(
    400,
    [ErrorCode.INVALID_ROLE_CHANGE],
    'OWNER·SUPER_ADMIN은 변경 불가',
  )
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('gymId') gymId: string,
  ): Promise<UserDetailResponseDto> {
    return this.usersService.updateRole(id, dto, gymId);
  }

  @Roles(Role.OWNER)
  @Patch(':id/reset-password')
  @ResponseMessage('비밀번호가 초기화되었습니다')
  @ApiOperation({
    summary: '비밀번호 초기화',
    description:
      '임시 비밀번호를 서버가 생성해 1회 반환한다. 대상의 모든 세션이 종료된다.',
  })
  @ApiCommonResponse(ResetPasswordResponseDto, {
    message: '비밀번호가 초기화되었습니다',
  })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<ResetPasswordResponseDto> {
    return this.usersService.resetPassword(id, gymId);
  }

  @Roles(Role.OWNER)
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: '회원 삭제',
    description:
      'soft delete. 출석·회원권 이력이 참조하므로 물리 삭제하지 않는다.',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('gymId') gymId: string,
  ): Promise<void> {
    return this.usersService.remove(id, gymId);
  }
}
