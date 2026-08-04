import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { Gym } from '../gyms/entities/gym.entity';
import { Role } from '../common/enums/role.enum';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto, UserResponseDto } from './dto/auth-response.dto';
import { TokenService } from './token.service';
import { RevokeReason } from './entities/refresh-token.entity';

const BCRYPT_ROUNDS = 10;
/** PostgreSQL unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  /**
   * 타이밍 공격 방어용 더미 해시.
   *
   * 아이디가 없을 때 즉시 반환하면 bcrypt 비교(수십~수백 ms)를 건너뛰게 되어
   * 응답 시간만으로 계정 존재 여부가 드러난다. @see ADR-008
   */
  private readonly dummyHash = bcrypt.hashSync(
    randomBytes(16).toString('hex'),
    BCRYPT_ROUNDS,
  );

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Gym) private readonly gymRepo: Repository<Gym>,
    private readonly tokenService: TokenService,
  ) {}

  async signup(dto: SignupDto): Promise<UserResponseDto> {
    const gym = await this.gymRepo.findOne({ where: { id: dto.gymId } });
    if (!gym) throw new BusinessException(ErrorCode.GYM_NOT_FOUND);
    if (!gym.isActive) throw new BusinessException(ErrorCode.GYM_INACTIVE);

    const user = this.userRepo.create({
      gymId: dto.gymId,
      loginId: dto.loginId,
      password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      name: dto.name,
      phone: dto.phone ?? null,
      // 가입으로 만들 수 있는 역할은 MEMBER뿐이다.
      // TRAINER는 OWNER가 승격시키고, OWNER는 SUPER_ADMIN이 발급한다.
      role: Role.MEMBER,
    });

    try {
      const saved = await this.userRepo.save(user);
      return UserResponseDto.from(saved);
    } catch (error) {
      // 사전 조회로 중복을 걸러도 동시 요청은 통과할 수 있다.
      // 최종 방어는 DB의 unique 제약이며, 그 위반을 의미 있는 응답으로 변환한다.
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        throw new BusinessException(ErrorCode.DUPLICATE_LOGIN_ID);
      }
      throw error;
    }
  }

  async login(dto: LoginDto, deviceInfo?: string): Promise<LoginResponseDto> {
    // password는 select:false라 명시적으로 꺼내야 한다
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.loginId = :loginId', { loginId: dto.loginId })
      .getOne();

    // 유저가 없어도 해싱 비용을 발생시켜 응답 시간을 맞춘다
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.password ?? this.dummyHash,
    );

    // 아이디 미존재 / 비밀번호 불일치 / 비활성 계정을 구분하지 않는다
    if (!user || !passwordMatches || !user.isActive) {
      throw new BusinessException(ErrorCode.INVALID_CREDENTIALS);
    }

    const tokens = await this.tokenService.issueTokenPair(user, deviceInfo);

    return {
      ...tokens,
      user: UserResponseDto.from(user),
    };
  }

  /**
   * Refresh Token으로 새 토큰 쌍을 발급한다 (Rotation).
   *
   * 사용자 정보를 DB에서 다시 읽는 이유: Refresh Token에는 sub만 담겨 있고,
   * 발급 이후 역할이 바뀌었을 수 있다. 새 Access Token에는 최신 값이 들어가야 한다.
   */
  async refresh(
    refreshToken: string,
    deviceInfo?: string,
  ): Promise<LoginResponseDto> {
    const userId = await this.tokenService.consumeRefreshToken(refreshToken);

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      // 토큰은 유효하나 계정이 삭제·정지된 경우. 남은 세션도 정리한다
      await this.tokenService.revokeAllByUser(userId, RevokeReason.SECURITY);
      throw new BusinessException(ErrorCode.INVALID_REFRESH_TOKEN);
    }

    const tokens = await this.tokenService.issueTokenPair(user, deviceInfo);
    return { ...tokens, user: UserResponseDto.from(user) };
  }

  async logout(
    userId: string,
    refreshToken?: string,
    allDevices?: boolean,
  ): Promise<void> {
    if (allDevices) {
      await this.tokenService.revokeAllByUser(userId, RevokeReason.LOGOUT);
      return;
    }
    if (refreshToken) {
      await this.tokenService.revokeByToken(refreshToken, userId);
    }
    // 둘 다 없으면 폐기할 대상이 없다. Access Token은 만료까지 유효하다 (ADR-006 한계)
  }

  /**
   * 토큰에는 sub/role/gymId만 담겨 있어 name·loginId를 알 수 없다.
   * 실제 정보는 DB에서 조회한다.
   */
  async me(userId: string): Promise<UserResponseDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    // 토큰은 유효하지만 계정이 삭제된 경우
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND);
    return UserResponseDto.from(user);
  }
}
