import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { useTrainingResource } from "./resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("training response ownership", () => {
  it("preserves a successful response on a refresh error and recovers on retry", async () => {
    const resource = useTrainingResource<string[]>(
      () => [],
      () => "admin",
    );
    await resource.load(async () => ["课次 A"]);
    await resource.load(async () => {
      throw new Error("网络中断");
    });
    expect(resource.data.value).toEqual(["课次 A"]);
    expect(resource.error.value).toBe("网络中断");
    await resource.load(async () => ["课次 B"]);
    expect(resource.data.value).toEqual(["课次 B"]);
    expect(resource.error.value).toBe("");
  });
  it("ignores an earlier response that finishes after a newer refresh", async () => {
    const resource = useTrainingResource<string[]>(
      () => [],
      () => "admin",
    );
    const old = deferred<string[]>();
    const pending = resource.load(() => old.promise);
    await resource.load(async () => ["新版"]);
    old.resolve(["旧版"]);
    expect(await pending).toBe(false);
    expect(resource.data.value).toEqual(["新版"]);
  });
  it("ignores an earlier failure after a successful refresh", async () => {
    const resource = useTrainingResource<string[]>(
      () => [],
      () => "admin",
    );
    const old = deferred<string[]>();
    const pending = resource.load(() => old.promise);
    await resource.load(async () => ["新版"]);
    old.reject(new Error("旧请求失败"));
    await pending;
    expect(resource.error.value).toBe("");
  });
  it("clears the previous account's data and ignores its late response", async () => {
    const actor = ref("admin");
    const resource = useTrainingResource<string[]>(
      () => [],
      () => actor.value,
    );
    await resource.load(async () => ["管理员数据"]);
    const old = deferred<string[]>();
    const pending = resource.load(() => old.promise);
    actor.value = "coach";
    expect(resource.data.value).toEqual([]);
    await resource.load(async () => {
      throw new Error("教练请求失败");
    });
    old.resolve(["管理员旧请求"]);
    await pending;
    expect(resource.data.value).toEqual([]);
    expect(resource.error.value).toBe("教练请求失败");
  });
  it("does not repopulate a disposed page", async () => {
    const resource = useTrainingResource<string[]>(
      () => [],
      () => "admin",
    );
    const pending = deferred<string[]>();
    const loading = resource.load(() => pending.promise);
    resource.reset();
    pending.resolve(["迟到的数据"]);
    expect(await loading).toBe(false);
    expect(resource.data.value).toEqual([]);
  });
});
