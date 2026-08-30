import { ReferenceNumber } from './reference-number.vo';

/**
 * The رقم مرجعي is a credential, not just an identifier:
 * `POST /auth/citizen/reference/open` accepts one alone and returns a session
 * over the holder's national ID number, civil record number, residency status
 * and fee ledger.
 *
 * It used to be drawn from `Math.floor(Math.random() * max)`. V8 implements
 * `Math.random()` with xorshift128+, whose internal state is recoverable from a
 * handful of observed outputs — after which every value it has produced or will
 * produce is computable. References are printed on every وصل and read aloud at
 * the counter, so outputs are public by design, and the bulk citizen import
 * draws them in a tight loop from one PRNG state.
 *
 * These tests pin the generator itself rather than the format, which
 * `value-objects.spec.ts` already covers.
 */
describe('ReferenceNumber.generate — the suffix is a credential', () => {
  it('never draws from Math.random', () => {
    // The regression, stated directly. A spy is the only way to assert *which*
    // source was used — the output of a good and a bad generator look alike.
    const random = jest.spyOn(Math, 'random');

    try {
      for (let i = 0; i < 100; i += 1) {
        ReferenceNumber.generate('BZR');
      }
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it('does not repeat across a batch the size of an import', () => {
    // The citizen import mints these in a loop; a generator seeded once per
    // process would show up here long before it showed up in production.
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) {
      seen.add(ReferenceNumber.generate('BZR').value);
    }
    expect(seen.size).toBe(5_000);
  });

  it('uses the whole alphabet rather than a slice of it', () => {
    // A generator producing a biased subset would shrink the 32^6 space the
    // rate limit on the login route is sized against.
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const used = new Set<string>();

    for (let i = 0; i < 3_000; i += 1) {
      for (const char of ReferenceNumber.generate('BZR').value.slice(-6)) {
        used.add(char);
      }
    }

    expect(used.size).toBe(ALPHABET.length);
    for (const char of used) {
      expect(ALPHABET).toContain(char);
    }
  });

  it('still accepts an injected generator, for deterministic tests', () => {
    // The seam stays — it is how `value-objects.spec.ts` pins the format — but
    // the *default* is the thing that matters and is asserted above.
    const reference = ReferenceNumber.generate('BZR', new Date('2026-07-01T00:00:00Z'), () => 0);
    expect(reference.value).toBe('BZR-2607-AAAAAA');
  });
});
