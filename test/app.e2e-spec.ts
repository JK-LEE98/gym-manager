import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/e2e-setup';

/**
 * 공통 인프라 검증.
 *
 * 개별 도메인이 아니라 전역 Guard·Interceptor·Filter가 제대로 걸려 있는지 확인한다.
 * 하나라도 빠지면 모든 엔드포인트가 영향을 받으므로 별도로 둔다.
 */
describe('공통 인프라 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('전역 Guard가 걸려 있어 인증 없는 요청은 401이다', async () => {
    // @Public이 없는 라우트는 기본적으로 보호된다.
    // Guard를 개별 라우트에 붙이는 방식이었다면 누락 시 조용히 열렸을 것이다
    const res = await request(app.getHttpServer()).get('/').expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('UNAUTHORIZED');
  });

  it('존재하지 않는 경로도 공통 에러 포맷으로 응답한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);

    expect(res.body).toMatchObject({
      success: false,
      data: null,
      errorCode: 'NOT_FOUND',
    });
    expect(typeof res.body.message).toBe('string');
  });

  it('@Public 라우트는 성공 응답이 공통 포맷으로 감싸진다', async () => {
    const res = await request(app.getHttpServer())
      .get('/gyms/public')
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      message: expect.any(String),
    });
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
