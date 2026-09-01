export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(args: { task: () => Promise<void> }): Promise<void> {
      const next = tail.then(args.task, args.task);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
