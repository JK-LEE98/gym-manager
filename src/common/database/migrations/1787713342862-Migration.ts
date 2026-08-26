import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 초기 스키마. 빈 DB에서 `migration:generate`로 뽑고 확장 두 개를 손으로 채웠다.
 *
 * ---
 *
 * **`generate`는 확장을 뽑아내지 못한다.** Entity 메타데이터에 없기 때문이다.
 * 지금까지는 `synchronize`가 돌기 전에 앱이 따로 설치해왔다.
 *
 * | 확장 | 없으면 |
 * |------|--------|
 * | `uuid-ossp` | 모든 PK 기본값 `uuid_generate_v4()`가 `function does not exist` |
 * | `btree_gist` | `pt_schedules`의 EXCLUDE가 `uuid has no default operator class for gist` |
 *
 * **반드시 테이블 생성보다 앞이어야 한다.** 순서가 뒤집히면 첫 줄에서 실패한다.
 *
 * ---
 *
 * **`down`에서는 확장을 지우지 않는다.** 같은 DB의 다른 스키마가 쓰고 있을 수 있고,
 * 확장을 되돌려 얻는 것이 없다. 롤백은 **이 마이그레이션이 만든 것**만 거둔다.
 */
export class Migration1787713342862 implements MigrationInterface {
    name = 'Migration1787713342862'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "btree_gist"`);
        await queryRunner.query(`CREATE TABLE "trainer_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "specialty" character varying(100), "bio" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_034888848d5419a8d9c598de02e" UNIQUE ("user_id"), CONSTRAINT "REL_034888848d5419a8d9c598de02" UNIQUE ("user_id"), CONSTRAINT "PK_656359178126f4d2c367321339c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."refresh_tokens_revoked_reason_enum" AS ENUM('ROTATED', 'LOGOUT', 'REUSE_DETECTED', 'SECURITY')`);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "device_info" character varying(255), "expires_at" TIMESTAMP NOT NULL, "revoked_at" TIMESTAMP, "revoked_reason" "public"."refresh_tokens_revoked_reason_enum", "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a7838d2ba25be1342091b6695f1" UNIQUE ("token_hash"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_refresh_tokens_expires" ON "refresh_tokens"  ("expires_at") `);
        await queryRunner.query(`CREATE INDEX "idx_refresh_tokens_user_revoked" ON "refresh_tokens"  ("user_id", "revoked_at") `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('SUPER_ADMIN', 'OWNER', 'TRAINER', 'MEMBER')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid, "login_id" character varying(50) NOT NULL, "password" character varying(255) NOT NULL, "name" character varying(50) NOT NULL, "phone" character varying(20), "address" character varying(255), "birth_date" date, "memo" text, "role" "public"."users_role_enum" NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_e564194a9a22f8c623354284f75" UNIQUE ("login_id"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_users_gym_role" ON "users"  ("gym_id", "role") `);
        await queryRunner.query(`CREATE TABLE "gyms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "address" character varying(255), "phone" character varying(20), "is_active" boolean NOT NULL DEFAULT true, "daily_entry_limit" integer, "reentry_grace_minutes" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fe765086496cf3c8475652cddcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."attendances_method_enum" AS ENUM('QR', 'MANUAL')`);
        await queryRunner.query(`CREATE TABLE "attendances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "user_id" uuid NOT NULL, "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL, "method" "public"."attendances_method_enum" NOT NULL, "is_reentry" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_483ed97cd4cd43ab4a117516b69" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_attendances_gym_checked" ON "attendances"  ("gym_id", "checked_at") `);
        await queryRunner.query(`CREATE INDEX "idx_attendances_gym_user_checked" ON "attendances"  ("gym_id", "user_id", "checked_at") `);
        await queryRunner.query(`CREATE TABLE "membership_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "category" character varying(50) NOT NULL, "duration_days" integer NOT NULL, "price" integer NOT NULL, "holding_limit" integer NOT NULL DEFAULT '0', "holding_max_days" integer NOT NULL DEFAULT '14', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0167e3d35a9e0175ef5dade53f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_membership_types_gym_active" ON "membership_types"  ("gym_id", "is_active") `);
        await queryRunner.query(`CREATE TYPE "public"."payments_purpose_enum" AS ENUM('MEMBERSHIP', 'PT_CONTRACT', 'TRANSFER_FEE')`);
        await queryRunner.query(`CREATE TYPE "public"."payments_method_enum" AS ENUM('MANUAL', 'KAKAO_PAY', 'TOSS')`);
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED')`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "user_id" uuid NOT NULL, "membership_type_id" uuid, "purpose" "public"."payments_purpose_enum" NOT NULL, "amount" integer NOT NULL, "method" "public"."payments_method_enum" NOT NULL DEFAULT 'MANUAL', "status" "public"."payments_status_enum" NOT NULL DEFAULT 'COMPLETED', "pg_transaction_id" character varying(255), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_payments_gym_created" ON "payments"  ("gym_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "public"."user_memberships_status_enum" AS ENUM('ACTIVE', 'CANCELLED', 'TRANSFERRED')`);
        await queryRunner.query(`CREATE TABLE "user_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "user_id" uuid NOT NULL, "membership_type_id" uuid NOT NULL, "payment_id" uuid, "start_date" date NOT NULL, "end_date" date NOT NULL, "status" "public"."user_memberships_status_enum" NOT NULL DEFAULT 'ACTIVE', "memo" text, "is_transferred" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_d7709ffe3fe21152decf0ebc20" UNIQUE ("payment_id"), CONSTRAINT "PK_5da67bb31a58da5c021ed713860" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_user_memberships_gym_end_date" ON "user_memberships"  ("gym_id", "end_date") `);
        await queryRunner.query(`CREATE INDEX "idx_user_memberships_gym_user_status" ON "user_memberships"  ("gym_id", "user_id", "status") `);
        await queryRunner.query(`CREATE TYPE "public"."membership_holds_status_enum" AS ENUM('ACTIVE', 'CANCELLED')`);
        await queryRunner.query(`CREATE TYPE "public"."membership_holds_created_by_role_enum" AS ENUM('SUPER_ADMIN', 'OWNER', 'TRAINER', 'MEMBER')`);
        await queryRunner.query(`CREATE TABLE "membership_holds" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "user_membership_id" uuid NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "status" "public"."membership_holds_status_enum" NOT NULL DEFAULT 'ACTIVE', "created_by_user_id" uuid NOT NULL, "created_by_role" "public"."membership_holds_created_by_role_enum" NOT NULL, "reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_81d347d5a3a50ab3df3e86b835a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_holds_gym_dates" ON "membership_holds"  ("gym_id", "start_date", "end_date") `);
        await queryRunner.query(`CREATE INDEX "idx_holds_membership_status" ON "membership_holds"  ("user_membership_id", "status") `);
        await queryRunner.query(`CREATE TABLE "membership_transfers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "from_membership_id" uuid NOT NULL, "to_membership_id" uuid NOT NULL, "from_user_id" uuid NOT NULL, "to_user_id" uuid NOT NULL, "transferred_days" integer NOT NULL, "fee_payment_id" uuid, "memo" text, "created_by_user_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dc047811848999b37a7f4be0872" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_transfers_to_user" ON "membership_transfers"  ("to_user_id") `);
        await queryRunner.query(`CREATE INDEX "idx_transfers_from_user" ON "membership_transfers"  ("from_user_id") `);
        await queryRunner.query(`CREATE INDEX "idx_transfers_gym_created" ON "membership_transfers"  ("gym_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "public"."pt_contracts_status_enum" AS ENUM('ACTIVE', 'COMPLETED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "pt_contracts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "member_id" uuid NOT NULL, "trainer_id" uuid NOT NULL, "payment_id" uuid, "total_sessions" integer NOT NULL, "remaining_sessions" integer NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "status" "public"."pt_contracts_status_enum" NOT NULL DEFAULT 'ACTIVE', "memo" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_21e4f8821fa9905875c3b4f509" UNIQUE ("payment_id"), CONSTRAINT "PK_2184c2096274804b57e0d162c16" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_pt_contracts_gym_trainer" ON "pt_contracts"  ("gym_id", "trainer_id") `);
        await queryRunner.query(`CREATE INDEX "idx_pt_contracts_gym_member" ON "pt_contracts"  ("gym_id", "member_id") `);
        await queryRunner.query(`CREATE TYPE "public"."pt_schedules_status_enum" AS ENUM('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "pt_schedules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gym_id" uuid NOT NULL, "contract_id" uuid NOT NULL, "trainer_id" uuid NOT NULL, "member_id" uuid NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."pt_schedules_status_enum" NOT NULL DEFAULT 'SCHEDULED', "session_deducted" boolean NOT NULL DEFAULT false, "confirmed_by_user_id" uuid, "memo" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "no_trainer_overlap" EXCLUDE USING gist (trainer_id WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE (status <> 'CANCELLED'), CONSTRAINT "PK_329f022ba584e3616f8ed6f7852" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_pt_schedules_gym_status_end" ON "pt_schedules"  ("gym_id", "status", "end_at") `);
        await queryRunner.query(`CREATE INDEX "idx_pt_schedules_gym_member_start" ON "pt_schedules"  ("gym_id", "member_id", "start_at") `);
        await queryRunner.query(`CREATE INDEX "idx_pt_schedules_gym_trainer_start" ON "pt_schedules"  ("gym_id", "trainer_id", "start_at") `);
        await queryRunner.query(`ALTER TABLE "trainer_profiles" ADD CONSTRAINT "FK_034888848d5419a8d9c598de02e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_05641d53aff179b24c86e23419a" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendances" ADD CONSTRAINT "FK_fb6cb61ae4bcd35f132b391c8a6" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendances" ADD CONSTRAINT "FK_aa902e05aeb5fde7c1dd4ced2b7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_types" ADD CONSTRAINT "FK_1a239b80ad041081193b04779bf" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_d07fb3afe59ba136b721ce6ac98" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_427785468fb7d2733f59e7d7d39" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_f2b0328c6260a41397d35693c6d" FOREIGN KEY ("membership_type_id") REFERENCES "membership_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_memberships" ADD CONSTRAINT "FK_51d456f048da1b3e1af10ce8d8f" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_memberships" ADD CONSTRAINT "FK_b369bfb0586d848e7f52f47d492" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_memberships" ADD CONSTRAINT "FK_357722cf7d9bc52f4d85121a70d" FOREIGN KEY ("membership_type_id") REFERENCES "membership_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_memberships" ADD CONSTRAINT "FK_d7709ffe3fe21152decf0ebc203" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_holds" ADD CONSTRAINT "FK_e97122a20ff9be3140cfea44ef4" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_holds" ADD CONSTRAINT "FK_41ad0d8d8f711bde28b35e0322d" FOREIGN KEY ("user_membership_id") REFERENCES "user_memberships"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_holds" ADD CONSTRAINT "FK_59996286f6e37227f0018a9f771" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" ADD CONSTRAINT "FK_384cc257db44d0df867ad6d2baa" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" ADD CONSTRAINT "FK_5eb49b5176c9f38b018d6966107" FOREIGN KEY ("from_membership_id") REFERENCES "user_memberships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" ADD CONSTRAINT "FK_5193b08d7bad26f56a84b6b4555" FOREIGN KEY ("to_membership_id") REFERENCES "user_memberships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" ADD CONSTRAINT "FK_594b1b456cbb500bcd8c85c33f2" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" ADD CONSTRAINT "FK_a69c5d2e9a98f5290f7e8aa725e" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" ADD CONSTRAINT "FK_5e19b60af5b26ec7f647c9bbd0c" FOREIGN KEY ("fee_payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" ADD CONSTRAINT "FK_b84489820b9fdd099f0214440e0" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" ADD CONSTRAINT "FK_603dc1d1cbbf83f32596bc47fa4" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" ADD CONSTRAINT "FK_7efbbba9641ff074bec4db6ee0a" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" ADD CONSTRAINT "FK_24014aa904640ca4358d467be4f" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" ADD CONSTRAINT "FK_21e4f8821fa9905875c3b4f509e" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" ADD CONSTRAINT "FK_ed3b2e55bbd386a48c5b945985a" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" ADD CONSTRAINT "FK_deb72af46acfc0a9e15bd4d5a22" FOREIGN KEY ("contract_id") REFERENCES "pt_contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" ADD CONSTRAINT "FK_c392fe0a98f8473400baeda79d4" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" ADD CONSTRAINT "FK_8d4756dfd36773d6a7361dcd007" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" ADD CONSTRAINT "FK_66dc6ea29f5d6161b50b36764e7" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "pt_schedules" DROP CONSTRAINT "FK_66dc6ea29f5d6161b50b36764e7"`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" DROP CONSTRAINT "FK_8d4756dfd36773d6a7361dcd007"`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" DROP CONSTRAINT "FK_c392fe0a98f8473400baeda79d4"`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" DROP CONSTRAINT "FK_deb72af46acfc0a9e15bd4d5a22"`);
        await queryRunner.query(`ALTER TABLE "pt_schedules" DROP CONSTRAINT "FK_ed3b2e55bbd386a48c5b945985a"`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" DROP CONSTRAINT "FK_21e4f8821fa9905875c3b4f509e"`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" DROP CONSTRAINT "FK_24014aa904640ca4358d467be4f"`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" DROP CONSTRAINT "FK_7efbbba9641ff074bec4db6ee0a"`);
        await queryRunner.query(`ALTER TABLE "pt_contracts" DROP CONSTRAINT "FK_603dc1d1cbbf83f32596bc47fa4"`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" DROP CONSTRAINT "FK_b84489820b9fdd099f0214440e0"`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" DROP CONSTRAINT "FK_5e19b60af5b26ec7f647c9bbd0c"`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" DROP CONSTRAINT "FK_a69c5d2e9a98f5290f7e8aa725e"`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" DROP CONSTRAINT "FK_594b1b456cbb500bcd8c85c33f2"`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" DROP CONSTRAINT "FK_5193b08d7bad26f56a84b6b4555"`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" DROP CONSTRAINT "FK_5eb49b5176c9f38b018d6966107"`);
        await queryRunner.query(`ALTER TABLE "membership_transfers" DROP CONSTRAINT "FK_384cc257db44d0df867ad6d2baa"`);
        await queryRunner.query(`ALTER TABLE "membership_holds" DROP CONSTRAINT "FK_59996286f6e37227f0018a9f771"`);
        await queryRunner.query(`ALTER TABLE "membership_holds" DROP CONSTRAINT "FK_41ad0d8d8f711bde28b35e0322d"`);
        await queryRunner.query(`ALTER TABLE "membership_holds" DROP CONSTRAINT "FK_e97122a20ff9be3140cfea44ef4"`);
        await queryRunner.query(`ALTER TABLE "user_memberships" DROP CONSTRAINT "FK_d7709ffe3fe21152decf0ebc203"`);
        await queryRunner.query(`ALTER TABLE "user_memberships" DROP CONSTRAINT "FK_357722cf7d9bc52f4d85121a70d"`);
        await queryRunner.query(`ALTER TABLE "user_memberships" DROP CONSTRAINT "FK_b369bfb0586d848e7f52f47d492"`);
        await queryRunner.query(`ALTER TABLE "user_memberships" DROP CONSTRAINT "FK_51d456f048da1b3e1af10ce8d8f"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_f2b0328c6260a41397d35693c6d"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_427785468fb7d2733f59e7d7d39"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_d07fb3afe59ba136b721ce6ac98"`);
        await queryRunner.query(`ALTER TABLE "membership_types" DROP CONSTRAINT "FK_1a239b80ad041081193b04779bf"`);
        await queryRunner.query(`ALTER TABLE "attendances" DROP CONSTRAINT "FK_aa902e05aeb5fde7c1dd4ced2b7"`);
        await queryRunner.query(`ALTER TABLE "attendances" DROP CONSTRAINT "FK_fb6cb61ae4bcd35f132b391c8a6"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_05641d53aff179b24c86e23419a"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`);
        await queryRunner.query(`ALTER TABLE "trainer_profiles" DROP CONSTRAINT "FK_034888848d5419a8d9c598de02e"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pt_schedules_gym_trainer_start"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pt_schedules_gym_member_start"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pt_schedules_gym_status_end"`);
        await queryRunner.query(`DROP TABLE "pt_schedules"`);
        await queryRunner.query(`DROP TYPE "public"."pt_schedules_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pt_contracts_gym_member"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pt_contracts_gym_trainer"`);
        await queryRunner.query(`DROP TABLE "pt_contracts"`);
        await queryRunner.query(`DROP TYPE "public"."pt_contracts_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_transfers_gym_created"`);
        await queryRunner.query(`DROP INDEX "public"."idx_transfers_from_user"`);
        await queryRunner.query(`DROP INDEX "public"."idx_transfers_to_user"`);
        await queryRunner.query(`DROP TABLE "membership_transfers"`);
        await queryRunner.query(`DROP INDEX "public"."idx_holds_membership_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_holds_gym_dates"`);
        await queryRunner.query(`DROP TABLE "membership_holds"`);
        await queryRunner.query(`DROP TYPE "public"."membership_holds_created_by_role_enum"`);
        await queryRunner.query(`DROP TYPE "public"."membership_holds_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_memberships_gym_user_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_memberships_gym_end_date"`);
        await queryRunner.query(`DROP TABLE "user_memberships"`);
        await queryRunner.query(`DROP TYPE "public"."user_memberships_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_payments_gym_created"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."payments_method_enum"`);
        await queryRunner.query(`DROP TYPE "public"."payments_purpose_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_membership_types_gym_active"`);
        await queryRunner.query(`DROP TABLE "membership_types"`);
        await queryRunner.query(`DROP INDEX "public"."idx_attendances_gym_user_checked"`);
        await queryRunner.query(`DROP INDEX "public"."idx_attendances_gym_checked"`);
        await queryRunner.query(`DROP TABLE "attendances"`);
        await queryRunner.query(`DROP TYPE "public"."attendances_method_enum"`);
        await queryRunner.query(`DROP TABLE "gyms"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_gym_role"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_refresh_tokens_user_revoked"`);
        await queryRunner.query(`DROP INDEX "public"."idx_refresh_tokens_expires"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP TYPE "public"."refresh_tokens_revoked_reason_enum"`);
        await queryRunner.query(`DROP TABLE "trainer_profiles"`);
    }

}
