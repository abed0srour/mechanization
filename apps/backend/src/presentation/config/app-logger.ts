import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * Raw ANSI rather than a colour library: Nest's own logger uses one internally
 * but does not re-export it, and this needs three codes.
 */
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

/**
 * Nest's console logger, recoloured.
 *
 * Stock Nest paints the whole line one colour per level, so a boot sequence is
 * forty near-identical green lines and the eye has nothing to anchor on. Here
 * the two fixed landmarks — `[Nest] <pid>` and the `[Context]` that says which
 * subsystem is talking — are red, and the prose around them is grey, so a line
 * is scannable by its context rather than read end to end.
 *
 * Warnings and errors keep their own colours regardless. Greying those out
 * would make this scheme actively worse than the default: the one line that
 * matters in a long log is the one that failed.
 */
export class AppLogger extends ConsoleLogger {
  /** `[Nest] 27708  - ` */
  protected formatPid(pid: number): string {
    return `${RED}[Nest] ${pid}${RESET}  - `;
  }

  /** `[InstanceLoader] ` */
  protected formatContext(context: string): string {
    return context ? `${RED}[${context}]${RESET} ` : '';
  }

  /** The trailing `+6ms`, which stock Nest renders yellow. */
  protected formatTimestampDiff(timestampDiff: number): string {
    return `${GRAY} +${timestampDiff}ms${RESET}`;
  }

  /**
   * Drives the message body and, via `stringifyMessage`, any object Nest
   * pretty-prints — so both follow the same rule without special-casing.
   */
  protected colorize(message: string, logLevel: LogLevel): string {
    if (logLevel === 'error' || logLevel === 'fatal') return `${RED}${message}${RESET}`;
    if (logLevel === 'warn') return `${YELLOW}${message}${RESET}`;
    return `${GRAY}${message}${RESET}`;
  }

  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    // `pidMessage` and `contextMessage` arrive already coloured by the two
    // overrides above; the default implementation runs `colorize` over the
    // pid a second time, which would repaint it grey.
    const output = this.stringifyMessage(message, logLevel);
    return (
      `${pidMessage}` +
      `${GRAY}${this.getTimestamp()}${RESET} ` +
      `${this.colorize(formattedLogLevel, logLevel)} ` +
      `${contextMessage}${output}${timestampDiff}\n`
    );
  }
}
