export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/** Port so the domain never depends on bcrypt directly. */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}
