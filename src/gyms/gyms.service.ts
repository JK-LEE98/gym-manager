import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Gym } from './entities/gym.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';
import { CreateGymDto, UpdateGymDto } from './dto/create-gym.dto';
import {
  CreateGymResponseDto,
  GymOwnerResponseDto,
  GymResponseDto,
  PublicGymResponseDto,
} from './dto/gym-response.dto';

const BCRYPT_ROUNDS = 10;
/** PostgreSQL unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class GymsService {
  constructor(
    @InjectRepository(Gym) private readonly gymRepo: Repository<Gym>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 헬스장과 OWNER 계정을 생성한다.
   *
   * **하나의 트랜잭션으로 묶는다.** 헬스장만 만들어지고 계정 생성이 실패하면
   * 아무도 접근할 수 없는 헬스장이 DB에 남는다. 반대로 계정만 생기면 소속 없는 OWNER가 된다.
   * 둘 중 하나라도 실패하면 전체를 되돌린다.
   */
  async create(dto: CreateGymDto): Promise<CreateGymResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const gym = await manager.save(
          manager.create(Gym, {
            name: dto.name,
            address: dto.address ?? null,
            phone: dto.phone ?? null,
          }),
        );

        const owner = await manager.save(
          manager.create(User, {
            gymId: gym.id,
            loginId: dto.ownerLoginId,
            password: await bcrypt.hash(dto.ownerPassword, BCRYPT_ROUNDS),
            name: dto.ownerName,
            role: Role.OWNER,
          }),
        );

        return {
          gym: GymResponseDto.from(gym),
          owner: GymOwnerResponseDto.from(owner),
        };
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        // 아이디가 중복이면 헬스장 생성도 함께 롤백된다
        throw new BusinessException(ErrorCode.DUPLICATE_LOGIN_ID);
      }
      throw error;
    }
  }

  /** 회원가입 화면용. 인증 없이 접근 가능하므로 활성 헬스장만 최소 필드로 반환한다 */
  async findAllPublic(): Promise<PublicGymResponseDto[]> {
    const gyms = await this.gymRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    // 정적 메서드를 그대로 넘기면 this 바인딩이 끊길 수 있어 lint가 경고한다.
    // 화살표 함수로 감싸 호출 주체를 명확히 한다
    return gyms.map((gym) => PublicGymResponseDto.from(gym));
  }

  async findAll(): Promise<GymResponseDto[]> {
    const gyms = await this.gymRepo.find({ order: { createdAt: 'DESC' } });
    return gyms.map((gym) => GymResponseDto.from(gym));
  }

  /**
   * @param requesterGymId SUPER_ADMIN이면 null. OWNER면 본인 소속 헬스장 ID
   */
  async findOne(
    id: string,
    requesterGymId: string | null,
  ): Promise<GymResponseDto> {
    // SUPER_ADMIN(null)이 아니면서 소속이 다르면 다른 헬스장 정보 접근 시도다
    if (requesterGymId !== null && requesterGymId !== id) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }
    return GymResponseDto.from(await this.getOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateGymDto,
    requesterGymId: string | null,
  ): Promise<GymResponseDto> {
    if (requesterGymId !== null && requesterGymId !== id) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }

    const gym = await this.getOrThrow(id);
    Object.assign(gym, {
      name: dto.name ?? gym.name,
      address: dto.address ?? gym.address,
      phone: dto.phone ?? gym.phone,
    });

    return GymResponseDto.from(await this.gymRepo.save(gym));
  }

  /**
   * 구독 해지 등으로 비활성화한다. 삭제하지 않는다.
   * 회원권·출석·PT 이력이 모두 이 헬스장을 참조하고 있어 물리 삭제는 불가능하다.
   */
  async deactivate(id: string): Promise<GymResponseDto> {
    const gym = await this.getOrThrow(id);
    gym.isActive = false;
    return GymResponseDto.from(await this.gymRepo.save(gym));
  }

  async activate(id: string): Promise<GymResponseDto> {
    const gym = await this.getOrThrow(id);
    gym.isActive = true;
    return GymResponseDto.from(await this.gymRepo.save(gym));
  }

  private async getOrThrow(id: string): Promise<Gym> {
    const gym = await this.gymRepo.findOne({ where: { id } });
    if (!gym) throw new BusinessException(ErrorCode.GYM_NOT_FOUND);
    return gym;
  }
}
