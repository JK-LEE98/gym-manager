import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { addDays, today } from '../src/common/utils/date.util';
import {
  OTHER_GYM,
  TEST_GYM,
  clearDatabase,
  createGym,
  createOwner,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * QR 출석 검증. → ADR-013
 *
 * 두 지점이 이 스펙의 핵심이다.
 * ① Access Token을 QR로 제출하면 막히는가 (시크릿 분리 + type 검증)
 * ② 재출입이 하루 입장 횟수에 걸리지 않는가 (검증 순서)
 *
 * 둘 다 **순서나 조건 하나가 바뀌면 조용히 깨지는 곳**이다.
 */
describe('출석 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let memberToken: string;
  let memberId: string;

  const MEMBER_NAME = '이준규';

  async function createType(holdingLimit = 0): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/membership-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: '헬스 30일',
        category: '헬스',
        durationDays: 30,
        price: 100_000,
        holdingLimit,
      })
      .expect(201);
    return res.body.data.id;
  }

  async function grant(typeId: string, startDate?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        userId: memberId,
        membershipTypeId: typeId,
        ...(startDate ? { startDate } : {}),
      })
      .expect(201);
    return res.body.data.id;
  }

  /** 회원이 본인 QR을 발급받는다 */
  async function issueQr(token = memberToken): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/attendance/qr-token')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.token;
  }

  function checkIn(qrToken: string) {
    return request(app.getHttpServer())
      .post('/attendance/check-in')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ token: qrToken });
  }

  async function setEntryPolicy(policy: {
    dailyEntryLimit?: number | null;
    reentryGraceMinutes?: number;
  }): Promise<void> {
    await request(app.getHttpServer())
      .patch('/gyms/me/entry-policy')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(policy)
      .expect(200);
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
    await createGym(app, OTHER_GYM);

    ownerToken = (await createOwner(app, TEST_GYM.id, 'owner_att')).accessToken;

    const member = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'member_att',
      password: 'password1234',
      name: MEMBER_NAME,
    });
    memberToken = member.accessToken;
    memberId = member.userId;
  });

  describe('QR 토큰', () => {
    it('30초 만료의 토큰을 발급한다', async () => {
      const res = await request(app.getHttpServer())
        .get('/attendance/qr-token')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(res.body.data.expiresIn).toBe(30);
      expect(res.body.data.token).toEqual(expect.any(String));
    });

    it('Access Token을 QR로 제출하면 거부된다', async () => {
      // 시크릿이 분리되어 있어 서명 검증 단계에서 걸린다.
      // 이 방어가 없으면 30초 만료 설계가 통째로 무의미해진다.
      const res = await checkIn(memberToken).expect(401);

      expect(res.body.errorCode).toBe('QR_TOKEN_EXPIRED');
    });

    it('QR 시크릿으로 서명했더라도 type이 다르면 거부된다', async () => {
      // 시크릿 설정이 잘못되는 상황까지 대비한 두 번째 방어선
      const forged = jwt.sign(
        { sub: memberId, gymId: TEST_GYM.id, type: 'ACCESS' },
        'test-qr-secret',
        { expiresIn: 30 },
      );

      const res = await checkIn(forged).expect(401);

      expect(res.body.errorCode).toBe('INVALID_TOKEN_TYPE');
    });

    it('만료된 QR은 거부된다', async () => {
      const expired = jwt.sign(
        { sub: memberId, gymId: TEST_GYM.id, type: 'ATTENDANCE' },
        'test-qr-secret',
        { expiresIn: -1 },
      );

      await checkIn(expired).expect(401);
    });

    it('다른 헬스장의 QR은 거부된다', async () => {
      const otherGymQr = jwt.sign(
        { sub: memberId, gymId: OTHER_GYM.id, type: 'ATTENDANCE' },
        'test-qr-secret',
        { expiresIn: 30 },
      );

      const res = await checkIn(otherGymQr).expect(403);

      expect(res.body.errorCode).toBe('TENANT_MISMATCH');
    });
  });

  describe('출석 처리', () => {
    it('유효한 회원권이 있으면 출석된다', async () => {
      await grant(await createType());

      const res = await checkIn(await issueQr()).expect(201);

      expect(res.body.data.isReentry).toBe(false);
      expect(res.body.data.daysUntilExpiry).toBe(29);
    });

    it('응답에 풀네임이 없고 가운데가 마스킹된다', async () => {
      await grant(await createType());

      const res = await checkIn(await issueQr()).expect(201);

      expect(res.body.data.maskedName).toBe('이*규');
      // 문 앞 화면은 지나가는 사람에게도 보인다
      expect(JSON.stringify(res.body)).not.toContain(MEMBER_NAME);
    });

    it('회원권이 없으면 입장할 수 없다', async () => {
      const res = await checkIn(await issueQr()).expect(403);

      expect(res.body.errorCode).toBe('NO_ACTIVE_MEMBERSHIP');
      expect(res.body.message).toContain('이용 가능한 회원권이 없습니다');
    });

    it('만료된 회원권으로는 입장할 수 없다', async () => {
      // 40일 전에 시작한 30일권 → 이미 만료
      await grant(await createType(), addDays(today(), -40));

      const res = await checkIn(await issueQr()).expect(403);

      expect(res.body.errorCode).toBe('NO_ACTIVE_MEMBERSHIP');
    });

    it('휴회 중이면 입장이 막히고 철회를 안내한다', async () => {
      const membershipId = await grant(
        await createType(3),
        addDays(today(), -10),
      );

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membershipId,
          startDate: today(),
          endDate: addDays(today(), 5),
        })
        .expect(201);

      const res = await checkIn(await issueQr()).expect(403);

      expect(res.body.errorCode).toBe('MEMBERSHIP_ON_HOLD');
      expect(res.body.message).toContain('휴회를 철회한 후');
    });

    it('휴회 중 출석해도 홀딩이 자동으로 끝나지 않는다', async () => {
      // 홀딩은 회원이 신청한 것이다. 시스템이 임의로 종료하면
      // 회원 동의 없이 회원권 기간을 깎는 것이 된다. → ADR-013 결정 4
      const membershipId = await grant(
        await createType(3),
        addDays(today(), -10),
      );

      const before = await request(app.getHttpServer())
        .get(`/memberships/${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membershipId,
          startDate: today(),
          endDate: addDays(today(), 5),
        })
        .expect(201);

      await checkIn(await issueQr()).expect(403);

      const holds = await request(app.getHttpServer())
        .get(`/holds?userMembershipId=${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(holds.body.data[0].phase).toBe('IN_PROGRESS');
      expect(holds.body.data[0].endDate).toBe(addDays(today(), 5));

      const after = await request(app.getHttpServer())
        .get(`/memberships/${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // 종료일이 홀딩 6일만큼만 밀려 있어야 한다 (출석으로 되돌아가지 않음)
      expect(after.body.data.endDate).toBe(
        addDays(before.body.data.endDate, 6),
      );
    });

    it('MEMBER는 스캔 단말 API를 호출할 수 없다', async () => {
      await request(app.getHttpServer())
        .post('/attendance/check-in')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ token: await issueQr() })
        .expect(403);
    });
  });

  describe('하루 입장 횟수', () => {
    beforeEach(async () => {
      await grant(await createType());
    });

    it('기본값은 무제한이다', async () => {
      await checkIn(await issueQr()).expect(201);
      await checkIn(await issueQr()).expect(201);
      await checkIn(await issueQr()).expect(201);
    });

    it('제한을 넘으면 막히고 문의를 안내한다', async () => {
      await setEntryPolicy({ dailyEntryLimit: 1 });

      await checkIn(await issueQr()).expect(201);
      const res = await checkIn(await issueQr()).expect(409);

      expect(res.body.errorCode).toBe('DAILY_ENTRY_LIMIT_EXCEEDED');
      expect(res.body.message).toContain('헬스장에 문의');
    });

    it('2회 정책이면 두 번까지 허용된다', async () => {
      await setEntryPolicy({ dailyEntryLimit: 2 });

      await checkIn(await issueQr()).expect(201);
      await checkIn(await issueQr()).expect(201);
      await checkIn(await issueQr()).expect(409);
    });

    it('null로 되돌리면 다시 무제한이 된다', async () => {
      await setEntryPolicy({ dailyEntryLimit: 1 });
      await checkIn(await issueQr()).expect(201);
      await checkIn(await issueQr()).expect(409);

      // `?? 기존값`으로 구현하면 null이 무시되어 되돌릴 수 없다
      await setEntryPolicy({ dailyEntryLimit: null });

      await checkIn(await issueQr()).expect(201);
    });
  });

  describe('재출입', () => {
    beforeEach(async () => {
      await grant(await createType());
    });

    it('유예 시간 안의 재스캔은 횟수에 세지 않는다', async () => {
      // 하루 1회 제한 + 출입 통제형 헬스장.
      // 흡연하러 나갔다 온 회원이 문 앞에서 막히면 안 된다.
      await setEntryPolicy({ dailyEntryLimit: 1, reentryGraceMinutes: 30 });

      const first = await checkIn(await issueQr()).expect(201);
      expect(first.body.data.isReentry).toBe(false);

      const second = await checkIn(await issueQr()).expect(201);
      expect(second.body.data.isReentry).toBe(true);

      // 세 번째도 여전히 유예 안이므로 통과한다
      await checkIn(await issueQr()).expect(201);
    });

    it('재입장도 이력에 남는다', async () => {
      await setEntryPolicy({ reentryGraceMinutes: 30 });

      await checkIn(await issueQr()).expect(201);
      await checkIn(await issueQr()).expect(201);

      const res = await request(app.getHttpServer())
        .get('/attendance')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // 무인 헬스장은 사고 시 누가 언제 있었는지가 필요하다
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.filter((a: any) => !a.isReentry)).toHaveLength(1);
    });

    it('유예가 0이면 매 스캔이 새 입장이다', async () => {
      // 데스크가 있고 QR은 기록용인 헬스장
      await setEntryPolicy({ dailyEntryLimit: 1, reentryGraceMinutes: 0 });

      await checkIn(await issueQr()).expect(201);
      await checkIn(await issueQr()).expect(409);
    });

    it('재입장은 회원권 검사를 건너뛴다', async () => {
      await setEntryPolicy({ reentryGraceMinutes: 30 });

      const res = await checkIn(await issueQr()).expect(201);
      expect(res.body.data.daysUntilExpiry).toBe(29);

      const reentry = await checkIn(await issueQr()).expect(201);
      expect(reentry.body.data.daysUntilExpiry).toBeNull();
    });
  });

  describe('수동 출석', () => {
    it('데스크가 대신 처리할 수 있다', async () => {
      await grant(await createType());

      const res = await request(app.getHttpServer())
        .post('/attendance/manual')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: memberId })
        .expect(201);

      expect(res.body.data.maskedName).toBe('이*규');
    });

    it('수동도 같은 검증을 받는다', async () => {
      // 수동이 뒷문이 되면 정책 자체가 무의미해진다
      const res = await request(app.getHttpServer())
        .post('/attendance/manual')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: memberId })
        .expect(403);

      expect(res.body.errorCode).toBe('NO_ACTIVE_MEMBERSHIP');
    });
  });

  describe('이력 조회', () => {
    it('회원은 본인 이력만 본다', async () => {
      await grant(await createType());
      await checkIn(await issueQr()).expect(201);

      const res = await request(app.getHttpServer())
        .get('/attendance/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].method).toBe('QR');
    });

    it('MEMBER는 전체 이력을 조회할 수 없다', async () => {
      await request(app.getHttpServer())
        .get('/attendance')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });
  });
});
