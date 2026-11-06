// Native selections and the temporary retry draft belong to one account.
// Draft input is kept only for recovery and cleared on success/account change.
export function currentAccount(cookie = document.cookie) {
  try {
    const id = decodeURIComponent(
      cookie
        .split(/;\s*/)
        .find((v) => v.startsWith("user_id="))
        ?.slice(8) || "Guest",
    );
    return id === "Guest" ? "" : id;
  } catch {
    return "";
  }
}
const prefix = "beautymatch_native_v2:";
export function createAccountContext(storage, account) {
  function sync() {
    const user = account();
    if (storage.getItem(prefix + "owner") !== user || !user) {
      for (const key of Object.keys(storage))
        if (key.startsWith("beautymatch_")) storage.removeItem(key);
      if (user) storage.setItem(prefix + "owner", user);
    }
    return user;
  }
  return {
    sync,
    read(key) {
      if (!sync()) return null;
      try {
        return JSON.parse(storage.getItem(prefix + key) || "null");
      } catch {
        return null;
      }
    },
    write(key, value) {
      if (!sync()) return;
      if (value == null) storage.removeItem(prefix + key);
      else storage.setItem(prefix + key, JSON.stringify(value));
    },
    clear() {
      for (const key of Object.keys(storage))
        if (key.startsWith("beautymatch_")) storage.removeItem(key);
    },
  };
}
