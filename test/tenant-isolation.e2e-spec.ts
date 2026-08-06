import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { Role } from '../src/common/enums/role.enum';
import {
  OTHER_GYM,
  TEST_GYM,
  clearDatabase,
  createGym,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * 멀티테넌시 데이터 격리 검증. → ADR-004
 *
 * 격리가 깨지면 다른 헬스장의 회원 정보가 노출된다.
 * 조건 하나만 빠뜨려도 발생하므로 자동 검증이 특히 중요한 영역이다.
 */
describe('테넌트 격리 (e2e)', () => {
  let app: INestApplication;

  /** OWNER는 SUPER_ADMIN이 발급하므로 직접 생성한다 */
  async function createOwner(
    gymId: string,
    loginId: string,
  ): Promise<{ accessToken: string }> {
    const password = 'owner1234';
    await app
      .get(DataSource)
      .query(
        'INSERT INTO users (gym_id, login_id, password, name, role) VALUES ($1, $2, $3, $4, $5)',
        [
          gymId,
          loginId,
          await bcrypt.hash(password, 10),
          '운영계정',
          Role.OWNER,
        ],
      );

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ loginId, password })
      .expect(200);

    return { accessToken: login.body.data.accessToken };
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
  });

  it('다른 헬스장 회원을 조회하면 USER_NOT_FOUND를 반환한다', async () => {
    // TENANT_MISMATCH가 아니라 USER_NOT_FOUND여야 한다.
    // "그 ID는 존재하지만 네 것이 아니다"를 알려주면 그 자체가 정보 노출이다
    const { accessToken } = await createOwner(TEST_GYM.id, 'gym_a_owner');
    const { userId: otherGymUserId } = await signupAndLogin(app, OTHER_GYM.id, {
      loginId: 'other_member',
      password: 'password1234',
      name: '타 헬스장 회원',
    });

    const res = await request(app.getHttpServer())
      .get(`/users/${otherGymUserId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    expect(res.body.errorCode).toBe('USER_NOT_FOUND');
  });

  it('회원 목록에는 본인 헬스장 소속만 포함된다', async () => {
    const { accessToken } = await createOwner(TEST_GYM.id, 'gym_a_owner');

    await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'my_member',
      password: 'password1234',
      name: '우리 회원',
    });
    await signupAndLogin(app, OTHER_GYM.id, {
      loginId: 'other_member',
      password: 'password1234',
      name: '타 헬스장 회원',
    });

    const res = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const loginIds = res.body.data.items.map(
      (u: { loginId: string }) => u.loginId,
    );
    expect(loginIds).toContain('my_member');
    expect(loginIds).toContain('gym_a_owner');
    expect(loginIds).not.toContain('other_member');
  });

  it('다른 헬스장 회원의 역할은 변경할 수 없다', async () => {
    const { accessToken } = await createOwner(TEST_GYM.id, 'gym_a_owner');
    const { userId: otherGymUserId } = await signupAndLogin(app, OTHER_GYM.id, {
      loginId: 'other_member',
      password: 'password1234',
      name: '타 헬스장 회원',
    });

    await request(app.getHttpServer())
      .patch(`/users/${otherGymUserId}/role`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: Role.TRAINER })
      .expect(404);
  });

  it('OWNER는 다른 헬스장 정보를 조회할 수 없다', async () => {
    // 헬스장 ID는 공개 목록에 이미 노출되므로 존재를 숨길 이유가 없다.
    // 회원과 달리 TENANT_MISMATCH로 응답한다
    const { accessToken } = await createOwner(TEST_GYM.id, 'gym_a_owner');

    const res = await request(app.getHttpServer())
      .get(`/gyms/${OTHER_GYM.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(res.body.errorCode).toBe('TENANT_MISMATCH');
  });

  it('OWNER는 전체 헬스장 목록에 접근할 수 없다', async () => {
    const { accessToken } = await createOwner(TEST_GYM.id, 'gym_a_owner');

    const res = await request(app.getHttpServer())
      .get('/gyms')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(res.body.errorCode).toBe('FORBIDDEN');
  });

  it('MEMBER는 회원 관리 API에 접근할 수 없다', async () => {
    const { accessToken } = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'plain_member',
      password: 'password1234',
      name: '일반 회원',
    });

    const res = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(res.body.errorCode).toBe('FORBIDDEN');
  });
});
