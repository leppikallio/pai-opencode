const TIMEOUT_SENTINEL = Symbol("stdin_timeout");

type StdinReader = {
  promise: Promise<string>;
  cancel: () => void;
};

function createProcessStdinReader(): StdinReader {
  let data = "";
  let settled = false;
  let resolveReader: (value: string) => void = () => {};
  let rejectReader: (error: Error) => void = () => {};

  const onData = (chunk: Buffer | string) => {
    data += chunk.toString();
  };

  const cleanup = () => {
    process.stdin.off("data", onData);
    process.stdin.off("end", onEnd);
    process.stdin.off("error", onError);
    process.stdin.pause();
  };

  const settle = (handler: () => void) => {
    if (settled) {
      return;
    }

    settled = true;
    cleanup();
    handler();
  };

  const onEnd = () => {
    settle(() => {
      resolveReader(data);
    });
  };

  const onError = (error: Error) => {
    settle(() => {
      rejectReader(error);
    });
  };

  const promise = new Promise<string>((resolve, reject) => {
    resolveReader = resolve;
    rejectReader = reject;

    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });

  return {
    promise,
    cancel: () => {
      settle(() => {
        resolveReader("");
      });
    },
  };
}

function isStdinReader(value: Promise<string> | StdinReader): value is StdinReader {
  return (
    typeof value === "object" &&
    value !== null &&
    "promise" in value &&
    "cancel" in value &&
    typeof value.cancel === "function"
  );
}

function toReader(value: Promise<string> | StdinReader): StdinReader {
  if (isStdinReader(value)) {
    return value;
  }

  return {
    promise: value,
    cancel: () => {},
  };
}

export async function readStdinWithTimeout(options?: {
  timeoutMs?: number;
  read?: () => Promise<string> | StdinReader;
}): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const read = options?.read ?? createProcessStdinReader;
  const reader = toReader(read());
  const readPromise = reader.promise.catch(() => "");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  try {
    const result = await Promise.race([readPromise, timeout]);
    if (result === TIMEOUT_SENTINEL) {
      reader.cancel();
      return "";
    }

    return result;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
