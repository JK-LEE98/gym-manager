import * as Joi from 'joi';

/**
 * `.env` 값의 **형식**을 앱 기동 시점에 검증한다.
 *
 * ---
 *
 * **`getOrThrow`는 "값이 있는가"만 본다.**
 * ```
 * JWT_ACCESS_EXPIRES_IN=바나나   →  기동 성공. 첫 로그인 시도에서 터진다
 * DB_PORT=오천사백삼십이          →  기동 성공. 접속 실패 원인을 DB에서 찾게 된다
 * ```
 * 운영 배포 직후에 알게 되는 것이 최악이라 **뜨기 전에** 잡는다.
 *
 * Spring의 `@ConfigurationProperties` + `@Validated`에 해당한다.
 *
 * ---
 *
 * **테스트에 예외를 두지 않는다.** `NODE_ENV`로 분기해 테스트만 느슨하게 하면
 * 그 예외가 진짜 구멍이 되는 통로가 된다. `.env.test`의 시크릿도 길이를 맞췄다.
 */

/**
 * HS256은 HMAC-SHA256이라 해시 출력이 32바이트다.
 * 시크릿이 그보다 짧으면 짧은 만큼 그대로 약해진다.
 */
const SECRET_MIN_LENGTH = 32;

/** `30s` `15m` `1h` `7d` */
const DURATION = /^\d+[smhd]$/;

/**
 * Refresh Token은 **일 단위만** 허용한다.
 *
 * `TokenService.refreshExpiresAt()`이 `replace('d', '')` 후 숫자로 바꾼다.
 * `720h`를 넣으면 `Number('720h')`가 `NaN`이 되고
 * `setDate(getDate() + NaN)`이 **Invalid Date**를 만들어 저장이 깨진다.
 *
 * 코드가 이미 갖고 있는 가정을 경계에서 명시하는 것이다.
 */
const DAYS_ONLY = /^\d+d$/;

/**
 * 프론트가 붙기 전까지 필요한 오리진은 Vite dev 서버 하나뿐이다.
 * 기본값을 두는 이유는 **없다고 앱이 못 뜰 이유가 없기 때문**이다.
 * 시크릿과 달리 CORS는 틀려도 브라우저에서 즉시 드러난다.
 */
const DEFAULT_CORS_ORIGINS = 'http://localhost:5173';

export const envValidationSchema = Joi.object({
  // 오타 하나로 synchronize가 조용히 켜지거나 꺼진다. → 아키텍처 7장
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  /**
   * 브라우저가 이 API를 부를 수 있는 오리진 목록. 콤마로 구분한다.
   *
   * 값을 코드에 박지 않는 이유는 개발·운영에서 달라지기 때문이다.
   * 다만 시크릿이 아니므로 `.env.example`·`.env.test`에 실제 값을 적는다.
   */
  CORS_ORIGINS: Joi.string().default(DEFAULT_CORS_ORIGINS),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(SECRET_MIN_LENGTH).required(),

  // 세 시크릿은 서로 달라야 한다.
  //
  // 같은 값을 넣어도 서명은 유효하므로 아무 데서도 실패하지 않는다.
  // 그래서 QR 시크릿을 분리한 의미가 조용히 사라진다 —
  // Access Token을 QR로 제출해도 검증을 통과하고, `type` 필드가 유일한 방어선이 된다.
  // @see ADR-013
  JWT_REFRESH_SECRET: Joi.string()
    .min(SECRET_MIN_LENGTH)
    .required()
    .disallow(Joi.ref('JWT_ACCESS_SECRET'))
    .messages({
      'any.invalid': 'JWT_REFRESH_SECRET은 JWT_ACCESS_SECRET과 달라야 합니다',
    }),
  JWT_QR_SECRET: Joi.string()
    .min(SECRET_MIN_LENGTH)
    .required()
    .disallow(Joi.ref('JWT_ACCESS_SECRET'), Joi.ref('JWT_REFRESH_SECRET'))
    .messages({
      'any.invalid':
        'JWT_QR_SECRET은 다른 시크릿과 달라야 합니다 (같으면 type 검증이 유일한 방어선이 된다 → ADR-013)',
    }),

  JWT_ACCESS_EXPIRES_IN: Joi.string().pattern(DURATION).default('1h').messages({
    'string.pattern.base':
      'JWT_ACCESS_EXPIRES_IN은 30s·15m·1h 형식이어야 합니다',
  }),
  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .pattern(DAYS_ONLY)
    .default('30d')
    .messages({
      'string.pattern.base':
        'JWT_REFRESH_EXPIRES_IN은 일 단위여야 합니다 (예: 30d)',
    }),

  // 시드 스크립트에서만 쓴다. 없다고 앱 기동을 막을 이유가 없다
  SEED_ADMIN_LOGIN_ID: Joi.string().optional(),
  SEED_ADMIN_PASSWORD: Joi.string().optional(),
  SEED_ADMIN_NAME: Joi.string().optional(),
});

export const envValidationOptions = {
  /**
   * **모든 오류를 한 번에 보여준다.**
   *
   * 기본값(`abortEarly: true`)은 첫 오류에서 멈춰,
   * `.env`를 고칠 때마다 다시 띄우고 다음 오류를 만나는 두더지잡기가 된다.
   */
  abortEarly: false,

  /** PATH·HOME 등 시스템 환경변수가 함께 들어온다 */
  allowUnknown: true,
};
