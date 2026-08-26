/**
 * A promise the test resolves by hand.
 *
 * Holds a Board's fetch open, which is how a Worker that the platform killed
 * mid-invocation — or one merely slower than its Claim is honoured for — is
 * staged deterministically rather than raced.
 */
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
