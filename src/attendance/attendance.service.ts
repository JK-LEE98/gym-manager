import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Attendance, AttendanceMethod } from './entities/attendance.entity';
import { QrTokenService } from './qr-token.service';
import {
  AttendanceQueryDto,
  AttendanceResponseDto,
  CheckInResponseDto,
  ManualCheckInDto,
} from './dto/attendance.dto';
import { Gym } from '../gyms/entities/gym.entity';
import { User } from '../users/entities/user.entity';
import {
  MembershipStatus,
  UserMembership,
} from '../memberships/entities/user-membership.entity';
import {
  HoldStatus,
  MembershipHold,
} from '../memberships/entities/membership-hold.entity';
import { daysUntil, today } from '../common/utils/date.util';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BusinessException } from '../common/exceptions/business.exception';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    @InjectRepository(Gym)
    private readonly gymRepo: Repository<Gym>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserMembership)
    private readonly membershipRepo: Repository<UserMembership>,
    @InjectRepository(MembershipHold)
    private readonly holdRepo: Repository<MembershipHold>,
    private readonly qrTokenService: QrTokenService,
  ) {}

  /** 회원 본인이 QR을 발급받는다 */
  async issueQrToken(userId: string, gymId: string): Promise<string> {
    return this.qrTokenService.issue(userId, gymId);
  }

  /**
   * QR 스캔 → 출석 처리.
   *
   * 검증 순서가 설계의 핵심이다. @see ADR-013 결정 5
   * ```
   * 1. 토큰 서명·만료          401
   * 2. type === 'ATTENDANCE'   401
   * 3. gymId 일치              403
   * 4. 재출입 유예 안?         기록만 하고 종료
   * 5. 홀딩 중?                403
   * 6. 유효한 회원권 없음?     403
   * 7. 오늘 입장 횟수 초과?    409
   * ```
   */
  async checkInByQr(
    token: string,
    scannerGymId: string,
  ): Promise<CheckInResponseDto> {
    // ①② 서명·만료·용도
    const payload = await this.qrTokenService.verify(token);

    // ③ 다른 헬스장의 QR을 우리 단말에 찍는 것을 막는다.
    // 토큰의 gymId를 신뢰하지 않고 스캐너의 gymId와 대조한다 @see ADR-004
    if (payload.gymId !== scannerGymId) {
      throw new BusinessException(ErrorCode.TENANT_MISMATCH);
    }

    return this.record(payload.sub, scannerGymId, AttendanceMethod.QR);
  }

  /**
   * 데스크가 대신 처리한다. 배터리 방전 등 QR을 쓸 수 없는 상황용.
   *
   * 검증은 QR과 동일하게 적용한다. 수동이 검사를 우회하는 뒷문이 되면
   * 정책 자체가 무의미해지기 때문이다.
   */
  async checkInManually(
    dto: ManualCheckInDto,
    gymId: string,
  ): Promise<CheckInResponseDto> {
    return this.record(
      dto.userId,
      gymId,
      AttendanceMethod.MANUAL,
      dto.checkedAt ? new Date(dto.checkedAt) : undefined,
    );
  }

  private async record(
    userId: string,
    gymId: string,
    method: AttendanceMethod,
    checkedAtInput?: Date,
  ): Promise<CheckInResponseDto> {
    const checkedAt = checkedAtInput ?? new Date();

    const user = await this.userRepo.findOne({ where: { id: userId, gymId } });
    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND);

    const gym = await this.gymRepo.findOne({ where: { id: gymId } });
    if (!gym) throw new BusinessException(ErrorCode.GYM_NOT_FOUND);

    // ④ 재출입 유예 안이면 여기서 끝낸다.
    //
    // 5·6·7번보다 먼저인 것이 핵심이다. 흡연하러 나갔다 온 회원을
    // "오늘 횟수를 다 썼다"고 막으면 안 된다. 유예 시간 안의 재스캔은
    // 이미 통과한 입장의 연장이므로 다시 검사할 이유가 없다.
    if (await this.isWithinGrace(userId, gymId, gym, checkedAt)) {
      const saved = await this.save(userId, gymId, method, checkedAt, true);
      return CheckInResponseDto.from(saved, user.name, null);
    }

    // ⑤⑥ 홀딩·회원권
    const daysUntilExpiry = await this.assertCanEnter(userId, gymId);

    // ⑦ 하루 입장 횟수
    await this.assertWithinDailyLimit(userId, gymId, gym, checkedAt);

    const saved = await this.save(userId, gymId, method, checkedAt, false);
    return CheckInResponseDto.from(saved, user.name, daysUntilExpiry);
  }

  /**
   * 마지막 입장으로부터 유예 시간 안인지.
   *
   * `reentryGraceMinutes = 0`이면 재출입 기능을 쓰지 않는 헬스장이므로
   * 항상 false다. 매 스캔이 새 입장이 된다.
   */
  private async isWithinGrace(
    userId: string,
    gymId: string,
    gym: Gym,
    checkedAt: Date,
  ): Promise<boolean> {
    if (gym.reentryGraceMinutes <= 0) return false;

    const graceStart = new Date(
      checkedAt.getTime() - gym.reentryGraceMinutes * 60_000,
    );

    const recent = await this.attendanceRepo.findOne({
      where: {
        userId,
        gymId,
        checkedAt: Between(graceStart, checkedAt),
      },
      order: { checkedAt: 'DESC' },
    });

    return recent !== null;
  }

  /**
   * 입장 가능 여부를 확인하고 만료까지 남은 일수를 돌려준다.
   *
   * **홀딩 검사가 회원권 검사보다 먼저다.** 홀딩 중이면 회원권은 유효하므로
   * 순서가 바뀌면 "회원권이 없습니다"라는 틀린 안내가 나간다.
   */
  private async assertCanEnter(userId: string, gymId: string): Promise<number> {
    const now = today();

    const memberships = await this.membershipRepo.find({
      where: {
        userId,
        gymId,
        status: MembershipStatus.ACTIVE,
        endDate: MoreThanOrEqual(now),
        startDate: LessThanOrEqual(now),
      },
      order: { endDate: 'DESC' },
    });

    if (memberships.length === 0) {
      throw new BusinessException(ErrorCode.NO_ACTIVE_MEMBERSHIP);
    }

    // ⑤ 홀딩 중인가.
    //
    // 홀딩은 회원이 신청한 것이므로 자동으로 종료하지 않는다.
    // 시스템이 임의로 끝내면 회원 동의 없이 회원권 기간을 깎는 것이 된다.
    // 잘못 찍었거나 짐만 가지러 들렀을 수도 있고 되돌릴 방법이 없다. @see ADR-013
    const activeHold = await this.holdRepo.findOne({
      where: memberships.map((m) => ({
        userMembershipId: m.id,
        status: HoldStatus.ACTIVE,
        startDate: LessThanOrEqual(now),
        endDate: MoreThanOrEqual(now),
      })),
    });

    if (activeHold) {
      throw new BusinessException(ErrorCode.MEMBERSHIP_ON_HOLD);
    }

    // 가장 늦게 끝나는 회원권 기준으로 안내한다
    return daysUntil(memberships[0].endDate);
  }

  /**
   * 오늘 입장 횟수 확인.
   *
   * 재입장(`isReentry = true`)은 세지 않는다.
   */
  private async assertWithinDailyLimit(
    userId: string,
    gymId: string,
    gym: Gym,
    checkedAt: Date,
  ): Promise<void> {
    if (gym.dailyEntryLimit === null) return;

    const { start, end } = dayRange(checkedAt);

    const count = await this.attendanceRepo.count({
      where: {
        userId,
        gymId,
        isReentry: false,
        checkedAt: Between(start, end),
      },
    });

    if (count >= gym.dailyEntryLimit) {
      throw new BusinessException(ErrorCode.DAILY_ENTRY_LIMIT_EXCEEDED);
    }
  }

  private async save(
    userId: string,
    gymId: string,
    method: AttendanceMethod,
    checkedAt: Date,
    isReentry: boolean,
  ): Promise<Attendance> {
    return this.attendanceRepo.save(
      this.attendanceRepo.create({
        userId,
        gymId,
        method,
        checkedAt,
        isReentry,
      }),
    );
  }

  async findAll(
    query: AttendanceQueryDto,
    gymId: string,
  ): Promise<AttendanceResponseDto[]> {
    const where: Record<string, unknown> = { gymId };
    if (query.userId) where.userId = query.userId;

    if (query.startDate && query.endDate) {
      where.checkedAt = Between(
        dayRange(new Date(`${query.startDate}T00:00:00`)).start,
        dayRange(new Date(`${query.endDate}T00:00:00`)).end,
      );
    }

    const rows = await this.attendanceRepo.find({
      where,
      relations: { user: true },
      order: { checkedAt: 'DESC' },
      take: 200,
    });

    return rows.map((row) => AttendanceResponseDto.from(row));
  }

  async findMine(
    userId: string,
    gymId: string,
  ): Promise<AttendanceResponseDto[]> {
    const rows = await this.attendanceRepo.find({
      where: { userId, gymId },
      relations: { user: true },
      order: { checkedAt: 'DESC' },
      take: 200,
    });

    return rows.map((row) => AttendanceResponseDto.from(row));
  }
}

/** 해당 날짜의 00:00:00 ~ 23:59:59.999 (프로세스 타임존 기준) */
function dayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}
