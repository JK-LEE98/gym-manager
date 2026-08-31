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

  describe('CORS', () => {
    // 브라우저 전용 동작이라 눈으로 확인하기 쉽지만, 눈으로 확인하는 것은
    // 회귀를 못 잡는다. 설정이 조용히 빠져도 API 테스트는 전부 통과한다.
    const ALLOWED = 'http://localhost:5173';
    const ALLOWED_SECOND = 'http://localhost:4173';
    const DISALLOWED = 'http://evil.example.com';

    it('허용된 오리진의 프리플라이트에 Access-Control-Allow-Origin이 붙는다', async () => {
      const res = await request(app.getHttpServer())
        .options('/gyms/public')
        .set('Origin', ALLOWED)
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    });

    it('콤마로 구분된 두 번째 오리진도 허용된다', async () => {
      // 파싱이 첫 값만 읽고 끝나는 실수를 잡는다
      const res = await request(app.getHttpServer())
        .options('/gyms/public')
        .set('Origin', ALLOWED_SECOND)
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_SECOND);
    });

    it('허용되지 않은 오리진에는 헤더가 붙지 않는다', async () => {
      // 요청 자체는 성공한다. 브라우저가 헤더를 보고 응답을 막는 구조다
      const res = await request(app.getHttpServer())
        .get('/gyms/public')
        .set('Origin', DISALLOWED)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('쿠키를 쓰지 않으므로 credentials는 허용하지 않는다', async () => {
      // 켜는 순간 오리진이 넓어졌을 때 그대로 취약점이 된다
      const res = await request(app.getHttpServer())
        .get('/gyms/public')
        .set('Origin', ALLOWED)
        .expect(200);

      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
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
