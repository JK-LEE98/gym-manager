// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      // 마이그레이션은 `migration:generate`가 만든 생성물이다.
      //
      // prettier로 재포맷하면 generate가 내는 모양과 달라져,
      // 다음에 생성했을 때 의미 없는 diff가 섞인다.
      // lint의 목적은 사람이 쓴 코드의 문제를 잡는 것이라 여기엔 해당이 없다.
      //
      // SQL 한 줄이 24KB에 달해 재포맷 자체가 위험하기도 하다.
      'src/common/database/migrations/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  // 테스트 파일 예외
  //
  // supertest의 `res.body`와 `app.getHttpServer()`는 타입이 any다.
  // 응답 본문의 모든 필드에 타입을 붙이면 검증 의도가 보일러플레이트에 묻히고,
  // 테스트는 애초에 런타임 형태를 확인하는 코드라 정적 타입의 이득이 작다.
  //
  // 포맷·미사용 변수 등 다른 규칙은 그대로 적용된다.
  {
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
