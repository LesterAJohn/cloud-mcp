import pino from "pino";

export function createLogger(level = "info", destination = process.stdout) {
  const usePrettyTransport = destination === process.stdout && process.env.NODE_ENV !== "production";

  return usePrettyTransport
    ? pino({
        level,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
          },
        },
      })
    : pino({ level }, destination);
}
