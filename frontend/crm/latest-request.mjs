// Every new query invalidates both successful and failed older responses.
export function latestRequest() {
  let version = 0;
  return () => {
    const current = ++version;
    return () => current === version;
  };
}
