import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { TrainerProfile } from '../trainers/entities/trainer-profile.entity';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';
import { TokenService } from '../auth/token.service';
import { RevokeReason } from '../auth/entities/refresh-token.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
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

const BCRYPT_ROUNDS = 10;
const PG_UNIQUE_VIOLATION = '23505';

/** 혼동하기 쉬운 문자(0/O, 1/l/I)를 제외했다. 관리자가 구두로 전달하는 상황을 고려 */
const TEMP_PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEMP_PASSWORD_LENGTH = 10;

/** 역할 변경이 허용되는 조합. OWNER·SUPER_ADMIN은 어느 쪽으로도 바꿀 수 없다 */
const CHANGEABLE_ROLES: readonly Role[] = [Role.MEMBER, Role.TRAINER];

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly tokenService: TokenService,
  ) {}

  async create(
    dto: CreateUserDto,
    gymId: string,
  ): Promise<UserDetailResponseDto> {
    const role = dto.role ?? Role.MEMBER;
    if (!CHANGEABLE_ROLES.includes(role)) {
      throw new BusinessException(
        ErrorCode.INVALID_ROLE_CHANGE,
        'MEMBER 또는 TRAINER만 등록할 수 있습니다',
      );
    }

    try {
      // TRAINER면 프로필까지 함께 만들어야 하므로 트랜잭션으로 묶는다
      return await this.dataSource.transaction(async (manager) => {
        const user = await manager.save(
          manager.create(User, {
            gymId,
            loginId: dto.loginId,
            password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
            name: dto.name,
            phone: dto.phone ?? null,
            role,
          }),
        );

        if (role === Role.TRAINER) {
          await manager.save(manager.create(TrainerProfile, { userId: user.id }));
        }

        return UserDetailResponseDto.from(user);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new BusinessException(ErrorCode.DUPLICATE_LOGIN_ID);
      }
      throw error;
    }
  }

  async findAll(
    query: UserQueryDto,
    gymId: string,
  ): Promise<PaginatedResponseDto<UserDetailResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.userRepo
      .createQueryBuilder('user')
      // 트레이너 목록에서 전문 분야를 함께 보여준다.
      // 별도 조회하면 N+1이 되므로 조인으로 한 번에 가져온다
      .leftJoinAndSelect('user.trainerProfile', 'profile')
      .where('user.gymId = :gymId', { gymId });

    if (query.name) {
      qb.andWhere('user.name LIKE :name', { name: `%${query.name}%` });
    }
    if (query.role) {
      qb.andWhere('user.role = :role', { role: query.role });
    }

    const [users, total] = await qb
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return PaginatedResponseDto.of(
      users.map(UserDetailResponseDto.from),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string, gymId: string): Promise<UserDetailResponseDto> {
    return UserDetailResponseDto.from(await this.getInGym(id, gymId));
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    gymId: string,
  ): Promise<UserDetailResponseDto> {
    const user = await this.getInGym(id, gymId);
    user.name = dto.name ?? user.name;
    user.phone = dto.phone ?? user.phone;
    return UserDetailResponseDto.from(await this.userRepo.save(user));
  }

  /** 본인 정보 수정. 소속과 무관하게 자기 자신만 대상으로 한다 */
  async updateMe(
    userId: string,
    dto: UpdateUserDto,
  ): Promise<UserDetailResponseDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND);

    user.name = dto.name ?? user.name;
    user.phone = dto.phone ?? user.phone;
    return UserDetailResponseDto.from(await this.userRepo.save(user));
  }

  /**
   * MEMBER ↔ TRAINER 역할 변경.
   *
   * TRAINER 승격 시 TrainerProfile을 생성하고, 강등 시 삭제한다.
   * 두 작업이 어긋나면 "프로필 없는 트레이너" 또는 "프로필 있는 회원"이 생기므로
   * 하나의 트랜잭션으로 묶는다.
   *
   * TODO(PT 모듈 이후): 강등 시 진행 중인 PTContract가 있으면 거부한다.
   *   계약이 남은 트레이너를 강등하면 회원이 잔여 횟수를 사용할 수 없게 된다.
   *   → 향후 과제.md
   */
  async updateRole(
    id: string,
    dto: UpdateRoleDto,
    gymId: string,
  ): Promise<UserDetailResponseDto> {
    const user = await this.getInGym(id, gymId);

    // 대상의 현재 역할과 바꾸려는 역할이 모두 MEMBER/TRAINER여야 한다.
    // OWNER는 SUPER_ADMIN이 헬스장 등록 시에만 발급한다. @see ADR-005
    if (
      !CHANGEABLE_ROLES.includes(user.role) ||
      !CHANGEABLE_ROLES.includes(dto.role)
    ) {
      throw new BusinessException(
        ErrorCode.INVALID_ROLE_CHANGE,
        'MEMBER와 TRAINER 사이에서만 변경할 수 있습니다',
      );
    }

    if (user.role === dto.role) {
      return UserDetailResponseDto.from(user);
    }

    return await this.dataSource.transaction(async (manager) => {
      await manager.update(User, id, { role: dto.role });

      if (dto.role === Role.TRAINER) {
        await manager.save(manager.create(TrainerProfile, { userId: id }));
      } else {
        // 강등 시 프로필을 지운다. "TRAINER만 프로필을 갖는다"는 불변식을 유지하기 위함이다.
        // specialty·bio는 함께 사라지므로 재승격 시 다시 입력해야 한다.
        await manager.delete(TrainerProfile, { userId: id });
      }

      const updated = await manager.findOne(User, {
        where: { id },
        relations: { trainerProfile: true },
      });
      return UserDetailResponseDto.from(updated!);
    });
  }

  /**
   * 상위 역할이 비밀번호를 초기화한다. 셀프 복구 수단이 없는 구조를 보완한다. @see ADR-009
   *
   * 임시 비밀번호는 서버가 생성한다. 관리자가 직접 입력하게 하면 `1234` 같은 값을 넣게 된다.
   * 초기화 시 기존 세션을 모두 끊어 탈취 상태에서의 접근을 차단한다.
   */
  async resetPassword(
    id: string,
    gymId: string,
  ): Promise<ResetPasswordResponseDto> {
    const user = await this.getInGym(id, gymId);

    if (!CHANGEABLE_ROLES.includes(user.role)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'OWNER 계정은 서비스 운영자에게 문의해야 합니다',
      );
    }

    const temporaryPassword = this.generateTemporaryPassword();
    user.password = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    await this.userRepo.save(user);

    await this.tokenService.revokeAllByUser(user.id, RevokeReason.SECURITY);

    return { temporaryPassword };
  }

  /**
   * 본인 비밀번호 변경.
   *
   * 변경 후 모든 RefreshToken을 폐기한다.
   * 탈취된 세션을 끊는 것이 비밀번호 변경의 주요 목적 중 하나이기 때문이다. @see ADR-006
   */
  async changeMyPassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND);

    const matches = await bcrypt.compare(dto.currentPassword, user.password);
    if (!matches) {
      throw new BusinessException(ErrorCode.INVALID_CURRENT_PASSWORD);
    }

    user.password = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.userRepo.save(user);

    await this.tokenService.revokeAllByUser(userId, RevokeReason.SECURITY);
  }

  /**
   * soft delete. 출석·회원권 이력이 참조하므로 물리 삭제하지 않는다.
   * 삭제와 동시에 세션을 끊는다.
   */
  async remove(id: string, gymId: string): Promise<void> {
    const user = await this.getInGym(id, gymId);

    if (!CHANGEABLE_ROLES.includes(user.role)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'OWNER 계정은 삭제할 수 없습니다',
      );
    }

    await this.userRepo.softDelete(id);
    await this.tokenService.revokeAllByUser(id, RevokeReason.SECURITY);
  }

  /**
   * 대상이 요청자와 같은 헬스장에 속하는지 확인한다.
   *
   * gymId 조건을 WHERE에 넣어 다른 헬스장의 회원은 애초에 조회되지 않게 한다.
   * "찾은 뒤 비교"하면 조건을 빠뜨렸을 때 데이터가 새지만,
   * 이 방식은 빠뜨리면 아무것도 조회되지 않아 즉시 드러난다. @see ADR-004
   */
  private async getInGym(id: string, gymId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id, gymId },
      relations: { trainerProfile: true },
    });
    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    return user;
  }

  private generateTemporaryPassword(): string {
    return Array.from(
      { length: TEMP_PASSWORD_LENGTH },
      () => TEMP_PASSWORD_CHARS[randomInt(TEMP_PASSWORD_CHARS.length)],
    ).join('');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code?: string }).code ===
        PG_UNIQUE_VIOLATION
    );
  }
}
