import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * 접근 가능한 역할을 지정한다. Spring의 @PreAuthorize("hasRole('OWNER')")에 해당한다.
 *
 * 지정하지 않으면 인증된 모든 역할이 접근 가능하다.
 *
 * @example
 * @Roles(Role.OWNER)
 * @Post('users')
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
