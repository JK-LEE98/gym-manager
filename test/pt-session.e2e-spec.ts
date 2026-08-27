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
 * 수업 완료·노쇼 처리 검증. → ADR-014 결정 3·4·5
 *
 * **잔여 횟수 차감이 일어나는 유일한 지점이다.**
 * 동시에 두 번 눌렀을 때 한 번만 차감되는지가 이 스펙의 핵심이다.
 */
describe('PT 수업 확정 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let trainerToken: string;
  let trainerId: string;
  let memberToken: string;
  let memberId: string;

  function at(dayOffset: number, time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    const base = new Date();
    base.setDate(base.getDate() + dayOffset);
    base.setHours(hour, minute, 0, 0);
    return base.toISOString();
  }

  async function makeContract(totalSessions: number): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/pt/contracts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        memberId,
        trainerId,
        totalSessions,
        amount: 600_000,
        startDate: addDays(today(), -30),
        endDate: addDays(today(), 90),
      })
      .expect(201);
    return res.body.data.id;
  }

  async function book(contractId: string, startAt: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/pt/schedules')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({ contractId, startAt, durationMinutes: 60 })
      .expect(201);
    return res.body.data.id;
  }

  function complete(scheduleId: string, token = trainerToken) {
    return request(app.getHttpServer())
      .patch(`/pt/schedules/${scheduleId}/complete`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function getContract(id: string): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .get(`/pt/contracts/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    return res.body.data;
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

    ownerToken = (await createOwner(app, TEST_GYM.id, 'owner_ses')).accessToken;

    const member = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'member_ses',
      password: 'password1234',
      name: '홍길동',
    });
    memberToken = member.accessToken;
    memberId = member.userId;

    const trainer = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'trainer_ses',
      password: 'password1234',
      name: '김트레이너',
    });
    trainerId = trainer.userId;

    await request(app.getHttpServer())
      .patch(`/users/${trainerId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'TRAINER' })
      .expect(200);

    const relogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ loginId: 'trainer_ses', password: 'password1234' })
      .expect(200);
    trainerToken = relogin.body.data.accessToken;
  });

  describe('동시성', () => {
    it('잔여 1회에 두 수업을 동시에 완료하면 하나만 성공한다', async () => {
      // 이 프로젝트에서 동시성이 실제로 문제가 되는 유일한 지점이다.
      //
      // 읽고(SELECT) → 판단하고 → 쓰는(UPDATE) 방식은 그 사이에
      // 다른 트랜잭션이 끼어들어 **둘 다 잔여 1을 읽는다.**
      // 결과: 2회 수업이 소진됐는데 차감은 1회만 된다.
      const contractId = await makeContract(1);
      const first = await book(contractId, at(-2, '10:00'));
      const second = await book(contractId, at(-2, '14:00'));

      const results = await Promise.all([complete(first), complete(second)]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);

      const failed = results.find((r) => r.status === 409);
      expect(failed!.body.errorCode).toBe('NO_REMAINING_SESSIONS');

      const contract = await getContract(contractId);
      expect(contract.remainingSessions).toBe(0);
    });

    it('같은 수업을 동시에 두 번 완료해도 한 번만 차감된다', async () => {
      // 버튼 중복 클릭. 상태 검사도 읽고-쓰기 사이가 비어 있다
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      const results = await Promise.all([
        complete(scheduleId),
        complete(scheduleId),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);

      const contract = await getContract(contractId);
      expect(contract.remainingSessions).toBe(9);
    });
  });

  describe('완료 확정', () => {
    it('완료하면 잔여 횟수가 1 차감된다', async () => {
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      const res = await complete(scheduleId).expect(200);

      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.sessionDeducted).toBe(true);

      const contract = await getContract(contractId);
      expect(contract.remainingSessions).toBe(9);
    });

    it('잔여 횟수를 다 쓰면 계약이 COMPLETED가 된다', async () => {
      const contractId = await makeContract(1);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      await complete(scheduleId).expect(200);

      const contract = await getContract(contractId);
      expect(contract.remainingSessions).toBe(0);
      expect(contract.status).toBe('COMPLETED');
    });

    it('잔여가 없으면 완료할 수 없다', async () => {
      const contractId = await makeContract(1);
      const used = await book(contractId, at(-2, '10:00'));
      const extra = await book(contractId, at(-2, '14:00'));

      await complete(used).expect(200);
      const res = await complete(extra).expect(409);

      expect(res.body.errorCode).toBe('NO_REMAINING_SESSIONS');
    });

    it('이미 완료된 수업은 다시 완료할 수 없다', async () => {
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      await complete(scheduleId).expect(200);
      const res = await complete(scheduleId).expect(409);

      expect(res.body.errorCode).toBe('INVALID_SCHEDULE_STATUS');
    });

    it('회원은 완료 처리할 수 없다', async () => {
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      await complete(scheduleId, memberToken).expect(403);
    });

    it('OWNER는 정정할 수 있다', async () => {
      // 트레이너도 실적이라는 이해관계가 있어 데스크에 정정 경로를 둔다
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      await complete(scheduleId, ownerToken).expect(200);
    });
  });

  describe('노쇼', () => {
    function noShow(scheduleId: string, deductSession: boolean) {
      return request(app.getHttpServer())
        .patch(`/pt/schedules/${scheduleId}/no-show`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({ deductSession });
    }

    it('차감하는 노쇼', async () => {
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      const res = await noShow(scheduleId, true).expect(200);

      expect(res.body.data.status).toBe('NO_SHOW');
      expect(res.body.data.sessionDeducted).toBe(true);
      expect((await getContract(contractId)).remainingSessions).toBe(9);
    });

    it('봐주는 노쇼 — 이력은 남고 횟수는 그대로', async () => {
      // status와 sessionDeducted를 분리한 이유다.
      // CANCELLED로 뭉개면 이 회원이 노쇼를 몇 번 했는지 셀 수 없다
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      const res = await noShow(scheduleId, false).expect(200);

      expect(res.body.data.status).toBe('NO_SHOW');
      expect(res.body.data.sessionDeducted).toBe(false);
      expect((await getContract(contractId)).remainingSessions).toBe(10);
    });

    it('이미 처리된 수업은 노쇼로 바꿀 수 없다', async () => {
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      await complete(scheduleId).expect(200);
      const res = await noShow(scheduleId, true).expect(409);

      expect(res.body.errorCode).toBe('INVALID_SCHEDULE_STATUS');
    });
  });

  describe('미확인 목록', () => {
    it('시간이 지났는데 확인 안 된 수업이 뜬다', async () => {
      const contractId = await makeContract(10);
      await book(contractId, at(-2, '10:00'));
      await book(contractId, at(5, '10:00')); // 아직 안 지남

      const res = await request(app.getHttpServer())
        .get('/pt/schedules/unconfirmed')
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('확인하면 목록에서 사라진다', async () => {
      const contractId = await makeContract(10);
      const scheduleId = await book(contractId, at(-2, '10:00'));

      await complete(scheduleId).expect(200);

      const res = await request(app.getHttpServer())
        .get('/pt/schedules/unconfirmed')
        .set('Authorization', `Bearer ${trainerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(0);
    });

    it('회원은 조회할 수 없다', async () => {
      await request(app.getHttpServer())
        .get('/pt/schedules/unconfirmed')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });
  });
});
