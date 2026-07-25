/**
 * A domain event recorded by an aggregate. Plain data — the application layer
 * hands these to @nestjs/event-emitter, but the domain itself has no idea a
 * framework event bus exists.
 */
export interface DomainEvent {
  readonly name: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

/**
 * Aggregates record events instead of publishing them, so a rule change and its
 * audit trail are decided in the same place. The application service drains them
 * after the write succeeds — nothing is announced that did not persist.
 */
export abstract class AggregateRoot {
  private readonly _events: DomainEvent[] = [];

  protected record(name: string, payload: Record<string, unknown>): void {
    this._events.push({ name, occurredAt: new Date(), payload });
  }

  /** Returns the pending events and clears them, so a re-drain publishes nothing. */
  pullEvents(): DomainEvent[] {
    return this._events.splice(0, this._events.length);
  }

  get hasPendingEvents(): boolean {
    return this._events.length > 0;
  }
}
