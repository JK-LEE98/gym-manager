import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { addDays, monthOf, today } from '../src/common/utils/date.util';
import {
  TEST_GYM,
  clearDatabase,
  createGym,
  createOwner,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * 운영 통계 검증. → API 명세 10장
 *
 * 이 스펙이 잡으려는 것은 넷이다.
 * ① 목적이 다른 결제가 한 숫자로 섞이지 않는가
 * ② 결제가 없는 달이 결과에서 사라지지 않는가
 * ③ 실적 0건인 트레이너가 `LEFT JOIN`에서 탈락하지 않는가
 * ④ 이용 일수의 분모에 아직 오지 않은 날과 홀딩이 들어가지 않는가
 */
describe('통계 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let dataSource: DataSource;

  const thisMonth = monthOf(today());

  async function createMember(name: string, loginId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ loginId, password: 'password1234', name })
      .expect(201);
    return res.body.data.id;
  }

  async function createType(
    name: string,
    category: string,
    durationDays: number,
    price: number,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/membership-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name, category, durationDays, price, holdingLimit: 3 })
      .expect(201);
    return res.body.data.id;
  }

  /** 회원권을 부여하고 그 id를 돌려준다 */
  async function grant(
    userId: string,
    membershipTypeId: string,
    startDate: string,
    amount?: number,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        userId,
        membershipTypeId,
        startDate,
        ...(amount ? { amount } : {}),
      })
      .expect(201);
    return res.body.data.id;
  }

  /**
   * 출석을 만든다.
   *
   * 수동 출석은 시각을 지정할 수 있어 과거 날짜를 만들 수 있다.
   * 다만 홀딩·회원권 검사는 **오늘 기준**이므로, 회원이 지금 이용 가능해야 한다.
   */
  async function attend(userId: string, dayOffset: number, hour = 10) {
    const at = new Date();
    at.setDate(at.getDate() + dayOffset);
    at.setHours(hour, 0, 0, 0);

    return request(app.getHttpServer())
      .post('/attendance/manual')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId, checkedAt: at.toISOString() })
      .expect(201);
  }

  async function stats(path: string, query = ''): Promise<any> {
    const res = await request(app.getHttpServer())
      .get(`/stats/${path}${query ? `?${query}` : ''}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    return res.body.data;
  }

  async function detail(userId: string): Promise<any> {
    const res = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    return res.body.data;
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearDatabase(app);
    await createGym(app, TEST_GYM);
    ownerToken = (await createOwner(app, TEST_GYM.id, 'owner_stat'))
      .accessToken;
  });

  describe('매출', () => {
    it('목적이 다른 결제는 섞이지 않는다', async () => {
      // 양도 수수료 5만원이 "헬스 12개월" 매출로 집계되던 것이
      // Payment.purpose를 추가한 이유다
      const giver = await createMember('양도인', 'giver');
      const taker = await createMember('양수인', 'taker');
      const trainer = await signupAndLogin(app, TEST_GYM.id, {
        loginId: 'trainer_rev',
        password: 'password1234',
        name: '김트레이너',
      });
      await request(app.getHttpServer())
        .patch(`/users/${trainer.userId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'TRAINER' })
        .expect(200);

      const typeId = await createType('헬스 12개월', '헬스', 365, 550_000);
      const membershipId = await grant(giver, typeId, today());

      await request(app.getHttpServer())
        .post('/pt/contracts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          memberId: taker,
          trainerId: trainer.userId,
          totalSessions: 10,
          amount: 800_000,
          startDate: today(),
          endDate: addDays(today(), 90),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/memberships/${membershipId}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId: taker, fee: 50_000 })
        .expect(201);

      const rows = await stats('revenue');
      const current = rows.find((row: any) => row.month === thisMonth);

      expect(current.byPurpose).toEqual({
        MEMBERSHIP: 550_000,
        PT_CONTRACT: 800_000,
        TRANSFER_FEE: 50_000,
      });
      expect(current.total).toBe(1_400_000);
    });

    it('결제가 없는 달도 0으로 채운다', async () => {
      // 집계 결과만 주면 매출이 없는 달이 통째로 빠져 차트에 구멍이 난다
      const rows = await stats('revenue');

      expect(rows).toHaveLength(12);
      expect(rows[rows.length - 1].month).toBe(thisMonth);
      expect(rows[0].total).toBe(0);
      expect(rows[0].byPurpose).toEqual({
        MEMBERSHIP: 0,
        PT_CONTRACT: 0,
        TRANSFER_FEE: 0,
      });
    });

    it('환불된 결제는 매출이 아니다', async () => {
      const member = await createMember('환불', 'refunded');
      const typeId = await createType('헬스 1개월', '헬스', 30, 100_000);
      await grant(member, typeId, today());

      await dataSource.query(`UPDATE payments SET status = 'REFUNDED'`);

      const current = (await stats('revenue')).find(
        (row: any) => row.month === thisMonth,
      );
      expect(current.total).toBe(0);
    });

    it('시작일이 종료일보다 늦으면 400', async () => {
      const res = await request(app.getHttpServer())
        .get(`/stats/revenue?from=${today()}&to=${addDays(today(), -1)}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_DATE_RANGE');
    });
  });

  describe('신규 회원', () => {
    it('MEMBER만 센다', async () => {
      await createMember('회원1', 'member_a');
      await createMember('회원2', 'member_b');

      const trainer = await signupAndLogin(app, TEST_GYM.id, {
        loginId: 'trainer_cnt',
        password: 'password1234',
        name: '트레이너',
      });
      await request(app.getHttpServer())
        .patch(`/users/${trainer.userId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'TRAINER' })
        .expect(200);

      const current = (await stats('members')).find(
        (row: any) => row.month === thisMonth,
      );
      // 트레이너로 승격된 계정과 OWNER는 빠지고 2명만 남는다
      expect(current.newMembers).toBe(2);
    });

    it('탈퇴한 회원도 센다', async () => {
      // 제외하면 지난달 숫자가 오늘 달라져 이미 보고한 값과 어긋난다
      const member = await createMember('탈퇴예정', 'leaving');
      await createMember('잔류', 'staying');

      await request(app.getHttpServer())
        .delete(`/users/${member}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const current = (await stats('members')).find(
        (row: any) => row.month === thisMonth,
      );
      expect(current.newMembers).toBe(2);
    });
  });

  describe('트레이너', () => {
    let trainerA: string;
    let trainerAToken: string;
    let memberId: string;

    async function promote(loginId: string, name: string) {
      const trainer = await signupAndLogin(app, TEST_GYM.id, {
        loginId,
        password: 'password1234',
        name,
      });
      await request(app.getHttpServer())
        .patch(`/users/${trainer.userId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'TRAINER' })
        .expect(200);

      const relogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ loginId, password: 'password1234' })
        .expect(200);

      return { id: trainer.userId, token: relogin.body.data.accessToken };
    }

    /** 지난 수업을 하나 만들고 그 id를 돌려준다 */
    async function bookPast(
      contractId: string,
      token: string,
      dayOffset: number,
      hour: number,
    ): Promise<string> {
      const at = new Date();
      at.setDate(at.getDate() + dayOffset);
      at.setHours(hour, 0, 0, 0);

      const res = await request(app.getHttpServer())
        .post('/pt/schedules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          contractId,
          startAt: at.toISOString(),
          durationMinutes: 60,
        })
        .expect(201);
      return res.body.data.id;
    }

    async function makeContract(trainerId: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/pt/contracts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          memberId,
          trainerId,
          totalSessions: 20,
          amount: 1_000_000,
          startDate: addDays(today(), -60),
          endDate: addDays(today(), 60),
        })
        .expect(201);
      return res.body.data.id;
    }

    beforeEach(async () => {
      memberId = await createMember('PT회원', 'pt_member');
      const promoted = await promote('trainer_a', '가트레이너');
      trainerA = promoted.id;
      trainerAToken = promoted.token;
    });

    it('실적이 0건인 트레이너도 목록에 나온다', async () => {
      // 예약에서 시작하면 이 트레이너가 통째로 사라진다.
      // 데스크가 가장 확인하고 싶은 것이 "왜 실적이 없지"인데도
      await promote('trainer_b', '나트레이너');

      const rows = await stats('trainers');

      expect(rows).toHaveLength(2);
      expect(rows.every((row: any) => row.completed === 0)).toBe(true);
      expect(rows.every((row: any) => row.noShow === 0)).toBe(true);
    });

    it('완료와 노쇼를 따로 센다', async () => {
      const contractId = await makeContract(trainerA);
      const done = await bookPast(contractId, trainerAToken, -3, 10);
      const missed = await bookPast(contractId, trainerAToken, -3, 14);
      await bookPast(contractId, trainerAToken, -3, 16); // SCHEDULED로 남긴다

      await request(app.getHttpServer())
        .patch(`/pt/schedules/${done}/complete`)
        .set('Authorization', `Bearer ${trainerAToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/pt/schedules/${missed}/no-show`)
        .set('Authorization', `Bearer ${trainerAToken}`)
        .send({ deductSession: false })
        .expect(200);

      const [row] = await stats('trainers');

      expect(row.trainerName).toBe('가트레이너');
      expect(row.completed).toBe(1);
      expect(row.noShow).toBe(1);
    });

    it('기간 밖의 수업은 세지 않되 트레이너는 남는다', async () => {
      // 기간 조건을 WHERE에 넣으면 조인 결과가 없는 행이 탈락해
      // LEFT JOIN이 사실상 INNER JOIN이 된다. 그러면 이 트레이너가 사라진다
      const contractId = await makeContract(trainerA);
      const done = await bookPast(contractId, trainerAToken, -30, 10);
      await request(app.getHttpServer())
        .patch(`/pt/schedules/${done}/complete`)
        .set('Authorization', `Bearer ${trainerAToken}`)
        .expect(200);

      const rows = await stats(
        'trainers',
        `from=${addDays(today(), -7)}&to=${today()}`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].completed).toBe(0);
    });

    it('트레이너는 통계를 볼 수 없다', async () => {
      // 동료의 실적이 보인다
      await request(app.getHttpServer())
        .get('/stats/trainers')
        .set('Authorization', `Bearer ${trainerAToken}`)
        .expect(403);
    });
  });

  describe('회원 이용 일수', () => {
    let typeId: string;

    beforeEach(async () => {
      typeId = await createType('헬스 30일', '헬스', 30, 100_000);
    });

    it('아직 오지 않은 날은 분모에 넣지 않는다', async () => {
      // 오늘 30일권을 끊은 회원이 0/30으로 보이면 이탈 신호로 오해한다
      const member = await createMember('오늘등록', 'today_join');
      await grant(member, typeId, today());

      const { attendance } = await detail(member);

      expect(attendance.from).toBe(today());
      expect(attendance.to).toBe(today());
      expect(attendance.usableDays).toBe(1);
      expect(attendance.attendedDays).toBe(0);
    });

    it('홀딩 일수는 분모에서 뺀다', async () => {
      // 홀딩 중에는 나올 수 없으므로 분모에 두면 무조건 손해로 보인다
      const member = await createMember('홀딩', 'held');
      const membershipId = await grant(member, typeId, addDays(today(), -20));

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membershipId,
          startDate: addDays(today(), -15),
          endDate: addDays(today(), -11),
        })
        .expect(201);

      const { attendance } = await detail(member);

      // -20 ~ 오늘은 21일, 홀딩 5일을 빼면 16일
      expect(attendance.usableDays).toBe(16);
    });

    it('같은 날 여러 번 찍어도 1일이다', async () => {
      const member = await createMember('재출입', 'reentry');
      await grant(member, typeId, addDays(today(), -10));

      await attend(member, -3, 9);
      await attend(member, -3, 19);
      await attend(member, -1, 9);

      const { attendance } = await detail(member);

      expect(attendance.attendedDays).toBe(2);
      expect(attendance.usableDays).toBe(11);
    });

    it('미래에 시작하는 회원권만 있으면 0 / 0', async () => {
      // 이어붙이기로 예약해둔 회원권. 아직 셀 것이 없다
      const member = await createMember('예약', 'future');
      await grant(member, typeId, addDays(today(), 10));

      const { attendance } = await detail(member);

      expect(attendance.usableDays).toBe(0);
      expect(attendance.attendedDays).toBe(0);
    });

    it('이용 중인 회원권이 없으면 null', async () => {
      const member = await createMember('회원권없음', 'no_membership');

      expect((await detail(member)).attendance).toBeNull();
    });

    it('목록 응답에는 넣지 않는다', async () => {
      // 회원마다 집계 쿼리가 돌아 N+1이 된다
      const member = await createMember('목록', 'in_list');
      await grant(member, typeId, today());

      const res = await request(app.getHttpServer())
        .get('/users?role=MEMBER')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.items[0].attendance).toBeUndefined();
    });
  });
});
