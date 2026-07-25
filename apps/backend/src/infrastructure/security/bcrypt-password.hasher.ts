import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordHasher } from '../../domain/interfaces/otp-repository.interface';

/** Cost 12: ~250ms per hash on typical hardware — slow enough to matter to an
 *  offline cracker, fast enough not to be a login-path DoS. */
const ROUNDS = 12;

@Injectable()
export class BcryptPasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, ROUNDS);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    // bcrypt.compare is constant-time for a given hash, which is what keeps a
    // password check from leaking how much of the password was right.
    return bcrypt.compare(plain, hash);
  }
}
