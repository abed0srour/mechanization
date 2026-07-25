import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const HEADER = 'x-correlation-id';

/**
 * Stamps every request with an id, echoed back on the response.
 *
 * When a citizen calls the municipality to say "the site failed", the reference
 * they can read off the error screen is the only way to find their request in
 * the logs — they will not have a timestamp, and there may be hundreds of
 * submissions that hour.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Trust an inbound id so a trace survives the frontend → backend hop, but
    // bound its length: it lands in logs, and an unbounded header is a cheap way
    // to write megabytes into them.
    const incoming = req.header(HEADER);
    const correlationId =
      incoming && incoming.length <= 64 ? incoming : randomUUID();

    req.correlationId = correlationId;
    res.setHeader(HEADER, correlationId);
    next();
  }
}
