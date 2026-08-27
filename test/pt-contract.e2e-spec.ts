import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
 * PT 계약 검증. → ADR-014
 *
 * 핵심은 두 가지다.
 * ① 계약과 결제가 한 트랜잭션으로 묶이는가
 * ② PT 결제가 회원권 매출에 섞이지 않는가 (`purpose`)
 */
describe('PT 계약 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let memberToken: string;
  let memberId: string;
  let trainerToken: string;
  let trainerId: string;

  async function promoteToTrainer(userId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/users/${userId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'TRAINER' })
      .expect(200);
  }

  function createContract(body: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/pt/contracts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        memberId,
        trainerId,
        totalSessions: 20,
        amount: 1_200_000,
        startDate: today(),
        endDate: addDays(today(), 180),
        ...body,
      });
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

    ownerToken = (await createOwner(app, TEST_GYM.id, 'owner_pt')).accessToken;

    const member = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'member_pt',
      password: 'password1234',
      name: '홍길동',
    });
    memberToken = member.accessToken;
    memberId = member.userId;

    const trainer = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'trainer_pt',
      password: 'password1234',
      name: '김트레이너',
    });
    trainerId = trainer.userId;
    await promoteToTrainer(trainerId);

    // 역할이 바뀌었으므로 토큰을 다시 받는다
    const relogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ loginId: 'trainer_pt', password: 'password1234' })
      .expect(200);
    trainerToken = relogin.body.data.accessToken;
  });

  describe('계약 등록', () => {
    it('잔여 횟수가 총 횟수로 초기화된다', async () => {
      const res = await createContract().expect(201);

      expect(res.body.data.totalSessions).toBe(20);
      expect(res.body.data.remainingSessions).toBe(20);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.trainerName).toBe('김트레이너');
    });

    it('결제가 함께 생성된다', async () => {
      const res = await createContract().expect(201);

      expect(res.body.data.payment).toEqual({
        amount: 1_200_000,
        method: 'MANUAL',
      });
    });

    it('PT 결제는 회원권 종류에 연결되지 않는다', async () => {
      // 연결하면 PT 계약금이 회원권 매출로 집계된다
      await createContract().expect(201);

      const rows = await app
        .get(DataSource)
        .query(
          'SELECT purpose, membership_type_id FROM payments WHERE purpose = $1',
          ['PT_CONTRACT'],
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].membership_type_id).toBeNull();
    });

    it('트레이너가 아닌 계정은 담당으로 지정할 수 없다', async () => {
      // 회원을 담당으로 지정하면 그 회원은 영영 수업을 받을 수 없다
      const res = await createContract({ trainerId: memberId }).expect(400);

      expect(res.body.errorCode).toBe('INVALID_TRAINER');
    });

    it('존재하지 않는 회원이면 계약도 결제도 남지 않는다', async () => {
      await createContract({
        memberId: '00000000-0000-4000-8000-00000000dead',
      }).expect(404);

      const payments = await app
        .get(DataSource)
        .query('SELECT id FROM payments');

      expect(payments).toHaveLength(0);
    });

    it('OWNER가 아니면 계약을 등록할 수 없다', async () => {
      await request(app.getHttpServer())
        .post('/pt/contracts')
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({
          memberId,
          trainerId,
          totalSessions: 10,
          amount: 600_000,
          startDate: today(),
          endDate: addDays(today(), 90),
        })
        .expect(403);
    });

    it('금액은 필수다', async () => {
      // PT는 정가표가 없다. 횟수·트레이너·협상에 따라 매번 다르다
      const res = await createContract({ amount: undefined }).expect(400);

      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });
  });

  describe('조회', () => {
    it('회원은 자기가 받는 계약을 본다', async () => {
      await createContract().expect(201);

      const res = await request(app.getHttpServer())
        .get('/pt/contracts/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].memberId).toBe(memberId);
    });

    it('트레이너는 자기가 가르치는 계약을 본다', async () => {
      await createContract().expect(201);

      const res = await request(app.getHttpServer())
        .get('/pt/contracts/me')
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].trainerId).toBe(trainerId);
    });

    it('trainerId로 필터링된다', async () => {
      await createContract().expect(201);

      const res = await request(app.getHttpServer())
        .get(`/pt/contracts?trainerId=${trainerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('만료까지 남은 일수를 계산해 반환한다', async () => {
      await createContract({ endDate: addDays(today(), 30) }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/pt/contracts/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(res.body.data[0].daysUntilExpiry).toBe(30);
    });

    it('MEMBER는 전체 목록을 조회할 수 없다', async () => {
      await request(app.getHttpServer())
        .get('/pt/contracts')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });
  });

  describe('취소', () => {
    it('취소해도 이력은 남는다', async () => {
      const created = await createContract().expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/pt/contracts/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('CANCELLED');

      const list = await request(app.getHttpServer())
        .get('/pt/contracts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(list.body.data).toHaveLength(1);
    });

    it('이미 취소된 계약은 다시 취소할 수 없다', async () => {
      const created = await createContract().expect(201);
      const url = `/pt/contracts/${created.body.data.id}/cancel`;

      await request(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);

      expect(res.body.errorCode).toBe('INVALID_CONTRACT_STATUS');
    });
  });
});
