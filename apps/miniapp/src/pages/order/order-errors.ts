/** Normalize native WeChat errors and API errors without widening action inputs to any. */
export function orderFailure(cause: unknown) {
  const error =
    cause && typeof cause === "object"
      ? (cause as Record<string, unknown>)
      : {};
  return {
    message: typeof error.message === "string" ? error.message : undefined,
    statusCode: typeof error.statusCode === "number" ? error.statusCode : 0,
    errMsg: typeof error.errMsg === "string" ? error.errMsg : "",
  };
}
