/** Public entry point for the centralized logging foundation. */

export {
  Logger,
  ConsoleLogSink,
  InMemoryLogSink,
  rootLogger,
  createLogger,
  redact,
} from "./logger.js";
export type { LogLevel, LogRecord, LogSink, LoggerOptions } from "./logger.js";
