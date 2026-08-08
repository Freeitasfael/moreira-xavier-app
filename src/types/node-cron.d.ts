declare module 'node-cron' {
  interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
    name?: string;
    recoverMissedExecutions?: boolean;
  }

  interface ScheduledTask {
    start: () => void;
    stop: () => void;
  }

  function schedule(
    cronExpression: string,
    func: () => void | Promise<void>,
    options?: ScheduleOptions,
  ): ScheduledTask;

  function validate(cronExpression: string): boolean;

  function getTasks(): Map<string, ScheduledTask>;
}
