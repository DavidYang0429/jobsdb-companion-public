// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { RUNTIME_CONTRACT } from "../src/services/runtimeContract";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function client(sendMessage: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.stubGlobal("chrome", {
    runtime: { id: "fixture-extension", sendMessage },
  });
  return import("../src/services/client");
}
it.each([
  undefined,
  { ok: false, error: "未知操作" },
  { ok: true, runtimeContract: "old" },
])(
  "blocks writes before sending data to an incompatible background: %j",
  async (response) => {
    const send = vi.fn().mockResolvedValue(response);
    const c = await client(send);
    await expect(
      c.request({ type: "command", command: { type: "fixture" } }),
    ).rejects.toThrow("重新加载");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ type: "runtimeContract" });
  },
);
it("sends contract-bound commands only after the background confirms compatibility", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, runtimeContract: RUNTIME_CONTRACT })
    .mockResolvedValueOnce({ ok: true, state: { fixture: true } });
  const c = await client(send);
  await expect(
    c.request({ type: "command", command: { type: "fixture" } }),
  ).resolves.toMatchObject({ ok: true });
  expect(send.mock.calls[1][0].runtimeContract).toBe(RUNTIME_CONTRACT);
});
it("turns a legacy PDF-version schema failure into instructions without discarding fields", async () => {
  const send = vi
    .fn()
    .mockResolvedValue({
      ok: false,
      error: '[{"code":"unrecognized_keys","keys":["pdfExportVersion"]}]',
    });
  const c = await client(send);
  await expect(c.request({ type: "read" })).rejects.toThrow("无需卸载插件");
});
