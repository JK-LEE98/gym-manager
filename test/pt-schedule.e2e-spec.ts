import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, today } from '../src/common/utils/date.util';
import {
  TEST_GYM,
  clearDatabase,
  createGym,
  createOwner,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * PT 예약 검증. → ADR-014
 *
 * 핵심은 세 가지다.
 * ① 트레이너 시간 겹침을 EXCLUDE 제약이 막는가
 * ② 반복 등록에서 겹친 건만 건너뛰는가
 * ③ 취소한 자리에 다시 예약할 수 있는가
 */
describe('PT 예약 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let trainerToken: string;
  let trainerId: string;
  let memberToken: string;
  let memberId: string;
  let contractId: string;

  /** 로컬 타임존 기준 ISO 문자열. TZ=Asia/Seoul로 고정되어 있다 */
  function at(dayOffset: number, time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    const base = new Date();
    base.setDate(base.getDate() + dayOffset);
    base.setHours(hour, minute, 0, 0);
    return base.toISOString();
  }

  async function makeMember(
    loginId: string,
    name: string,
  ): Promise<{ token: string; id: string }> {
    const user = await signupAndLogin(app, TEST_GYM.id, {
      loginId,
      password: 'password1234',
      name,
    });
    return { token: user.accessToken, id: user.userId };
  }

  async function makeContract(targetMemberId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/pt/contracts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        memberId: targetMemberId,
        trainerId,
        totalSessions: 20,
        amount: 1_200_000,
        startDate: addDays(today(), -1),
        endDate: addDays(today(), 90),
      })
      .expect(201);
    return res.body.data.id;
  }

  function book(startAt: string, options: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/pt/schedules')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ contractId, startAt, durationMinutes: 60, ...options });
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearDatabase(app);
    await createGym(app, TEST_GYM);

    ownerToken = (await createOwner(app, TEST_GYM.id, 'owner_sch')).accessToken;

    const member = await makeMember('member_sch', '홍길동');
    memberToken = member.token;
    memberId = member.id;

    const trainer = await makeMember('trainer_sch', '김트레이너');
    trainerId = trainer.id;

    await request(app.getHttpServer())
      .patch(`/users/${trainerId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'TRAINER' })
      .expect(200);

    const relogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ loginId: 'trainer_sch', password: 'password1234' })
      .expect(200);
    trainerToken = relogin.body.data.accessToken;

    contractId = await makeContract(memberId);
  });

  describe('예약 등록', () => {
    it('트레이너가 예약을 등록한다', async () => {
      const res = await book(at(1, '19:00')).expect(201);

      expect(res.body.data.memberName).toBe('홍길동');
      expect(res.body.data.trainerName).toBe('김트레이너');
      expect(res.body.data.status).toBe('SCHEDULED');
      expect(res.body.data.sessionDeducted).toBe(false);
    });

    it('종료 시각을 서버가 계산한다', async () => {
      const res = await book(at(1, '19:00'), {
        durationMinutes: 90,
      }).expect(201);

      const start = new Date(res.body.data.startAt);
      const end = new Date(res.body.data.endAt);
      expect(end.getTime() - start.getTime()).toBe(90 * 60_000);
    });

    it('회원은 예약을 등록할 수 없다', async () => {
      await request(app.getHttpServer())
        .post('/pt/schedules')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ contractId, startAt: at(1, '19:00'), durationMinutes: 60 })
        .expect(403);
    });

    it('계약 기간을 벗어나면 등록할 수 없다', async () => {
      const res = await book(at(200, '19:00')).expect(400);

      expect(res.body.errorCode).toBe('SCHEDULE_OUT_OF_CONTRACT_RANGE');
    });

    it('취소된 계약으로는 예약할 수 없다', async () => {
      await request(app.getHttpServer())
        .patch(`/pt/contracts/${contractId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await book(at(1, '19:00')).expect(409);

      expect(res.body.errorCode).toBe('INVALID_CONTRACT_STATUS');
    });
  });

  describe('시간 겹침 (EXCLUDE 제약)', () => {
    it('같은 시간에 두 번 예약할 수 없다', async () => {
      await book(at(1, '19:00')).expect(201);

      const res = await book(at(1, '19:00')).expect(409);

      expect(res.body.errorCode).toBe('SCHEDULE_OVERLAPPED');
    });

    it('일부만 겹쳐도 거부된다', async () => {
      // 19:00~20:00 이 있는데 19:30~20:30을 잡으려는 경우
      await book(at(1, '19:00')).expect(201);

      const res = await book(at(1, '19:30')).expect(409);

      expect(res.body.errorCode).toBe('SCHEDULE_OVERLAPPED');
    });

    it('연속된 수업은 겹치지 않는다', async () => {
      // tstzrange의 끝을 열어둬야(`[)`) 19:00~20:00과 20:00~21:00이 공존한다.
      // 닫아두면 경계가 맞닿는 수업끼리 서로를 밀어낸다
      await book(at(1, '19:00')).expect(201);
      await book(at(1, '20:00')).expect(201);
    });

    it('다른 회원이어도 트레이너가 같으면 겹칠 수 없다', async () => {
      // 트레이너의 몸은 하나다
      const other = await makeMember('member_sch2', '김철수');
      const otherContract = await makeContract(other.id);

      await book(at(1, '19:00')).expect(201);

      const res = await request(app.getHttpServer())
        .post('/pt/schedules')
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({
          contractId: otherContract,
          startAt: at(1, '19:00'),
          durationMinutes: 60,
        })
        .expect(409);

      expect(res.body.errorCode).toBe('SCHEDULE_OVERLAPPED');
    });

    it('취소한 자리에는 다시 예약할 수 있다', async () => {
      // 제약에서 CANCELLED를 제외하지 않으면 취소해도 그 시간이 영영 막힌다
      const created = await book(at(1, '19:00')).expect(201);

      await request(app.getHttpServer())
        .patch(`/pt/schedules/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      await book(at(1, '19:00')).expect(201);
    });
  });

  describe('반복 예약', () => {
    function recurring(body: Record<string, unknown> = {}) {
      return request(app.getHttpServer())
        .post('/pt/schedules/recurring')
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({
          contractId,
          weekdays: [2, 4],
          startTime: '19:00',
          durationMinutes: 60,
          from: today(),
          to: addDays(today(), 27),
          ...body,
        });
    }

    it('요일 패턴을 날짜로 펼친다', async () => {
      const res = await recurring().expect(201);

      // 4주 구간에 화·목이면 8건 안팎이다. 시작 요일에 따라 달라진다
      expect(res.body.data.created.length).toBeGreaterThanOrEqual(7);
      expect(res.body.data.skipped).toHaveLength(0);

      for (const schedule of res.body.data.created) {
        const day = new Date(schedule.startAt).getDay();
        expect([2, 4]).toContain(day);
      }
    });

    it('겹친 날만 건너뛰고 나머지는 생성한다', async () => {
      // 한 달치 중 하나가 겹쳤다고 전체를 버리면 트레이너가 다시 입력해야 한다
      const first = await recurring().expect(201);
      const conflictAt = first.body.data.created[0].startAt;

      await request(app.getHttpServer())
        .patch(`/pt/schedules/${first.body.data.created[1].id}/cancel`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      const second = await recurring().expect(201);

      // 취소한 한 자리만 새로 생기고 나머지는 전부 겹침으로 건너뛴다
      expect(second.body.data.created).toHaveLength(1);
      expect(second.body.data.skipped.length).toBeGreaterThan(0);
      expect(second.body.data.skipped[0].reason).toBe('SCHEDULE_OVERLAPPED');
      expect(second.body.data.skipped[0].startAt).toBe(conflictAt);
    });

    it('계약 기간을 벗어난 날짜는 건너뛴다', async () => {
      const res = await recurring({
        from: addDays(today(), 80),
        to: addDays(today(), 110),
      }).expect(201);

      expect(res.body.data.skipped.length).toBeGreaterThan(0);
      expect(
        res.body.data.skipped.some(
          (s: { reason: string }) =>
            s.reason === 'SCHEDULE_OUT_OF_CONTRACT_RANGE',
        ),
      ).toBe(true);
    });
  });

  describe('일정 이동·취소', () => {
    it('빈 시간으로 옮길 수 있다', async () => {
      const created = await book(at(1, '19:00')).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/pt/schedules/${created.body.data.id}`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({ startAt: at(2, '10:00') })
        .expect(200);

      expect(new Date(res.body.data.startAt).getHours()).toBe(10);
    });

    it('겹치는 시간으로는 옮길 수 없다', async () => {
      const created = await book(at(1, '19:00')).expect(201);
      await book(at(1, '10:00')).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/pt/schedules/${created.body.data.id}`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({ startAt: at(1, '10:00') })
        .expect(409);

      expect(res.body.errorCode).toBe('SCHEDULE_OVERLAPPED');
    });

    it('회원도 본인 수업을 취소할 수 있다', async () => {
      const created = await book(at(1, '19:00')).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/pt/schedules/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('남의 수업은 취소할 수 없다', async () => {
      const other = await makeMember('member_sch3', '이영희');
      const created = await book(at(1, '19:00')).expect(201);

      await request(app.getHttpServer())
        .patch(`/pt/schedules/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);
    });

    it('이미 취소된 수업은 다시 취소할 수 없다', async () => {
      const created = await book(at(1, '19:00')).expect(201);
      const url = `/pt/schedules/${created.body.data.id}/cancel`;

      await request(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(409);

      expect(res.body.errorCode).toBe('INVALID_SCHEDULE_STATUS');
    });
  });

  describe('조회', () => {
    it('트레이너는 가르치는 수업을 본다', async () => {
      await book(at(1, '19:00')).expect(201);

      const res = await request(app.getHttpServer())
        .get('/pt/schedules/me')
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('회원은 받는 수업을 본다', async () => {
      await book(at(1, '19:00')).expect(201);

      const res = await request(app.getHttpServer())
        .get('/pt/schedules/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].memberId).toBe(memberId);
    });

    it('기간으로 필터링된다', async () => {
      await book(at(1, '19:00')).expect(201);
      await book(at(10, '19:00')).expect(201);

      const res = await request(app.getHttpServer())
        .get(
          `/pt/schedules/me?from=${addDays(today(), 1)}&to=${addDays(today(), 2)}`,
        )
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('회원은 헬스장 전체 일정을 조회할 수 없다', async () => {
      await request(app.getHttpServer())
        .get('/pt/schedules')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });
  });
});
